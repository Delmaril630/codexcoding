const logger = require('../utils/logger');
const rateLimiter = require('../utils/ratelimit');
const storage = require('../database/storage');
const users = require('../database/users');
const logs = require('../database/logs');
const pubsub = require('./pubsub');
const { handleCommand } = require('./commands');
const { validatePersonalSave } = require('../validation/personal');
const { validateGlobalSave } = require('../validation/global');
const anomaly = require('../validation/anomaly');
const {
  Opcode,
  parseMessage,
  createPong,
  createResponse,
  createRecv
} = require('./protocol');

// Guild system (command routing merged into guild.js)
const guild = require('./guild');
const mail = require('./mail');
const presence = require('./presence');
const economy = require('./economy');
const trade = require('./trade');
let social = null;
try {
  social = require('./social');
} catch (e) {
  // Back-compat: older servers used friends.js for social features.
  social = require('./friends');
}
// ============================================================================
// SECURITY: Server-owned storage keys
//
// Any client can open the browser console and call client.save(...).
// If direct writes to guild storage keys are allowed, players can forge guild
// membership or edit guild data.
//
// These keys MUST be written only by server-side systems (e.g. guild.js).
// ============================================================================
const SERVER_OWNED_GLOBAL_KEYS = new Set([
  // guild.js global data
  'guilds',
  'guild_names'
]);

// ============================================================================
// SECURITY: Global keys that clients cannot LOAD directly
// Prevents leaking internal data (guild member notes, bank gold, etc.)
// ============================================================================
const GLOBAL_LOAD_BLACKLIST = new Set([
  'guilds',       // Contains full guild data including notes, bank gold, settings
  'guild_names'   // Internal lookup table - not needed by clients
]);

const SERVER_OWNED_PERSONAL_KEYS = new Set([
  // guild.js per-player membership
  'guild',

  // guild invite system (inbox + settings)
  'guild_invites',
  'guild_invite_settings',

  // mail system (server-owned inbox)
  'mail',

  // friends/blocklist (server-owned)
  'social'
]);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}


/**
 * Handle incoming WebSocket message
 */
async function handleMessage(ws, data) {
  let msg;
  
  try {
    msg = parseMessage(data);
  } catch (err) {
    logger.error('HANDLER', 'Failed to parse message', { 
      userId: ws.userId, 
      error: err.message 
    });
    return;
  }

  const { userId, username, isAdmin } = ws;

  // Rate limiting (except for ping)
  if (msg.opcode !== Opcode.PING) {
    const action = opcodeToAction(msg.opcode);
    if (action && !rateLimiter.checkLimit(userId, action)) {
      logger.warn('HANDLER', 'Rate limited', { userId, action });
      return;
    }
  }

  // Track activity for anomaly detection
  anomaly.trackActivity(userId, opcodeToAction(msg.opcode) || 'unknown', msg);

  try {
    switch (msg.opcode) {
      case Opcode.PING:
        ws.send(createPong(msg.timestamp));
        break;

      case Opcode.LOAD:
        await handleLoad(ws, msg);
        break;

      case Opcode.SAVE:
        await handleSave(ws, msg);
        break;

      case Opcode.SUBSCRIBE:
        handleSubscribe(ws, msg);
        break;

      case Opcode.BROADCAST:
        await handleBroadcast(ws, msg);
        break;

      case Opcode.PUBLISH:
        handlePublish(ws, msg);
        break;

      case Opcode.SENDTO:
        handleSendto(ws, msg);
        break;

      case Opcode.REPORT:
        handleReport(ws, msg);
        break;

      // Admin commands
      case Opcode.ONLINE:
        handleOnline(ws, msg, isAdmin);
        break;

      case Opcode.BANNED:
        handleBanned(ws, msg, isAdmin);
        break;

      case Opcode.BANNING:
        handleBanning(ws, msg, isAdmin);
        break;

      case Opcode.INSPECT:
        handleInspect(ws, msg, isAdmin);
        break;

      case Opcode.OVERWRITE:
        handleOverwrite(ws, msg, isAdmin);
        break;

      default:
        logger.warn('HANDLER', `Unknown opcode: ${msg.opcode}`, { userId });
    }
  } catch (err) {
    logger.error('HANDLER', `Error handling opcode ${msg.opcode}`, { 
      userId, 
      error: err.message,
      stack: err.stack
    });
  }
}

