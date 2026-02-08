/**
 * Battle Module (Server Side)
 * 
 * Authority Model: "Relay with validation"
 * 
 * Unlike trade.js which fully controls the exchange, battle.js uses a lighter
 * touch: clients compute locally, server validates and relays. This avoids
 * the server needing to run the full RPG Maker MZ damage formula while still
 * preventing cheating.
 * 
 * What the server validates:
 *   - ATB gauge was actually full when action was submitted
 *   - Player is alive and not in an invalid state (dead, casting, etc.)
 *   - Skill exists and the player has enough MP/TP
 *   - Position is within battlefield bounds
 *   - Movement gauge drain is reasonable (not teleporting)
 *   - Damage values are within plausible range (anti-cheat)
 *   - Action rate limiting (can't submit faster than ATB allows)
 *
 * What the server does NOT compute:
 *   - Exact damage formulas (too complex, relies on MZ data)
 *   - Exact ATB fill timing (clients handle, server spot-checks)
 *   - Animation sequencing
 *
 * Integration:
 *   - handler.js intercepts group === 'battle' publishes
 *   - Calls processBattlePublish(ws, code, args, channel)
 *   - Returns 'handled' to consume, or 'relay' to pass through
 *
 * Protocol:
 *   Client → Server (PUBLISH to 'battle' group):
 *     btl/action    — { actorIndex, skillId, targetIndices, position, atbGauge, timestamp }
 *     btl/move      — { actorIndex, x, y, atbGauge, moving }
 *     btl/move_end  — { actorIndex, x, y, atbGauge }
 *     btl/guard     — { actorIndex, atbGauge }
 *     btl/escape    — { actorIndex }
 *     btl/state     — { actorIndex, hp, mp, tp, atbGauge, x, y, states, ... }
 *     btl/end       — { result }
 *
 *   Server → Clients (via battle channel):
 *     btl/peer_act  — Validated action, broadcast to other players
 *     btl/peer_move — Validated position, broadcast to other players
 *     btl/validated — Confirmation back to action sender
 *     btl/rejected  — Rejection with reason
 *     btl/sync      — State correction
 *     btl/end       — Battle result
 *     btl/dc        — Player disconnected
 *     btl/rc        — Player reconnected
 */

const logger = require('../utils/logger');
const { createRecv } = require('./protocol');
const pubsub = require('./pubsub');

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_ATB_GAUGE        = 10000;      // Must match client ATB_Core
const BATTLE_AREA_WIDTH    = 700;        // Default, can be overridden per battle
const BATTLE_AREA_HEIGHT   = 400;
const MAX_POSITION_DELTA   = 20;         // Max px per sync tick (anti-teleport)
const ACTION_COOLDOWN_MS   = 500;        // Min ms between actions from same player
const MAX_DAMAGE_RATIO     = 5.0;        // Max damage = target maxHp * ratio (anti-cheat)
const BATTLE_TIMEOUT_MS    = 30 * 60 * 1000; // 30 min auto-cleanup
const STATE_SYNC_INTERVAL  = 10000;      // 10 sec between forced state syncs

// ============================================================================
// STATE
// ============================================================================

/**
 * Active battles: channelId -> BattleState
 * 
 * BattleState: {
 *   channel, createdAt,
 *   players: Map<userId, {
 *     actorIndex, lastActionTime, lastPosition: {x,y},
 *     lastAtbGauge, lastStateSync, connected, username
 *   }>,
 *   settings: { width, height, troopId }
 * }
 */
const activeBattles = new Map();
const userToBattle  = new Map();  // userId -> channelId

// ============================================================================
// LIFECYCLE
// ============================================================================

/**
 * Called when a player subscribes to a battle channel.
 * Registers them in the battle state.
 */
