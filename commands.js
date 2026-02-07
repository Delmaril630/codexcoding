const users = require('../database/users');
const storage = require('../database/storage');
const logs = require('../database/logs');
const logger = require('../utils/logger');
const { createRecv } = require('./protocol');

// Map of userId -> WebSocket connection (set by server.js)
let connections = null;

function setConnectionsMap(map) {
  connections = map;
}

/**
 * Parse and execute admin commands from chat
 * Returns { handled: boolean, response?: string }
 */
async function handleCommand(userId, isAdmin, message) {
  // Commands start with backslash or slash
  if (!message.startsWith('\\') && !message.startsWith('/')) {
    return { handled: false };
  }

  const parts = message.slice(1).split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Check admin permission for admin commands
  const adminCommands = ['kick', 'ban', 'unban', 'announce', 'tp', 'inspect', 'give', 'setadmin'];
  
  if (adminCommands.includes(command) && !isAdmin) {
    logger.security(`Non-admin attempted admin command: ${command}`, { userId });
    return { handled: true, response: 'Permission denied.' };
  }

  switch (command) {
    case 'kick':
      return handleKick(userId, args);
    
    case 'ban':
      return handleBan(userId, args);
    
    case 'unban':
      return handleUnban(userId, args);
    
    case 'announce':
      return handleAnnounce(userId, args);
    
    case 'tp':
      return handleTeleport(userId, args);
    
    case 'inspect':
      return handleInspect(userId, args);
    
    case 'give':
      return handleGive(userId, args);
    
    case 'setadmin':
      return handleSetAdmin(userId, args);
    
    case 'online':
      return handleOnline(userId);
    
    case 'help':
      return handleHelp(isAdmin);
    
    default:
      return { handled: false };
  }
}

/**
 * Kick a player
 */
async function handleKick(adminId, args) {
  if (args.length < 1) {
    return { handled: true, response: 'Usage: \\kick <username>' };
  }

  const username = args[0];
  const target = users.getByUsername(username);
  
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  const conn = connections?.get(target.id);
  if (!conn) {
    return { handled: true, response: `${username} is not online.` };
  }

  // Send kick message before closing
  try {
    const kickMsg = createRecv('system', 'server', '@/kicked', ['You have been kicked by an admin.']);
    conn.send(kickMsg);
    conn.close(1000, 'Kicked by admin');
  } catch (err) {
    logger.error('COMMANDS', 'Failed to kick user', { error: err.message });
  }

  logs.log(adminId, null, 'ADMIN_KICK', 'ADMIN', { target: username });
  logger.admin(`Kicked user: ${username}`, { adminId });

  return { handled: true, response: `Kicked ${username}.` };
}

/**
 * Ban a player
 */
async function handleBan(adminId, args) {
  if (args.length < 1) {
    return { handled: true, response: 'Usage: \\ban <username> [reason]' };
  }

  const username = args[0];
  const reason = args.slice(1).join(' ') || 'No reason provided';
  
  const target = users.getByUsername(username);
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  users.ban(target.id, reason, adminId);

  // Kick if online
  const conn = connections?.get(target.id);
  if (conn) {
    try {
      const banMsg = createRecv('system', 'server', '@/banned', [reason]);
      conn.send(banMsg);
      conn.close(1000, 'Banned');
    } catch (err) {
      logger.error('COMMANDS', 'Failed to disconnect banned user', { error: err.message });
    }
  }

  logs.log(adminId, null, 'ADMIN_BAN', 'ADMIN', { target: username, reason });

  return { handled: true, response: `Banned ${username}: ${reason}` };
}

/**
 * Unban a player
 */
async function handleUnban(adminId, args) {
  if (args.length < 1) {
    return { handled: true, response: 'Usage: \\unban <username>' };
  }

  const username = args[0];
  const target = users.getByUsername(username);
  
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  if (!target.isBanned) {
    return { handled: true, response: `${username} is not banned.` };
  }

  users.unban(target.id, adminId);
  logs.log(adminId, null, 'ADMIN_UNBAN', 'ADMIN', { target: username });

  return { handled: true, response: `Unbanned ${username}.` };
}

/**
 * Server-wide announcement
 */