/**
 * Handle LOAD request
 */
async function handleLoad(ws, msg) {
  const { global, keyName, queryId } = msg;
  const { userId } = ws;

  // SECURITY: Block client access to sensitive global storage keys
  if (global && GLOBAL_LOAD_BLACKLIST.has(keyName)) {
    logger.security('Global LOAD blocked (blacklisted key)', { userId, keyName });
    ws.send(createResponse(queryId, {}));
    return;
  }

  let data;
  if (global) {
    data = storage.getGlobal(keyName);
  } else {
    data = storage.getPersonal(userId, keyName);
  }

  ws.send(createResponse(queryId, data || {}));
  
  logger.debug('HANDLER', `Load: ${global ? 'global' : 'personal'}/${keyName}`, { userId });
}

/**
 * Handle SAVE request with validation
 */
async function handleSave(ws, msg) {
  const { global, keyName, fields } = msg;
  const { userId, username } = ws;


// Basic input validation to prevent malformed / hostile payloads
if (typeof keyName !== 'string' || keyName.length === 0 || keyName.length > 64) {
  logger.security('SAVE rejected: invalid keyName', { userId, keyName });
  return;
}
if (!isPlainObject(fields)) {
  logger.security('SAVE rejected: invalid fields payload', { userId, keyName, fieldsType: typeof fields });
  return;
}

// Hard-block server-owned keys to prevent client-side console cheats.
if (global) {
  if (SERVER_OWNED_GLOBAL_KEYS.has(keyName)) {
    logger.security('Global SAVE blocked (server-owned key)', { userId, keyName });
    anomaly.flagAnomaly(userId, username, 'forbidden_global_save', { keyName });
    return;
  }
} else {
  if (SERVER_OWNED_PERSONAL_KEYS.has(keyName)) {
    logger.security('Personal SAVE blocked (server-owned key)', { userId, keyName });
    anomaly.flagAnomaly(userId, username, 'forbidden_personal_save', { keyName });
    return;
  }
}

  if (global) {
    // Validate global save
    const existing = storage.getGlobal(keyName);
    const validation = validateGlobalSave(userId, keyName, fields, existing);

    if (!validation.valid) {
      logger.security(`Global save rejected: ${validation.reason}`, { 
        userId, keyName, fields 
      });
      // SECURITY: Always reject invalid saves (validateStrict removed)
      return;
    }

    storage.setGlobal(keyName, fields, userId);
    
  } else {
    // ECONOMY VALIDATION: Check gold/item/weapon/armor/actor saves
    const economyValidation = economy.validateEconomySave(userId, keyName, fields, storage.getPersonal(userId, keyName));
    if (!economyValidation.valid) {
      logger.security(`Economy save rejected: ${economyValidation.reason}`, { userId, keyName });
      if (economyValidation.anomaly) {
        anomaly.flagAnomaly(userId, username, economyValidation.anomaly.type, economyValidation.anomaly);
      }
      return;
    }

    // Validate personal save
    const existing = storage.getPersonal(userId, keyName);
    const validation = validatePersonalSave(userId, keyName, fields, existing);

    if (!validation.valid) {
      logger.security(`Personal save rejected: ${validation.reason}`, { 
        userId, keyName, fields 
      });
      // SECURITY: Always reject invalid saves (validateStrict removed)
      return;
    }

    if (validation.anomaly) {
      anomaly.flagAnomaly(userId, username, validation.anomaly.type, validation.anomaly);
    }

    storage.setPersonal(userId, keyName, fields);
  }

  logger.debug('HANDLER', `Save: ${global ? 'global' : 'personal'}/${keyName}`, { userId });
}