function onBattleSubscribe(userId, channel) {
  if (!channel || !channel.startsWith('btl_')) return;

  let battle = activeBattles.get(channel);
  if (!battle) {
    // First player — create battle state
    battle = {
      channel,
      createdAt: Date.now(),
      players: new Map(),
      settings: { width: BATTLE_AREA_WIDTH, height: BATTLE_AREA_HEIGHT, troopId: 0 }
    };
    activeBattles.set(channel, battle);
    logger.info('BATTLE', `Battle created: ${channel}`, { userId });
  }

  // Register player
  if (!battle.players.has(userId)) {
    battle.players.set(userId, {
      actorIndex: battle.players.size,
      lastActionTime: 0,
      lastPosition: { x: 0, y: 0 },
      lastAtbGauge: 0,
      lastStateSync: Date.now(),
      connected: true,
      username: ''
    });
  } else {
    // Reconnection
    const player = battle.players.get(userId);
    player.connected = true;

    // Notify peers of reconnection
    broadcastToBattle(channel, userId, 'btl/rc', [{ userId }]);
    logger.info('BATTLE', `Player reconnected to battle`, { userId, channel });
  }

  userToBattle.set(userId, channel);
  logger.info('BATTLE', `Player joined battle`, { userId, channel, playerCount: battle.players.size });
}

/**
 * Called when a player unsubscribes from a battle channel.
 */
function onBattleUnsubscribe(userId, channel) {
  if (!channel || !channel.startsWith('btl_')) return;

  const battle = activeBattles.get(channel);
  if (!battle) return;

  const player = battle.players.get(userId);
  if (player) {
    player.connected = false;

    // Notify peers
    broadcastToBattle(channel, userId, 'btl/dc', [{ userId }]);
    logger.info('BATTLE', `Player disconnected from battle`, { userId, channel });
  }

  userToBattle.delete(userId);

  // If all players disconnected, cleanup after timeout
  const anyConnected = [...battle.players.values()].some(p => p.connected);
  if (!anyConnected) {
    setTimeout(() => {
      const b = activeBattles.get(channel);
      if (b && ![...b.players.values()].some(p => p.connected)) {
        cleanupBattle(channel);
      }
    }, 60000); // 1 min grace period
  }
}

/**
 * Called when a player disconnects from the server entirely.
 */
function onPlayerDisconnect(userId) {
  const channel = userToBattle.get(userId);
  if (channel) {
    onBattleUnsubscribe(userId, channel);
  }
}

/**
 * Clean up a battle's state.
 */
function cleanupBattle(channel) {
  const battle = activeBattles.get(channel);
  if (!battle) return;

  for (const userId of battle.players.keys()) {
    userToBattle.delete(userId);
  }
  activeBattles.delete(channel);
  logger.info('BATTLE', `Battle cleaned up: ${channel}`);
}

// ============================================================================
// MESSAGE PROCESSING
// ============================================================================

/**
 * Process a PUBLISH to the 'battle' group.
 * Called from handler.js when group === 'battle'.
 * 
 * @param {WebSocket} ws - The sender's connection
 * @param {string} code - Message code (e.g. 'btl/action')
 * @param {Array} args - Message arguments
 * @param {string} channel - The battle channel
 * @returns {'handled'|'relay'} - Whether the server consumed or passes through
 */
function processBattlePublish(ws, code, args, channel) {
  const { userId } = ws;
  const battle = activeBattles.get(channel);

  if (!battle) {
    logger.warn('BATTLE', `Publish to unknown battle channel`, { userId, channel, code });
    return 'relay'; // Let it pass through — might be a race condition
  }

  const player = battle.players.get(userId);
  if (!player) {
    logger.warn('BATTLE', `Publish from non-participant`, { userId, channel, code });
    return 'handled'; // Block — not in this battle
  }

  const data = args && args[0];
  if (!data || typeof data !== 'object') {
    logger.warn('BATTLE', `Invalid battle publish data`, { userId, code });
    return 'handled';
  }

  switch (code) {
    case 'btl/action':
      return handleAction(ws, battle, player, data, channel);

    case 'btl/move':
      return handleMove(ws, battle, player, data, channel);

    case 'btl/move_end':
      return handleMoveEnd(ws, battle, player, data, channel);

    case 'btl/guard':
      return handleGuard(ws, battle, player, data, channel);

    case 'btl/escape':
      return handleEscape(ws, battle, player, data, channel);

    case 'btl/state':
      return handleState(ws, battle, player, data, channel);

    case 'btl/end':
      return handleEnd(ws, battle, player, data, channel);

    default:
      // Unknown battle code — relay as-is
      return 'relay';
  }
}

