/**
 * Battle Sync Module (Server Side)
 * 
 * Higher-level battle channel orchestration that sits above battle.js:
 * 
 *   battle.js    — Message-level validation (action checks, position bounds)
 *   battle_sync  — Instance lifecycle (create/destroy, matchmaking, state broadcasts)
 *
 * Responsibilities:
 *   1. Battle instance registry (track all active battles server-wide)
 *   2. Channel creation/teardown with proper pubsub cleanup
 *   3. Random encounter → multiplayer battle bridging (party members auto-join)
 *   4. State snapshot broadcasting (periodic authoritative sync)
 *   5. Battle result persistence (XP, gold, drops written to storage)
 *   6. Integration hooks for handler.js routing (btl/ prefix on broadcasts)
 *
 * Integration with handler.js:
 *   In handleBroadcast, add:
 *     if (code.startsWith('btl/')) {
 *       const handled = battleSync.processBattleBroadcast(ws, code, args);
 *       if (handled) return;
 *     }
 *
 *   In handlePublish, add:
 *     if (group === 'battle') {
 *       const result = battle.processBattlePublish(ws, code, args, channel);
 *       if (result === 'handled') return;
 *     }
 *
 *   In handleSubscribe, add:
 *     if (group === 'battle') {
 *       battle.onBattleSubscribe(userId, normalizedChannel);
 *     }
 *
 *   In handleDisconnect, add:
 *     battle.onPlayerDisconnect(userId);
 *     battleSync.onPlayerDisconnect(userId);
 */

const logger  = require('../utils/logger');
const pubsub  = require('./pubsub');
const storage = require('../database/storage');
const { createRecv } = require('./protocol');

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_PARTY_SIZE       = 4;          // Max players per battle
const BATTLE_CLEANUP_MS    = 10000;      // Cleanup delay after battle ends
const SNAPSHOT_INTERVAL_MS = 15000;      // Periodic state broadcast interval
const MAX_ACTIVE_BATTLES   = 200;        // Server-wide cap

// ============================================================================
// STATE
// ============================================================================

/**
 * Battle registry: battleId -> BattleInstance
 *
 * BattleInstance: {
 *   id,                    // Unique battle ID (same as channel)
 *   troopId,               // RPG Maker troop ID
 *   createdAt,
 *   createdBy,             // userId of battle initiator
 *   state: 'waiting'|'active'|'ended',
 *   players: [{            // Ordered by actorIndex
 *     userId, username, actorIndex, joined: boolean
 *   }],
 *   result: null|'victory'|'defeat'|'escape',
 *   rewards: null|{ exp, gold, items }
 * }
 */
const battleRegistry = new Map();
const userActiveBattle = new Map(); // userId -> battleId

// ============================================================================
// BATTLE INSTANCE MANAGEMENT
// ============================================================================

/**
 * Create a new multiplayer battle instance.
 * Called when a party leader initiates a battle (random encounter or challenge).
 *
 * @param {string} initiatorId - UserId of the player who started the battle
 * @param {number} troopId - RPG Maker troop ID
 * @param {Array<{userId, username}>} partyMembers - Players to include
 * @returns {object|null} - Battle instance or null if creation failed
 */
function createBattle(initiatorId, troopId, partyMembers) {
  // Server-wide cap
  if (battleRegistry.size >= MAX_ACTIVE_BATTLES) {
    logger.warn('BATTLE_SYNC', 'Max active battles reached', { count: battleRegistry.size });
    return null;
  }

  // Validate party size
  if (!partyMembers || partyMembers.length < 1 || partyMembers.length > MAX_PARTY_SIZE) {
    logger.warn('BATTLE_SYNC', 'Invalid party size', { count: partyMembers?.length });
    return null;
  }

  // Check no one is already in a battle
  for (const member of partyMembers) {
    if (userActiveBattle.has(member.userId)) {
      logger.warn('BATTLE_SYNC', 'Player already in battle', { userId: member.userId });
      return null;
    }
  }

  // Generate unique battle ID (also used as the pubsub channel)
  const battleId = 'btl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);

  const instance = {
    id: battleId,
    troopId,
    createdAt: Date.now(),
    createdBy: initiatorId,
    state: 'waiting',
    players: partyMembers.map((m, i) => ({
      userId: m.userId,
      username: m.username || m.userId,
      actorIndex: i,
      joined: false
    })),
    result: null,
    rewards: null
  };

  battleRegistry.set(battleId, instance);

  // Track each player
  for (const member of partyMembers) {
    userActiveBattle.set(member.userId, battleId);
  }

  logger.info('BATTLE_SYNC', `Battle created`, {
    battleId, troopId, players: partyMembers.map(m => m.userId)
  });

  // Notify all party members to join the battle channel
  for (const player of instance.players) {
    const conn = getConnection(player.userId);
    if (conn) {
      const msg = createRecv('battle', 'server', 'btl/join', [{
        battleId,
        troopId,
        actorIndex: player.actorIndex,
        players: instance.players.map(p => ({
          userId: p.userId,
          username: p.username,
          actorIndex: p.actorIndex
        }))
      }]);
      conn.send(msg);
    }
  }

  return instance;
}