/**
 * Handle SUBSCRIBE request
 */
function handleSubscribe(ws, msg) {
  const { group, channel, args } = msg;
  const { userId, username } = ws;

  // Normalize channel: client encodes null/undefined as empty string
  const normalizedChannel = (typeof channel === 'string') ? channel : '';
  const isUnsubscribe = normalizedChannel.length === 0;

  // Log ALL subscribe requests (including unsubscribe)
  logger.info('HANDLER', `SUBSCRIBE: ${group}/${isUnsubscribe ? '(none)' : normalizedChannel}`, { userId, args });

  // Get previous channel in this group (for leave notification)
  const connChannels = pubsub.connectionChannels.get(ws);
  let previousChannel = null;
  if (connChannels) {
    for (const channelKey of connChannels) {
      const [g, c] = channelKey.split(':');
      if (g === group) {
        previousChannel = c;
        break;
      }
    }
  }

  // Send "player left" notification to previous channel
  // (works for map/party/guild so other clients can remove presence)
  if (previousChannel && previousChannel !== normalizedChannel) {
    const leaveMsg = createRecv(group, userId, '-', [username]);
    pubsub.publish(group, previousChannel, leaveMsg, ws);
    logger.debug('HANDLER', `Sent - notification to ${group}/${previousChannel}`, { userId });
  }

  // Always unsubscribe from previous channel(s) within this group
  // (e.g., changing maps unsubscribes from old map, but keeps party/guild)
  pubsub.unsubscribeGroup(ws, group);

  // TRADE: Notify trade module when player leaves a trade channel
  if (group === 'trade' && previousChannel) {
    trade.onTradeUnsubscribe(userId, previousChannel);
  }

  // If no channel was provided, treat as "leave/unsubscribe" and stop here.
  // IMPORTANT: Do NOT subscribe to an empty-string channel.
  // This prevents non-sync maps (client uses subscribe('map', null)) from all sharing the same channel.
  if (isUnsubscribe) {
    // TRADE: Notify trade module when explicitly unsubscribing from trade group
    if (group === 'trade' && previousChannel) {
      trade.onTradeUnsubscribe(userId, previousChannel);
    }

    const subs = pubsub.connectionChannels.get(ws);
    logger.debug('HANDLER', `Unsubscribed from group: ${group}`, { userId });
    logger.debug('HANDLER', `User subscriptions after: ${Array.from(subs || []).join(', ')}`, { userId });
    return;
  }

  // Get current subscribers BEFORE joining (for player list)
  const currentSubscribers = pubsub.getSubscribers(group, normalizedChannel);
  const playerList = [];
  for (const conn of currentSubscribers) {
    if (conn !== ws && conn.readyState === 1) {
      playerList.push({ id: conn.userId, name: conn.username });
    }
  }

  // Subscribe to new channel
  // SECURITY: Validate guild channel subscriptions - must be a member
  if (group === 'guild' && normalizedChannel) {
    const guildInfo = guild.getUserGuildInfo(userId);
    if (!guildInfo?.guildId || guildInfo.guildId !== normalizedChannel) {
      logger.security('Guild subscribe blocked (not a member)', { userId, channel: normalizedChannel });
      return;
    }
  }

  pubsub.subscribe(ws, group, normalizedChannel);

  // TRADE: Register player in trade escrow when joining a trade channel
  if (group === 'trade') {
    trade.onTradeSubscribe(userId, normalizedChannel);
  }

  // Send "player joined" notification to new channel (excluding self)
  // Client expects code "+" with from=userId so existing players can sendto() the new player
  const joinMsg = createRecv(group, userId, '+', [username]);
  pubsub.publish(group, normalizedChannel, joinMsg, ws);
  logger.debug('HANDLER', `Sent + notification to ${group}/${normalizedChannel}`, { userId });

  // Send player list to the joining player so they know who's already here
  if (playerList.length > 0) {
    const listMsg = createRecv(group, 'server', '@/players', [playerList]);
    ws.send(listMsg);
    logger.debug('HANDLER', `Sent player list (${playerList.length}) to new joiner`, { userId });
  }

  // Log current subscriptions for this user
  const subs = pubsub.connectionChannels.get(ws);
  logger.debug('HANDLER', `User subscriptions after: ${Array.from(subs || []).join(', ')}`, { userId });
}