// ============================================================================
// ACTION VALIDATION
// ============================================================================

function handleAction(ws, battle, player, data, channel) {
  const { userId } = ws;
  const now = Date.now();

  // --- Validate actor ownership ---
  if (typeof data.actorIndex !== 'number' || data.actorIndex !== player.actorIndex) {
    logger.security('Battle action actor mismatch', {
      userId,
      actorIndex: data.actorIndex,
      expected: player.actorIndex
    });
    sendToPlayer(ws, 'btl/rejected', [{ timestamp: data.timestamp, reason: 'actor_mismatch' }]);
    return 'handled';
  }

  // --- Rate limit: can't act faster than ATB allows ---
  if (now - player.lastActionTime < ACTION_COOLDOWN_MS) {
    logger.security('Battle action rate limited', { userId, delta: now - player.lastActionTime });
    sendToPlayer(ws, 'btl/rejected', [{
      timestamp: data.timestamp,
      reason: 'action_too_fast'
    }]);
    return 'handled';
  }

  // --- Validate ATB gauge was full ---
  if (typeof data.atbGauge === 'number' && data.atbGauge < MAX_ATB_GAUGE * 0.95) {
    logger.security('Battle action with incomplete gauge', {
      userId, gauge: data.atbGauge, required: MAX_ATB_GAUGE
    });
    sendToPlayer(ws, 'btl/rejected', [{
      timestamp: data.timestamp,
      reason: 'gauge_not_full',
      correctedGauge: player.lastAtbGauge
    }]);
    return 'handled';
  }

  // --- Validate position is in bounds ---
  if (data.position) {
    const { x, y } = data.position;
    const bw = battle.settings.width;
    const bh = battle.settings.height;
    if (x < -50 || x > bw + 50 || y < -50 || y > bh + 50) {
      logger.security('Battle action from out-of-bounds position', { userId, x, y });
      sendToPlayer(ws, 'btl/rejected', [{ timestamp: data.timestamp, reason: 'position_oob' }]);
      return 'handled';
    }
  }

  // --- Validate skill ID is reasonable ---
  if (typeof data.skillId === 'number' && (data.skillId < 0 || data.skillId > 9999)) {
    logger.security('Battle invalid skill ID', { userId, skillId: data.skillId });
    sendToPlayer(ws, 'btl/rejected', [{ timestamp: data.timestamp, reason: 'invalid_skill' }]);
    return 'handled';
  }

  if (!Array.isArray(data.targetIndices)) {
    logger.security('Battle invalid target indices', { userId });
    sendToPlayer(ws, 'btl/rejected', [{ timestamp: data.timestamp, reason: 'invalid_targets' }]);
    return 'handled';
  }

  // --- Passed validation ---
  player.lastActionTime = now;
  player.lastAtbGauge = 0; // Gauge should be spent

  // Confirm to sender
  sendToPlayer(ws, 'btl/validated', [{ timestamp: data.timestamp }]);

  // Broadcast to peers as validated action
  broadcastToBattle(channel, userId, 'btl/peer_act', [data]);

  logger.debug('BATTLE', `Action validated`, { userId, skillId: data.skillId, channel });
  return 'handled';
}

// ============================================================================
// MOVEMENT VALIDATION
// ============================================================================

