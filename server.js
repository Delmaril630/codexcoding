const { WebSocketServer } = require('ws');
const url = require('url');
const config = require('../config');
const logger = require('../utils/logger');
const jwtAuth = require('../auth/jwt');
const users = require('../database/users');
const db = require('../database/sqlite');
const pubsub = require('./pubsub');
const { handleMessage } = require('./handler');
const { setConnectionsMap } = require('./commands');
const guild = require('./guild');
const rateLimiter = require('../utils/ratelimit');
const { startHeartbeat, attachHeartbeat } = require('./heartbeat.safe');

// Global map of userId -> WebSocket connection
const connections = new Map();
global.connections = connections;

// Pass to commands module
setConnectionsMap(connections);

/**
 * Create and configure WebSocket server
 * 
 * FIX: Now calls startHeartbeat to detect dead connections
 */
function createGameServer(httpServer) {
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/game/start'
  });

  // ✅ Attach heartbeat PER CONNECTION
  wss.on('connection', (ws, req) => {
    attachHeartbeat(ws);        // <-- CORRECT PLACE
    handleConnection(ws, req); // keep your existing logic
  });

  // ✅ Start heartbeat ONCE for the server
  startHeartbeat(wss, { logger });

  logger.info('GAME', 'WebSocket server initialized with safe heartbeat');

  return wss;
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(ws, req) {
  const parsedUrl = url.parse(req.url, true);
  const token = parsedUrl.query.token;

  // Authenticate
  if (!token) {
    logger.warn('GAME', 'Connection without token');
    ws.close(1008, 'No token');
    return;
  }

  const tokenData = jwtAuth.verifyToken(token);
  
  if (!tokenData.valid) {
    logger.warn('GAME', 'Invalid token', { error: tokenData.error });
    ws.close(1008, 'Invalid token');
    return;
  }

  // Check if banned
  const user = users.getById(tokenData.userId);
  
  if (!user) {
    logger.warn('GAME', 'User not found', { userId: tokenData.userId });
    ws.close(1008, 'User not found');
    return;
  }

  if (user.isBanned) {
    logger.warn('GAME', 'Banned user attempted connection', { userId: user.id });
    ws.close(1008, `Banned: ${user.banReason || 'No reason'}`);
    return;
  }

  // Check for existing connection (kick old one)
  const existing = connections.get(user.id);
  if (existing) {
    logger.info('GAME', 'Replacing existing connection', { userId: user.id });
    existing.close(1000, 'Replaced by new connection');
  }

  // Setup connection properties
  ws.userId = user.id;
  ws.username = user.username;
  ws.isAdmin = user.isAdmin;
  ws.ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ws.connectedAt = Date.now();

  // Store connection
  connections.set(user.id, ws);

  // Track session in database
  const sessionStmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (user_id, connected_at, ip_address)
    VALUES (?, datetime('now'), ?)
  `);
  sessionStmt.run(user.id, ws.ip);

  logger.info('GAME', `Player connected: ${user.username}`, { 
    userId: user.id, 
    ip: ws.ip,
    isAdmin: user.isAdmin,
    online: connections.size
  });

  // Auto-subscribe player to their guild channel if in a guild
  const guildData = guild.onPlayerLogin(ws);
  if (guildData) {
    logger.info('GAME', `Player auto-subscribed to guild`, { 
      userId: user.id, 
      guildId: guildData.id,
      guildName: guildData.name
    });
  }

  // Setup event handlers
  ws.on('message', (data) => handleMessage(ws, data));
  
  ws.on('close', (code, reason) => handleDisconnect(ws, code, reason));
  
  ws.on('error', (err) => {
    logger.error('GAME', 'WebSocket error', { 
      userId: ws.userId, 
      error: err.message 
    });
  });

  // Ping/pong for keepalive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
}

/**
 * Handle connection close
 */
function handleDisconnect(ws, code, reason) {
  const { userId, username } = ws;

  // Send "player left" notifications to all channels BEFORE unsubscribing
  const { createRecv } = require('./protocol');
  const connChannels = pubsub.connectionChannels.get(ws);
  
  if (connChannels) {
    for (const channelKey of connChannels) {
      const [group, channel] = channelKey.split(':');
      // Client expects code "-" for player leaving
      const leaveMsg = createRecv(group, userId, '-', [username]);
      pubsub.publish(group, channel, leaveMsg, ws);
    }
    logger.debug('GAME', `Sent disconnect notifications to ${connChannels.size} channels`, { userId });
  }

  // Remove from connections
  connections.delete(userId);

  // Notify guild of logout before unsubscribing
  guild.onPlayerLogout(ws);

  // Unsubscribe from all channels
  pubsub.unsubscribeAll(ws);

  // Clear rate limits
  rateLimiter.clearUser(userId);

  // Remove session from database
  const sessionStmt = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
  sessionStmt.run(userId);

  logger.info('GAME', `Player disconnected: ${username}`, { 
    userId, 
    code,
    reason: reason?.toString(),
    online: connections.size
  });
}

/**
 * Heartbeat interval to detect dead connections
 * 
 * IMPORTANT: This must be called after creating the WebSocket server.
 * Without heartbeat, dead connections (network drops, client crashes)
 * will not be detected and will leak memory/resources.
 */

/**
 * Get server stats
 */
function getStats() {
  return {
    online: connections.size,
    pubsub: pubsub.getStats()
  };
}

/**
 * Get list of online users
 */
function getOnlineUsers() {
  const online = [];
  for (const [userId, ws] of connections) {
    online.push({
      id: userId,
      username: ws.username,
      isAdmin: ws.isAdmin,
      connectedAt: ws.connectedAt,
      ip: ws.ip
    });
  }
  return online;
}

/**
 * Broadcast to all connected clients
 */
function broadcastAll(message) {
  let sent = 0;
  for (const ws of connections.values()) {
    if (ws.readyState === 1) {
      try {
        ws.send(message);
        sent++;
      } catch (err) {
        // Ignore
      }
    }
  }
  return sent;
}

/**
 * Kick a user by ID
 */
function kickUser(userId, reason = 'Kicked') {
  const ws = connections.get(userId);
  if (ws) {
    ws.close(1000, reason);
    return true;
  }
  return false;
}

module.exports = {
  createGameServer,
  startHeartbeat,
  getStats,
  getOnlineUsers,
  broadcastAll,
  kickUser,
  connections
};
