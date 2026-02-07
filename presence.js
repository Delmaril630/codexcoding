/**
 * Presence / Online List - Server Side
 *
 * Commands (broadcast codes):
 * - u/online []
 *
 * Response (direct RECV to requester, group "users"):
 * - u/online/res { users: [{ id, username }], count }
 */

const logger = require('../utils/logger');
const { createRecv } = require('./protocol');

function sendResponse(ws, code, data) {
  try {
    ws.send(createRecv('users', 'server', code, [data]));
  } catch (err) {
    logger.error('PRESENCE', 'Failed to sendResponse', { userId: ws.userId, code, error: err.message });
  }
}

function handleOnline(ws) {
  const users = [];
  if (global.connections) {
    for (const [id, conn] of global.connections) {
      if (conn && conn.readyState === 1) {
        users.push({ id, username: conn.username || String(id) });
      }
    }
  }

  // Sort A-Z for stable display
  users.sort((a, b) => String(a.username).localeCompare(String(b.username)));

  sendResponse(ws, 'u/online/res', { users, count: users.length });
  return true;
}

function processPresenceCommand(ws, code, args) {
  try {
    switch (code) {
      case 'u/online':
        return handleOnline(ws);
      default:
        return false;
    }
  } catch (err) {
    logger.error('PRESENCE', 'processPresenceCommand error', { userId: ws.userId, code, error: err.message, stack: err.stack });
    sendResponse(ws, `${code}/res`, { success: false, error: 'Server error.' });
    return true;
  }
}

module.exports = { processPresenceCommand };