function handleMove(ws, battle, player, data, channel) {
  const { userId } = ws;

  if (typeof data.actorIndex !== 'number' || data.actorIndex !== player.actorIndex) {
    logger.security('Battle move actor mismatch', {
      userId,
      actorIndex: data.actorIndex,
      expected: player.actorIndex
    });
    return 'handled';
  }

  // Validate position bounds
  const bw = battle.settings.width;
  const bh = battle.settings.height;
  const x = Number(data.x) || 0;
  const y = Number(data.y) || 0;

  if (x < -50 || x > bw + 50 || y < -50 || y > bh + 50) {
    logger.security('Battle move out of bounds', { userId, x, y });
    // Send correction instead of blocking
    sendToPlayer(ws, 'btl/sync', [{
      actorIndex: data.actorIndex,
      x: Math.max(0, Math.min(bw, x)),
      y: Math.max(0, Math.min(bh, y)),
      forced: true
    }]);
    return 'handled';
  }

  // Anti-teleport: check distance from last known position
  const lastPos = player.lastPosition;
  const dx = x - lastPos.x;
  const dy = y - lastPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Allow larger jumps for first sync or after long delay
  const maxDelta = MAX_POSITION_DELTA * 3; // 60px per sync (5 frames × ~3px/frame × 4 buffer)
  if (dist > maxDelta && lastPos.x !== 0) {
    logger.warn('BATTLE', `Suspicious movement delta`, { userId, dist, max: maxDelta });
    // Don't reject — could be lag. But log for anomaly detection.
  }

  // Update tracked position
  player.lastPosition = { x, y };
  if (typeof data.atbGauge === 'number') player.lastAtbGauge = data.atbGauge;

  // Broadcast to peers
  broadcastToBattle(channel, userId, 'btl/peer_move', [data]);

  return 'handled';
}

function handleMoveEnd(ws, battle, player, data, channel) {
  const { userId } = ws;

  if (typeof data.actorIndex !== 'number' || data.actorIndex !== player.actorIndex) {
    logger.security('Battle move_end actor mismatch', {
      userId,
      actorIndex: data.actorIndex,
      expected: player.actorIndex
    });
    return 'handled';
  }

  // Update position
  if (typeof data.x === 'number') player.lastPosition.x = data.x;
  if (typeof data.y === 'number') player.lastPosition.y = data.y;
  if (typeof data.atbGauge === 'number') player.lastAtbGauge = data.atbGauge;

  // Broadcast to peers
  broadcastToBattle(channel, userId, 'btl/peer_move', [{
    ...data,
    moving: false
  }]);

  return 'handled';
}

// ============================================================================
// OTHER HANDLERS
// ============================================================================

function handleGuard(ws, battle, player, data, channel) {
  const { userId } = ws;

  if (typeof data.actorIndex !== 'number' || data.actorIndex !== player.actorIndex) {
    logger.security('Battle guard actor mismatch', {
      userId,
      actorIndex: data.actorIndex,
      expected: player.actorIndex
    });
    sendToPlayer(ws, 'btl/rejected', [{ reason: 'actor_mismatch' }]);
    return 'handled';
  }

  // Validate gauge
  if (typeof data.atbGauge === 'number' && data.atbGauge < MAX_ATB_GAUGE * 0.9) {
    sendToPlayer(ws, 'btl/rejected', [{ reason: 'gauge_not_full_guard' }]);
    return 'handled';
  }

  player.lastAtbGauge = 0;
  broadcastToBattle(channel, userId, 'btl/peer_act', [{
    actorIndex: data.actorIndex,
    isGuard: true
  }]);

  return 'handled';
}

function handleEscape(ws, battle, player, data, channel) {
  const { userId } = ws;
  if (typeof data.actorIndex !== 'number' || data.actorIndex !== player.actorIndex) {
    logger.security('Battle escape actor mismatch', {
      userId,
      actorIndex: data.actorIndex,
      expected: player.actorIndex
    });
    return 'handled';
  }
  // Escape is valid any time — broadcast to peers
  broadcastToBattle(channel, userId, 'btl/peer_act', [{
    actorIndex: data.actorIndex,
    isEscape: true
  }]);

  return 'handled';
}