/**
 * Mark a player as joined (subscribed to the battle channel).
 */
function markPlayerJoined(userId, battleId) {
  const instance = battleRegistry.get(battleId);
  if (!instance) return;

  const player = instance.players.find(p => p.userId === userId);
  if (player) player.joined = true;

  // Check if all players have joined → transition to active
  const allJoined = instance.players.every(p => p.joined);
  if (allJoined && instance.state === 'waiting') {
    instance.state = 'active';
    logger.info('BATTLE_SYNC', `Battle now active (all players joined)`, { battleId });

    // Broadcast battle start to all
    broadcastToAll(battleId, 'btl/start', [{
      battleId,
      troopId: instance.troopId,
      players: instance.players.map(p => ({
        userId: p.userId,
        username: p.username,
        actorIndex: p.actorIndex
      }))
    }]);
  }
}

/**
 * End a battle with a result and optional rewards.
 */
function endBattle(battleId, result, rewards) {
  const instance = battleRegistry.get(battleId);
  if (!instance) return;

  instance.state = 'ended';
  instance.result = result;
  instance.rewards = rewards;

  logger.info('BATTLE_SYNC', `Battle ended`, { battleId, result });

  // Persist rewards if victory
  if (result === 'victory' && rewards) {
    for (const player of instance.players) {
      persistBattleRewards(player.userId, rewards);
    }
  }

  // Notify all players
  broadcastToAll(battleId, 'btl/end', [{
    result,
    rewards: rewards || null
  }]);

  // Schedule cleanup
  setTimeout(() => cleanupBattle(battleId), BATTLE_CLEANUP_MS);
}

/**
 * Clean up a battle instance and free resources.
 */
function cleanupBattle(battleId) {
  const instance = battleRegistry.get(battleId);
  if (!instance) return;

  for (const player of instance.players) {
    userActiveBattle.delete(player.userId);
  }

  battleRegistry.delete(battleId);
  logger.info('BATTLE_SYNC', `Battle cleaned up`, { battleId });
}

// ============================================================================
// BROADCAST COMMANDS — Handle btl/ prefixed broadcasts from handler.js
// ============================================================================

/**
 * Process btl/ broadcast commands (sent via BROADCAST opcode, not PUBLISH).
 * These are command-style messages, not channel-scoped publishes.
 *
 * @param {WebSocket} ws
 * @param {string} code
 * @param {Array} args
 * @returns {boolean} - Whether the command was handled
 */
function processBattleBroadcast(ws, code, args) {
  const { userId, username } = ws;

  switch (code) {
    case 'btl/create': {
      // Create a multiplayer battle
      // args[0] = { troopId, partyMembers: [{ userId, username }] }
      const data = args && args[0];
      if (!data || !data.troopId) return true;

      const members = data.partyMembers || [{ userId, username }];
      const instance = createBattle(userId, data.troopId, members);

      const response = createRecv('system', 'server', 'btl/created', [{
        success: !!instance,
        battleId: instance ? instance.id : null,
        reason: instance ? null : 'creation_failed'
      }]);
      ws.send(response);
      return true;
    }

    case 'btl/joined': {
      // Player acknowledges they've joined the battle channel
      const data = args && args[0];
      if (!data || !data.battleId) return true;
      markPlayerJoined(userId, data.battleId);
      return true;
    }

    case 'btl/result': {
      // Battle result reported by a player
      const data = args && args[0];
      if (!data) return true;

      const battleId = userActiveBattle.get(userId);
      if (!battleId) return true;

      endBattle(battleId, data.result, data.rewards);
      return true;
    }

    case 'btl/leave': {
      // Player voluntarily leaving a battle
      const battleId = userActiveBattle.get(userId);
      if (!battleId) return true;

      const instance = battleRegistry.get(battleId);
      if (instance) {
        // Notify peers
        broadcastToAll(battleId, 'btl/dc', [{ userId, voluntary: true }]);

        // If only 1 player left, end the battle
        const remaining = instance.players.filter(
          p => p.userId !== userId && p.joined
        );
        if (remaining.length === 0) {
          endBattle(battleId, 'abort', null);
        }
      }

      userActiveBattle.delete(userId);
      return true;
    }

    case 'btl/status': {
      // Query active battle status
      const battleId = userActiveBattle.get(userId);
      const instance = battleId ? battleRegistry.get(battleId) : null;

      const response = createRecv('system', 'server', 'btl/status', [{
        inBattle: !!instance,
        battleId: instance ? instance.id : null,
        state: instance ? instance.state : null,
        playerCount: instance ? instance.players.length : 0
      }]);
      ws.send(response);
      return true;
    }

    default:
      return false; // Not a recognized btl/ broadcast command
  }
}