// ============================================================================
// SECURITY: Server-side message length limits
// Client enforces 64-250 chars but a modified client can bypass this
// ============================================================================
const MAX_CHAT_LENGTH = 500;       // Chat messages
const MAX_BROADCAST_ARG_LENGTH = 2000; // Other broadcast arguments (JSON etc.)

// ============================================================================
// SECURITY: SENDTO code whitelist
// Only known, safe codes can be relayed between clients
// ============================================================================
const ALLOWED_SENDTO_CODES = new Set([
  // Movement / sync
  'pos', 'move', 'velocity', 'face', 'anim', 'skin',
  // Character sync (identity, position, sprite, events)
  'whois', 'info', 'char', 'event',
  // Trade system
  'trade/request', 'trade/accept', 'trade/decline', 'trade/cancel',
  'trade/offer', 'trade/lock', 'trade/unlock', 'trade/confirm',
  'trade/complete', 'trade/update',
  // Party
  'party/invite', 'party/accept', 'party/decline',
  'party/kick', 'party/leave', 'party/update',
  // Battle
  'battle/invite', 'battle/accept', 'battle/decline',
  'battle/action', 'battle/result', 'battle/update',
  // Emotes / social
  'emote', 'balloon', 'typing', 'directCombatStatus',
  // Player interaction
  'inspect', 'inspect/res',
  // DotMove sync
  'dotmove', 'dotmove/pos',
]);

/**
 * Handle BROADCAST request (to current channel)
 */
async function handleBroadcast(ws, msg) {
  const { loopback, code, args } = msg;
  const { userId, username, isAdmin } = ws;

  // Debug log ALL broadcasts to see what's happening
  logger.debug('HANDLER', `BROADCAST received`, { userId, code, argsLength: args?.length, loopback });

  // ========================================
  // GUILD COMMAND ROUTING
  // Route g/ commands to guild handler
  // ========================================
  if (code.startsWith('g/')) {
    const handled = guild.processGuildCommand(ws, code, args);
    if (handled) return;
  }

  // ========================================
  // MAIL COMMAND ROUTING
  // ========================================
  if (code.startsWith('m/')) {
    const handled = mail.processMailCommand(ws, code, args);
    if (handled) return;
  }


  // ========================================
  // SOCIAL / FRIENDS ROUTING
  // ========================================
  if (code.startsWith('f/') || code.startsWith('s/') || code.startsWith('b/')) {
    if (social) {
      if (typeof social.processSocialCommand === 'function') social.processSocialCommand(ws, code, args);
      else if (typeof social.processFriendCommand === 'function') social.processFriendCommand(ws, code, args);
    }
    return;
  }

  // ========================================
  // PRESENCE / ONLINE LIST ROUTING
  // ========================================
  if (code.startsWith('u/')) {
    const handled = presence.processPresenceCommand(ws, code, args);
    if (handled) return;
  }

  // ========================================
  // ECONOMY / REWARD ROUTING
  // ========================================
  if (code.startsWith('reward/')) {
    const handled = economy.processEconomyCommand(ws, code, args);
    if (handled) return;
  }


  // Chat commands (guild chat + admin commands)
  if (code === 'chat' && args.length > 0 && typeof args[0] === 'string') {
    let chatText = args[0];
    
    // SECURITY: Server-side message length cap
    if (chatText.length > MAX_CHAT_LENGTH) {
      chatText = chatText.substring(0, MAX_CHAT_LENGTH);
      args[0] = chatText;
    }
    
    const trimmed = chatText.trim();

    // Guild chat: /g message  OR  \g message
    if (trimmed.startsWith('/g ') || trimmed.startsWith('\\g ')) {
      const msg = trimmed.substring(3).trim();
      if (!msg) return;

      const info = guild.getUserGuildInfo(userId);
      if (!info?.guildId) {
        const responseMsg = createRecv('system', 'server', 'chat', ['You are not in a guild.']);
        ws.send(responseMsg);
        return;
      }

      guild.handleGuildChat(ws, msg);
      return;
    }

    // Check for admin commands in chat messages
    const cmdResult = await handleCommand(userId, isAdmin, chatText);

    if (cmdResult.handled) {
      // Send response back to sender only
      if (cmdResult.response) {
        const responseMsg = createRecv('system', 'server', 'chat', [cmdResult.response]);
        ws.send(responseMsg);
      }
      return;
    }
  }


  // Get user's subscribed channels and broadcast
  const connChannels = pubsub.connectionChannels.get(ws);
  if (!connChannels) {
    logger.warn('HANDLER', `BROADCAST: No channels for user`, { userId });
    return;
  }

  // Broadcast to each subscribed channel with the CORRECT group in the message
  for (const channelKey of connChannels) {
    const [group, channel] = channelKey.split(':');
    // CRITICAL: Include the group in the RECV message so client .react() handlers fire!
    const message = createRecv(group, userId, code, args);
    pubsub.publish(group, channel, message, loopback ? null : ws);
    logger.debug('HANDLER', `BROADCAST sent to ${group}/${channel}`, { userId, code });
  }
}