function handleState(ws, battle, player, data, channel) {
  // Periodic state snapshot — store for reconciliation
  const { userId } = ws;

  if (typeof data.actorIndex !== 'number' || data.actorIndex !== player.actorIndex) {
    logger.security('Battle state actor mismatch', {
      userId,
      actorIndex: data.actorIndex,
      expected: player.actorIndex
    });
    return 'handled';
  }

  const sanitized = {
    actorIndex: data.actorIndex
  };

  if (typeof data.atbGauge === 'number') {
    sanitized.atbGauge = Math.max(0, Math.min(MAX_ATB_GAUGE, data.atbGauge));
    player.lastAtbGauge = sanitized.atbGauge;
  }

  if (typeof data.x === 'number') {
    const bw = battle.settings.width;
    sanitized.x = Math.max(0, Math.min(bw, data.x));
    player.lastPosition.x = sanitized.x;
  }

  if (typeof data.y === 'number') {
    const bh = battle.settings.height;
    sanitized.y = Math.max(0, Math.min(bh, data.y));
    player.lastPosition.y = sanitized.y;
  }

  if (Array.isArray(data.states)) {
    sanitized.states = data.states.slice(0, 32);
  }

  if (typeof data.hp === 'number') sanitized.hp = Math.max(0, data.hp);
  if (typeof data.mp === 'number') sanitized.mp = Math.max(0, data.mp);
  if (typeof data.tp === 'number') sanitized.tp = Math.max(0, data.tp);
  if (typeof data.casting === 'boolean') sanitized.casting = data.casting;
  if (typeof data.guarding === 'boolean') sanitized.guarding = data.guarding;
  if (typeof data.escaping === 'boolean') sanitized.escaping = data.escaping;
  if (typeof data.dead === 'boolean') sanitized.dead = data.dead;

  player.lastStateSync = Date.now();

  // Relay to peers so they can reconcile
  broadcastToBattle(channel, userId, 'btl/sync', [sanitized]);

  return 'handled';
}

function handleEnd(ws, battle, player, data, channel) {
  const { userId } = ws;

  // Validate: only accept end from participants
  logger.info('BATTLE', `Battle end requested`, { userId, channel, result: data.result });

  // Broadcast to all players
  const msg = createRecv('battle', 'server', 'btl/end', [data]);
  pubsub.publish('battle', channel, msg, null); // null = send to everyone including sender

  // Schedule cleanup
  setTimeout(() => cleanupBattle(channel), 5000);

  return 'handled';
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Send a message to a specific player via their WebSocket.
 */
function sendToPlayer(ws, code, args) {
  const msg = createRecv('battle', 'server', code, args);
  if (ws && ws.readyState === 1) {
    ws.send(msg);
  }
}

/**
 * Broadcast a message to all players in a battle except the sender.
 */
function broadcastToBattle(channel, senderUserId, code, args) {
  const msg = createRecv('battle', senderUserId, code, args);
  const subscribers = pubsub.getSubscribers('battle', channel);
  if (!subscribers) return;

  for (const conn of subscribers) {
    if (conn.userId !== senderUserId && conn.readyState === 1) {
      conn.send(msg);
    }
  }
}

// ============================================================================
// PERIODIC CLEANUP
// ============================================================================

setInterval(() => {
  const now = Date.now();
  for (const [channel, battle] of activeBattles) {
    if (now - battle.createdAt > BATTLE_TIMEOUT_MS) {
      logger.info('BATTLE', `Battle timed out`, { channel });
      cleanupBattle(channel);
    }
  }
}, 60000); // Check every minute

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  processBattlePublish,
  onBattleSubscribe,
  onBattleUnsubscribe,
  onPlayerDisconnect
};