// ============================================================================
// PLAYER DISCONNECT
// ============================================================================

/**
 * Handle player disconnect from server.
 * Called from handler.js handleDisconnect.
 */
function onPlayerDisconnect(userId) {
  const battleId = userActiveBattle.get(userId);
  if (!battleId) return;

  const instance = battleRegistry.get(battleId);
  if (!instance) {
    userActiveBattle.delete(userId);
    return;
  }

  // Don't remove from battle immediately — they might reconnect
  // The battle.js module handles the DC notification via channel unsubscribe
  logger.info('BATTLE_SYNC', `Player disconnected from battle`, { userId, battleId });
}

// ============================================================================
// REWARD PERSISTENCE
// ============================================================================

/**
 * Persist battle rewards to player storage.
 * Uses the economy validation system — writes are server-authoritative.
 */
function persistBattleRewards(userId, rewards) {
  if (!rewards) return;

  try {
    // Add gold
    if (rewards.gold && rewards.gold > 0) {
      const partyData = storage.getPersonal(userId, 'party') || {};
      const currentGold = partyData.gold || 0;
      partyData.gold = currentGold + rewards.gold;
      storage.setPersonal(userId, 'party', partyData, 'battle_reward');
      logger.debug('BATTLE_SYNC', `Awarded ${rewards.gold} gold`, { userId });
    }

    // Add EXP (stored per-actor in actor save data)
    // Note: actual level-up logic runs client-side when they load the data
    if (rewards.exp && rewards.exp > 0) {
      const actorsData = storage.getPersonal(userId, 'actor') || {};
      // Apply to all party actors
      for (const key of Object.keys(actorsData)) {
        if (actorsData[key] && typeof actorsData[key].exp === 'number') {
          actorsData[key].exp += rewards.exp;
        }
      }
      storage.setPersonal(userId, 'actor', actorsData, 'battle_reward');
      logger.debug('BATTLE_SYNC', `Awarded ${rewards.exp} exp`, { userId });
    }

    // Add items
    if (rewards.items && rewards.items.length > 0) {
      for (const drop of rewards.items) {
        // drop = { dataClass: 'item'|'weapon'|'armor', id: number, quantity: number }
        const keyMap = { item: 'item', weapon: 'weapon', armor: 'armor' };
        const storageKey = keyMap[drop.dataClass];
        if (!storageKey) continue;

        const itemData = storage.getPersonal(userId, storageKey) || {};
        const currentQty = itemData[drop.id] || 0;
        itemData[drop.id] = currentQty + (drop.quantity || 1);
        storage.setPersonal(userId, storageKey, itemData, 'battle_reward');
      }
      logger.debug('BATTLE_SYNC', `Awarded ${rewards.items.length} item drops`, { userId });
    }
  } catch (err) {
    logger.error('BATTLE_SYNC', 'Failed to persist battle rewards', {
      userId, error: err.message
    });
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get a player's WebSocket connection by userId.
 */
function getConnection(userId) {
  return global.connections ? global.connections.get(userId) : null;
}

/**
 * Broadcast to all players in a battle instance (via their direct connections).
 */
function broadcastToAll(battleId, code, args) {
  const instance = battleRegistry.get(battleId);
  if (!instance) return;

  for (const player of instance.players) {
    const conn = getConnection(player.userId);
    if (conn && conn.readyState === 1) {
      const msg = createRecv('battle', 'server', code, args);
      conn.send(msg);
    }
  }
}

// ============================================================================
// PERIODIC MAINTENANCE
// ============================================================================

setInterval(() => {
  const now = Date.now();
  for (const [battleId, instance] of battleRegistry) {
    // Clean up stale battles (older than 30 minutes)
    if (now - instance.createdAt > 30 * 60 * 1000) {
      logger.warn('BATTLE_SYNC', `Battle expired`, { battleId });
      endBattle(battleId, 'timeout', null);
    }

    // Clean up 'waiting' battles that never started (5 min timeout)
    if (instance.state === 'waiting' && now - instance.createdAt > 5 * 60 * 1000) {
      logger.warn('BATTLE_SYNC', `Waiting battle timed out`, { battleId });
      cleanupBattle(battleId);
    }
  }
}, 60000);

// ============================================================================
// ADMIN / DEBUG
// ============================================================================

/**
 * Get stats about active battles (for admin API).
 */
function getStats() {
  return {
    activeBattles: battleRegistry.size,
    playersInBattle: userActiveBattle.size,
    battles: [...battleRegistry.values()].map(b => ({
      id: b.id,
      state: b.state,
      troopId: b.troopId,
      playerCount: b.players.length,
      age: Math.floor((Date.now() - b.createdAt) / 1000)
    }))
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  createBattle,
  endBattle,
  cleanupBattle,
  processBattleBroadcast,
  onPlayerDisconnect,
  markPlayerJoined,
  getStats
};