/**
 * Handle PUBLISH request (to specific group/channel)
 */
function handlePublish(ws, msg) {
  const { loopback, group, code, args } = msg;
  const { userId } = ws;

  // Get current channel for this group
  const connChannels = pubsub.connectionChannels.get(ws);
  if (!connChannels) return;

  let channel = null;
  for (const channelKey of connChannels) {
    const [g, c] = channelKey.split(':');
    if (g === group) {
      channel = c;
      break;
    }
  }

  if (channel === null || channel === undefined) {
    logger.warn('HANDLER', `Publish to unsubscribed group: ${group}`, { userId });
    return;
  }

  logger.debug('HANDLER', `PUBLISH to ${group}/${channel}`, { userId, code, argsLength: args?.length });

  // TRADE: Intercept trade-channel publishes for server-side escrow
  if (group === 'trade') {
    const result = trade.processTradePublish(ws, code, args, channel);
    if (result === 'handled') return; // Server consumed this message, don't relay
    // 'relay' falls through to normal publish below
  }

  const message = createRecv(group, userId, code, args);
  pubsub.publish(group, channel, message, loopback ? null : ws);
}

/**
 * Handle SENDTO request (direct message)
 * 
 * SECURITY FIX: Check if target has blocked the sender before delivering message.
 * This prevents harassment via direct messages.
 */
function handleSendto(ws, msg) {
  const { targetUser, code, args } = msg;
  const { userId } = ws;

  // SECURITY: Only allow whitelisted sendto codes
  if (!ALLOWED_SENDTO_CODES.has(code)) {
    logger.security('SENDTO blocked (unknown code)', { userId, code, targetUser });
    return;
  }

  // Find target connection
  const targetConn = global.connections?.get(targetUser);
  
  if (!targetConn || targetConn.readyState !== 1) {
    logger.debug('HANDLER', `Sendto target offline: ${targetUser}`, { userId });
    return;
  }

  // SECURITY FIX: Check if target has blocked the sender
  // This prevents harassment by allowing players to block unwanted direct messages
  if (social && typeof social.isBlocked === 'function') {
    const targetUserId = targetConn.userId;
    if (social.isBlocked(targetUserId, userId)) {
      logger.debug('HANDLER', `Sendto blocked by recipient`, { senderId: userId, targetUserId });
      return; // Silently drop - don't reveal block status to sender
    }
  }

  const message = createRecv('@', userId, code, args);
  targetConn.send(message);
  
  logger.debug('HANDLER', `Sendto: ${targetUser} ${code}`, { userId });
}

/**
 * Handle REPORT request
 */