async function handleAnnounce(adminId, args) {
  if (args.length < 1) {
    return { handled: true, response: 'Usage: \\announce <message>' };
  }

  const message = args.join(' ');
  const announceMsg = createRecv('system', 'server', '@/announce', [message]);

  let sent = 0;
  if (connections) {
    for (const conn of connections.values()) {
      if (conn.readyState === 1) {
        try {
          conn.send(announceMsg);
          sent++;
        } catch (err) {
          // Ignore send errors
        }
      }
    }
  }

  logs.log(adminId, null, 'ADMIN_ANNOUNCE', 'ADMIN', { message, recipients: sent });

  return { handled: true, response: `Announced to ${sent} players.` };
}

/**
 * Teleport to player
 */
async function handleTeleport(adminId, args) {
  if (args.length < 1) {
    return { handled: true, response: 'Usage: \\tp <username>' };
  }

  const username = args[0];
  const target = users.getByUsername(username);
  
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  // Get target's position from storage
  const position = storage.getPersonal(target.id, 'position');
  
  if (!position) {
    return { handled: true, response: `${username}'s position is unknown.` };
  }

  // Send teleport command to admin
  const adminConn = connections?.get(adminId);
  if (adminConn) {
    const tpMsg = createRecv('system', 'server', '@/teleport', [position]);
    adminConn.send(tpMsg);
  }

  return { handled: true, response: `Teleporting to ${username}...` };
}

/**
 * Inspect player data
 */
async function handleInspect(adminId, args) {
  if (args.length < 1) {
    return { handled: true, response: 'Usage: \\inspect <username> [key]' };
  }

  const username = args[0];
  const keyName = args[1];
  
  const target = users.getByUsername(username);
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  if (keyName) {
    const data = storage.getPersonal(target.id, keyName);
    return { 
      handled: true, 
      response: `${username}.${keyName}: ${JSON.stringify(data)}` 
    };
  } else {
    const allData = storage.getAllPersonal(target.id);
    const keys = Object.keys(allData);
    return { 
      handled: true, 
      response: `${username} storage keys: ${keys.join(', ')}` 
    };
  }
}

/**
 * Give items to player
 */
async function handleGive(adminId, args) {
  if (args.length < 3) {
    return { handled: true, response: 'Usage: \\give <username> <itemId> <quantity>' };
  }

  const username = args[0];
  const itemId = parseInt(args[1]);
  const quantity = parseInt(args[2]);

  if (isNaN(itemId) || isNaN(quantity)) {
    return { handled: true, response: 'Invalid item ID or quantity.' };
  }

  const target = users.getByUsername(username);
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  // Update item storage
  const items = storage.getPersonal(target.id, 'item') || {};
  items[itemId] = (items[itemId] || 0) + quantity;
  storage.setPersonal(target.id, 'item', items);

  logs.log(adminId, null, 'ADMIN_GIVE', 'ADMIN', { 
    target: username, 
    itemId, 
    quantity 
  });

  return { handled: true, response: `Gave ${quantity}x item #${itemId} to ${username}.` };
}

/**
 * Set admin status
 */
async function handleSetAdmin(adminId, args) {
  if (args.length < 2) {
    return { handled: true, response: 'Usage: \\setadmin <username> <true|false>' };
  }

  const username = args[0];
  const makeAdmin = args[1].toLowerCase() === 'true';

  const target = users.getByUsername(username);
  if (!target) {
    return { handled: true, response: `User not found: ${username}` };
  }

  users.setAdmin(target.id, makeAdmin, adminId);

  return { 
    handled: true, 
    response: `${username} is ${makeAdmin ? 'now' : 'no longer'} an admin.` 
  };
}

/**
 * List online players
 */
async function handleOnline(userId) {
  const onlineUsers = [];
  
  if (connections) {
    for (const conn of connections.values()) {
      if (conn.readyState === 1) {
        onlineUsers.push(conn.username || conn.userId);
      }
    }
  }

  return { 
    handled: true, 
    response: `Online (${onlineUsers.length}): ${onlineUsers.join(', ') || 'None'}` 
  };
}

/**
 * Help command
 */
function handleHelp(isAdmin) {
  let help = 'Commands: \\online, \\help';
  
  if (isAdmin) {
    help = 'Admin Commands: \\kick, \\ban, \\unban, \\announce, \\tp, \\inspect, \\give, \\setadmin, \\online, \\help';
  }

  return { handled: true, response: help };
}

module.exports = { handleCommand, setConnectionsMap };