function handleReport(ws, msg) {
  const { reportedUser, reason } = msg;
  const { userId, username } = ws;

  const reportId = logs.createReport(userId, reportedUser, reason);
  
  logger.info('HANDLER', `Report created`, { 
    reporter: username, 
    reported: reportedUser, 
    reason,
    reportId 
  });
}

// ============ Admin Handlers ============

/**
 * Handle ONLINE request (list online users)
 */
function handleOnline(ws, msg, isAdmin) {
  if (!isAdmin) {
    logger.security(`Non-admin ONLINE request`, { userId: ws.userId });
    ws.send(createResponse(msg.queryId, {}));
    return;
  }

  const online = {};
  if (global.connections) {
    for (const [id, conn] of global.connections) {
      if (conn.readyState === 1) {
        online[id] = conn.username || id;
      }
    }
  }

  ws.send(createResponse(msg.queryId, online));
}

/**
 * Handle BANNED request (list banned users)
 */
function handleBanned(ws, msg, isAdmin) {
  if (!isAdmin) {
    logger.security(`Non-admin BANNED request`, { userId: ws.userId });
    ws.send(createResponse(msg.queryId, {}));
    return;
  }

  const banned = users.getBanned();
  const result = {};
  for (const user of banned) {
    result[user.id] = user.username;
  }

  ws.send(createResponse(msg.queryId, result));
}

/**
 * Handle BANNING request (ban/unban user)
 */
function handleBanning(ws, msg, isAdmin) {
  const { user, state, queryId } = msg;
  
  if (!isAdmin) {
    logger.security(`Non-admin BANNING request`, { userId: ws.userId });
    ws.send(createResponse(queryId, { success: false }));
    return;
  }

  if (state) {
    users.ban(user, 'Banned via admin protocol', ws.userId);
    
    // Disconnect if online
    const targetConn = global.connections?.get(user);
    if (targetConn) {
      targetConn.close(1000, 'Banned');
    }
  } else {
    users.unban(user, ws.userId);
  }

  ws.send(createResponse(queryId, { success: true }));
  logger.admin(`User ${state ? 'banned' : 'unbanned'}: ${user}`, { adminId: ws.userId });
}

/**
 * Handle INSPECT request (view user storage)
 */
function handleInspect(ws, msg, isAdmin) {
  const { user, keyName, queryId } = msg;
  
  if (!isAdmin) {
    logger.security(`Non-admin INSPECT request`, { userId: ws.userId });
    ws.send(createResponse(queryId, {}));
    return;
  }

  const data = storage.getPersonal(user, keyName);
  ws.send(createResponse(queryId, data || {}));
  
  logger.admin(`Inspected ${user}/${keyName}`, { adminId: ws.userId });
}

/**
 * Handle OVERWRITE request (modify user storage)
 */
function handleOverwrite(ws, msg, isAdmin) {
  const { user, keyName, queryId, fields } = msg;
  
  if (!isAdmin) {
    logger.security(`Non-admin OVERWRITE request`, { userId: ws.userId });
    ws.send(createResponse(queryId, { success: false }));
    return;
  }

  storage.overwriteUser(user, keyName, fields, ws.userId);
  ws.send(createResponse(queryId, { success: true }));
  
  logger.admin(`Overwrote ${user}/${keyName}`, { adminId: ws.userId, fields });
}

/**
 * Map opcode to rate limit action name
 */
function opcodeToAction(opcode) {
  const map = {
    [Opcode.SAVE]: 'save',
    [Opcode.BROADCAST]: 'broadcast',
    [Opcode.PUBLISH]: 'publish',
    [Opcode.SENDTO]: 'sendto',
    [Opcode.SUBSCRIBE]: 'subscribe'
  };
  return map[opcode];
}

/**
 * Handle player disconnect - cleanup trade escrow state.
 * Called from the main server when a WebSocket connection closes.
 */
function handleDisconnect(ws) {
  const { userId } = ws;
  if (userId) {
    trade.onPlayerDisconnect(userId);
  }
}

module.exports = { handleMessage, handleDisconnect };
