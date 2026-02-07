/**
 * Guild System - Server Side (Merged)
 * 
 * Combines guild business logic + command routing in one file.
 * 
 * Storage Keys:
 * - Global: "guilds" -> { [guildId]: GuildData }
 * - Global: "guild_names" -> { [lowercaseName]: guildId } (for uniqueness)
 * - Personal: "guild" -> { guildId, rankId, joinedAt }
 * 
 * FIXES APPLIED:
 * - Added MAIL_KEY constant (was missing, caused runtime errors)
 * - Added guild name/tag character validation (prevents injection/invisible chars)
 * - Added per-inviter rate limiting (prevents invite spam)
 * - Changed console.error to logger.error
 */

const storage = require('../database/storage');
const users = require('../database/users');
const pubsub = require('./pubsub');
const social = require('./social');
const logger = require('../utils/logger');
const { createRecv } = require('./protocol');

// ============================================================================
// CONSTANTS
// ============================================================================

// FIX: Add missing MAIL_KEY constant (was causing runtime errors)
const MAIL_KEY = 'mail';

// Guild creation cost — set to 0 for testing, raise before launch
// When > 0, the server will verify and deduct gold from the player's save data
const GUILD_CREATION_COST = 0;
const MAX_GUILD_MEMBERS = 50;
const INVITE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MOTD_MAX_LENGTH = 500;
const NOTE_MAX_LENGTH = 200;
const TAG_MIN_LENGTH = 2;
const TAG_MAX_LENGTH = 5;

// FIX: Add character validation regex for guild names/tags
// Only allow alphanumeric, spaces, hyphens, underscores (prevents injection, invisible chars)
const NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;
const TAG_REGEX = /^[a-zA-Z0-9]+$/;

// FIX: Add per-inviter rate limiting to prevent invite spam
const INVITE_COOLDOWN_MS = 30000; // 30 seconds between invites from same user
const inviteCooldowns = new Map(); // inviterId -> lastInviteTimestamp

// Permission flags
const Permission = {
  INVITE: 'invite',
  KICK: 'kick',
  PROMOTE: 'promote',
  DEMOTE: 'demote',
  EDIT_MOTD: 'editMotd',
  EDIT_RANKS: 'editRanks',
  BANK_DEPOSIT: 'bankDeposit',
  BANK_WITHDRAW: 'bankWithdraw',
  ACCESS_GUILD_HALL: 'accessGuildHall',
  VIEW_NOTES: 'viewNotes',
  EDIT_NOTES: 'editNotes',
  START_GUILD_EVENT: 'startGuildEvent',
  DISBAND: 'disband'
};

// Default rank structure (priority 0 = highest)
const DEFAULT_RANKS = [
  {
    id: 'leader',
    name: 'Guild Master',
    priority: 0,
    permissions: { all: true }
  },
  {
    id: 'officer',
    name: 'Officer',
    priority: 1,
    permissions: {
      [Permission.INVITE]: true,
      [Permission.KICK]: true,
      [Permission.PROMOTE]: true,
      [Permission.DEMOTE]: true,
      [Permission.EDIT_MOTD]: true,
      [Permission.BANK_DEPOSIT]: true,
      [Permission.BANK_WITHDRAW]: true,
      bankWithdrawLimit: 10000,
      [Permission.ACCESS_GUILD_HALL]: true,
      [Permission.VIEW_NOTES]: true,
      [Permission.EDIT_NOTES]: true,
      [Permission.START_GUILD_EVENT]: true
    }
  },
  {
    id: 'veteran',
    name: 'Veteran',
    priority: 2,
    permissions: {
      [Permission.INVITE]: true,
      [Permission.BANK_DEPOSIT]: true,
      [Permission.BANK_WITHDRAW]: true,
      bankWithdrawLimit: 1000,
      [Permission.ACCESS_GUILD_HALL]: true,
      [Permission.VIEW_NOTES]: true
    }
  },
  {
    id: 'member',
    name: 'Member',
    priority: 3,
    permissions: {
      [Permission.BANK_DEPOSIT]: true,
      [Permission.ACCESS_GUILD_HALL]: true
    }
  },
  {
    id: 'recruit',
    name: 'Recruit',
    priority: 4,
    permissions: {}
  }
];

// In-memory pending invites: Map<invitedUserId, { guildId, inviterId, inviterName, expiresAt }>
// NOTE: These are lost on server restart. Consider using mail-based invites for persistence.
const pendingInvites = new Map();

// ============================================================================
// GUILD DATA HELPERS
// ============================================================================

function getAllGuilds() {
  return storage.getGlobal('guilds') || {};
}

function getGuild(guildId) {
  const guilds = getAllGuilds();
  const guild = guilds[guildId] || null;

  if (guild && normalizeGuild(guild)) {
    saveGuild(guild);
  }

  return guild;
}

function saveGuild(guild) {
  const guilds = getAllGuilds();
  guilds[guild.id] = guild;
  storage.setGlobal('guilds', guilds, 'guild_system');
  return guild;
}

function deleteGuild(guildId) {
  const guilds = getAllGuilds();
  const guild = guilds[guildId];
  if (!guild) return false;
  
  const names = storage.getGlobal('guild_names') || {};
  const lowerName = guild.name.toLowerCase();
  delete names[lowerName];
  storage.setGlobal('guild_names', names, 'guild_system');
  
  delete guilds[guildId];
  storage.setGlobal('guilds', guilds, 'guild_system');
  
  return true;
}

function isNameAvailable(name) {
  const names = storage.getGlobal('guild_names') || {};
  return !names[name.toLowerCase()];
}

function reserveName(name, guildId) {
  const names = storage.getGlobal('guild_names') || {};
  names[name.toLowerCase()] = guildId;
  storage.setGlobal('guild_names', names, 'guild_system');
}

function getUserGuildInfo(userId) {
  return storage.getPersonal(userId, 'guild');
}

function getMailbox(userId) {
  const raw = storage.getPersonal(userId, MAIL_KEY);
  if (raw && typeof raw === 'object' && Array.isArray(raw.inbox) && Array.isArray(raw.sent)) {
    if (typeof raw.nextId !== 'number') raw.nextId = 1;
    return raw;
  }
  return { inbox: [], sent: [], nextId: 1 };
}

function saveMailbox(userId, mailbox) {
  storage.setPersonal(userId, MAIL_KEY, mailbox);
}

function removeGuildInviteMail(userId, guildId = null) {
  const mailbox = getMailbox(userId);
  const before = mailbox.inbox.length;
  mailbox.inbox = mailbox.inbox.filter((m) => {
    if (!m || m.type !== 'guild_invite') return true;
    if (!guildId) return false;
    return String(m.meta?.guildId ?? '') !== String(guildId);
  });
  if (mailbox.inbox.length !== before) saveMailbox(userId, mailbox);
}

function sendMailNewNotification(targetUserId, summary) {
  const conns = global.connections;
  if (!conns) return;
  const key = String(targetUserId);
  const wsTarget = conns.get(targetUserId) || conns.get(key) || (() => {
    const n = Number(key);
    return !Number.isNaN(n) ? conns.get(n) : null;
  })();
  if (!wsTarget) return;
  try {
    wsTarget.send(createRecv('mail', 'server', 'mail/new', [summary]));
  } catch (_) {}
}

function sendGuildInviteMail(inviterId, inviterName, targetUser, guild) {
  // Safety: do not deliver invite mail if the recipient has blocked the inviter.
  try {
    if (social && typeof social.isBlocked === 'function' && social.isBlocked(targetUser?.id, inviterId)) return;
  } catch (_) {}
  const mailbox = getMailbox(targetUser.id);
  const msg = {
    id: mailbox.nextId++,
    fromId: String(inviterId),
    fromUsername: String(inviterName),
    toId: String(targetUser.id),
    toUsername: targetUser.username,
    subject: `Guild invite: ${guild.name}`,
    body: `${inviterName} invited you to join guild ${guild.name} (${guild.tag}).\n\nOpen your mailbox and use Accept/Decline.`,
    timestamp: Date.now(),
    read: false,
    type: 'guild_invite',
    meta: { guildId: String(guild.id), guildName: guild.name, guildTag: guild.tag, inviter: String(inviterName) }
  };
  mailbox.inbox.push(msg);
  saveMailbox(targetUser.id, mailbox);

  sendMailNewNotification(targetUser.id, { from: String(inviterName), subject: msg.subject, timestamp: msg.timestamp });
}

function setUserGuildInfo(userId, guildInfo) {
  storage.setPersonal(userId, 'guild', guildInfo);
}

function clearUserGuildInfo(userId) {
  storage.deletePersonal(userId, 'guild');
}

// ============================================================================
// LEGACY FIELD NORMALIZATION & ID HELPERS
// ============================================================================

function idEqual(a, b) {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return String(a) === String(b);
}

function normalizeMember(member) {
  let changed = false;
  if (!member || typeof member !== 'object') return false;

  if (member.userId == null && member.oderId != null) { member.userId = member.oderId; changed = true; }
  if (member.oderId == null && member.userId != null) { member.oderId = member.userId; changed = true; }

  if (member.username == null && member.name != null) { member.username = member.name; changed = true; }
  if (member.name == null && member.username != null) { member.name = member.username; changed = true; }

  return changed;
}

function findMember(guild, userId) {
  if (!guild?.members || !Array.isArray(guild.members)) return null;
  return guild.members.find(m => idEqual(m.userId, userId) || idEqual(m.oderId, userId)) || null;
}

function normalizeGuild(guild) {
  if (!guild || !Array.isArray(guild.members)) return false;
  let changed = false;
  for (const m of guild.members) {
    changed = normalizeMember(m) || changed;
  }
  return changed;
}

function generateGuildId() {
  return 'g_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// ============================================================================
// PERMISSION HELPERS
// ============================================================================

function getMemberRank(guild, memberId) {
  const member = findMember(guild, memberId);
  if (!member) return null;
  return guild.ranks.find(r => r.id === member.rankId);
}

function hasPermission(guild, memberId, permission) {
  const rank = getMemberRank(guild, memberId);
  if (!rank) return false;
  if (rank.permissions.all) return true;
  return !!rank.permissions[permission];
}

function canModifyMember(guild, actorId, targetId) {
  if (actorId === targetId) return false;
  
  const actorRank = getMemberRank(guild, actorId);
  const targetRank = getMemberRank(guild, targetId);
  
  if (!actorRank || !targetRank) return false;
  
  return actorRank.priority < targetRank.priority;
}

function ensureMemberOrClear(userId, guild) {
  const member = findMember(guild, userId);
  if (!member) {
    logger.security('Cleared invalid guild membership pointer', { userId, guildId: guild?.id });
    clearUserGuildInfo(userId);
    return null;
  }
  return member;
}

// ============================================================================
// NOTIFICATION HELPERS
// ============================================================================

function notifyGuild(guildId, code, args, excludeWs = null) {
  // Blocklist filter for guild chat: if a recipient has blocked the sender, mask the message
  if (code === 'g/chat' && Array.isArray(args) && args[0] && args[0].from != null) {
    const senderId = args[0].from;
    const subs = pubsub.getSubscribers('guild', guildId);
    const maskedText = '********************';
    for (const wsConn of subs) {
      if (excludeWs && wsConn === excludeWs) continue;
      const blocked = social.isBlocked(wsConn.userId, senderId);
      const payload = blocked ? [{ ...args[0], message: maskedText }] : args;
      try {
        wsConn.send(createRecv('guild', 'server', code, payload));
      } catch (_) {}
    }
    return;
  }

  const message = createRecv('guild', 'server', code, args);
  pubsub.publish('guild', guildId, message, excludeWs);
}

function notifyUser(userId, code, args) {
  const conn = global.connections?.get(userId);
  if (conn && conn.readyState === 1) {
    const message = createRecv('guild', 'server', code, args);
    conn.send(message);
    return true;
  }
  return false;
}

function subscribeToGuild(ws, guildId) {
  pubsub.subscribe(ws, 'guild', guildId);
}

function unsubscribeFromGuild(ws) {
  pubsub.unsubscribeGroup(ws, 'guild');
}

// ============================================================================
// GUILD OPERATIONS
// ============================================================================

function createGuild(userId, username, characterName, name, tag) {
  logger.info('GUILD', `createGuild called`, { userId, username, characterName, name, tag });
  
  if (!name || name.length < 3 || name.length > 30) {
    return { success: false, error: 'Guild name must be 3-30 characters' };
  }
  
  // FIX: Validate guild name characters to prevent injection/invisible chars
  if (!NAME_REGEX.test(name)) {
    return { success: false, error: 'Guild name can only contain letters, numbers, spaces, hyphens, and underscores' };
  }
  
  if (!tag || tag.length < TAG_MIN_LENGTH || tag.length > TAG_MAX_LENGTH) {
    return { success: false, error: `Tag must be ${TAG_MIN_LENGTH}-${TAG_MAX_LENGTH} characters` };
  }
  
  // FIX: Validate tag characters
  if (!TAG_REGEX.test(tag)) {
    return { success: false, error: 'Tag can only contain letters and numbers' };
  }
  
  const existing = getUserGuildInfo(userId);
  if (existing?.guildId) {
    return { success: false, error: 'You are already in a guild' };
  }
  
  if (!isNameAvailable(name)) {
    return { success: false, error: 'Guild name is already taken' };
  }
  
  // SECURITY: Server-side gold validation for guild creation
  if (GUILD_CREATION_COST > 0) {
    const goldData = storage.getPersonal(userId, 'gold');
    const currentGold = goldData?.gold ?? 0;
    if (currentGold < GUILD_CREATION_COST) {
      return { success: false, error: `Guild creation costs ${GUILD_CREATION_COST} gold. You have ${currentGold}.` };
    }
    // Deduct gold server-side
    storage.setPersonal(userId, 'gold', { gold: currentGold - GUILD_CREATION_COST });
    logger.info('GUILD', `Deducted ${GUILD_CREATION_COST} gold for guild creation`, { userId, remaining: currentGold - GUILD_CREATION_COST });
  }
  
  const guildId = generateGuildId();
  const now = Date.now();
  
  const guild = {
    id: guildId,
    name: name,
    tag: tag.toUpperCase(),
    leaderId: userId,
    createdAt: now,
    level: 1,
    xp: 0,
    motd: '',
    bankGold: 0,
    ranks: JSON.parse(JSON.stringify(DEFAULT_RANKS)),
    members: [{
      userId: userId,
      username: username,
      characterName: characterName || username,
      rankId: 'leader',
      joinedAt: now,
      lastOnline: now,
      xpContributed: 0,
      goldDonated: 0,
      note: ''
    }],
    announcements: [],
    settings: {
      recruitmentOpen: false,
      minLevelToJoin: 1
    }
  };
  
  reserveName(name, guildId);
  saveGuild(guild);
  setUserGuildInfo(userId, { guildId, rankId: 'leader', joinedAt: now });
  
  logger.info('GUILD', `Guild created: ${name} [${tag}]`, { userId, guildId });
  
  return { success: true, guild };
}

function invitePlayer(inviterId, inviterName, targetUserId, targetCharacterName) {
  const inviterInfo = getUserGuildInfo(inviterId);
  if (!inviterInfo?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(inviterInfo.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!hasPermission(guild, inviterId, Permission.INVITE)) {
    return { success: false, error: 'You do not have permission to invite' };
  }
  
  const targetInfo = getUserGuildInfo(targetUserId);
  if (targetInfo?.guildId) {
    return { success: false, error: 'Player is already in a guild' };
  }

  // Respect target blocklist: if the target has blocked the inviter, do not deliver invites.
  if (social && typeof social.isBlocked === 'function' && social.isBlocked(targetUserId, inviterId)) {
    return { success: false, error: 'Player is unavailable' };
  }
  
  if (guild.members.length >= MAX_GUILD_MEMBERS) {
    return { success: false, error: 'Guild is full' };
  }
  
  // FIX: Add per-inviter rate limiting to prevent invite spam
  const now = Date.now();
  const lastInviteTime = inviteCooldowns.get(inviterId) || 0;
  if ((now - lastInviteTime) < INVITE_COOLDOWN_MS) {
    const waitSeconds = Math.ceil((INVITE_COOLDOWN_MS - (now - lastInviteTime)) / 1000);
    return { success: false, error: `Please wait ${waitSeconds} seconds before sending another invite` };
  }
  
  // Support multiple invites per user - store as array
  if (!pendingInvites.has(targetUserId)) {
    pendingInvites.set(targetUserId, []);
  }
  
  const userInvites = pendingInvites.get(targetUserId);
  
  // Check if already invited to this guild
  if (userInvites.some(inv => inv.guildId === guild.id)) {
    return { success: false, error: 'Player already has a pending invite from this guild' };
  }
  
  // Max 5 pending invites per player
  if (userInvites.length >= 5) {
    return { success: false, error: 'Player has too many pending invites' };
  }
  
  userInvites.push({
    guildId: guild.id,
    guildName: guild.name,
    guildTag: guild.tag,
    inviterId: inviterId,
    inviterName: inviterName,
    targetCharacterName: targetCharacterName,
    expiresAt: Date.now() + INVITE_EXPIRY_MS
  });
  
  // FIX: Update invite cooldown for this inviter
  inviteCooldowns.set(inviterId, now);
  
  // Deliver invite via mailbox (preferred UI)
  const targetUser = users.getById(targetUserId) || users.getById(String(targetUserId));
  if (targetUser) {
    sendGuildInviteMail(inviterId, inviterName, targetUser, guild);
  } else {
    logger.warn('GUILD', 'Invite target user not found for mailbox delivery', { inviterId, targetUserId });
  }
  
  logger.info('GUILD', `Invite sent`, { inviterId, targetUserId, guildId: guild.id });
  
  return { success: true };
}

function acceptInvite(userId, username, characterName, guildId) {
  const userInvites = pendingInvites.get(userId);
  if (!userInvites || userInvites.length === 0) {
    return { success: false, error: 'No pending invites' };
  }
  
  // Find the specific invite (or first one if no guildId specified)
  let inviteIndex = 0;
  if (guildId) {
    inviteIndex = userInvites.findIndex(inv => inv.guildId === guildId);
    if (inviteIndex === -1) {
      return { success: false, error: 'Invite not found' };
    }
  }
  
  const invite = userInvites[inviteIndex];
  
  if (Date.now() > invite.expiresAt) {
    userInvites.splice(inviteIndex, 1);
    if (userInvites.length === 0) pendingInvites.delete(userId);
    return { success: false, error: 'Invite has expired' };
  }
  
  const guild = getGuild(invite.guildId);
  if (!guild) {
    userInvites.splice(inviteIndex, 1);
    if (userInvites.length === 0) pendingInvites.delete(userId);
    return { success: false, error: 'Guild no longer exists' };
  }
  
  if (guild.members.length >= MAX_GUILD_MEMBERS) {
    userInvites.splice(inviteIndex, 1);
    if (userInvites.length === 0) pendingInvites.delete(userId);
    return { success: false, error: 'Guild is full' };
  }
  
  const now = Date.now();
  // Use stored character name from invite, or passed one, or fallback to username
  const memberCharName = invite.targetCharacterName || characterName || username;
  
  guild.members.push({
    userId: userId,
    username: username,
    characterName: memberCharName,
    rankId: 'recruit',
    joinedAt: now,
    lastOnline: now,
    xpContributed: 0,
    goldDonated: 0,
    note: ''
  });
  
  saveGuild(guild);
  setUserGuildInfo(userId, { guildId: guild.id, rankId: 'recruit', joinedAt: now });
  
  // Clear ALL invites for this user (they joined a guild)
  pendingInvites.delete(userId);

  // Clean up any guild-invite mail messages now that invites are cleared
  removeGuildInviteMail(userId, null);
  
  notifyGuild(guild.id, 'guild/joined', [{ userId, username, characterName: memberCharName }]);
  
  // Notify inviter (if online)
  notifyUser(invite.inviterId, 'guild/invite_accepted', [{
    userId,
    username,
    characterName: memberCharName,
    guildId: guild.id,
    guildName: guild.name,
    guildTag: guild.tag
  }]);

  
  logger.info('GUILD', `Player joined guild`, { userId, guildId: guild.id });
  
  return { success: true, guild };
}

function declineInvite(userId, username, characterName, guildId) {
  const userInvites = pendingInvites.get(userId);
  if (!userInvites || userInvites.length === 0) {
    return { success: false, error: 'No pending invites' };
  }
  
  // Find the specific invite (or first one if no guildId specified)
  let inviteIndex = 0;
  if (guildId) {
    inviteIndex = userInvites.findIndex(inv => inv.guildId === guildId);
    if (inviteIndex === -1) {
      return { success: false, error: 'Invite not found' };
    }
  }
  
  const invite = userInvites[inviteIndex];
  userInvites.splice(inviteIndex, 1);
  
  if (userInvites.length === 0) {
    pendingInvites.delete(userId);
  }
  
  // Notify inviter (if online)
  removeGuildInviteMail(userId, guildId);

  notifyUser(invite.inviterId, 'guild/invite_declined', [{
    userId,
    username,
    characterName: characterName || username,
    guildId: invite.guildId,
    guildName: invite.guildName,
    guildTag: invite.guildTag
  }]);
  
  return { success: true };
}

/**
 * Get all pending invites for a user
 */
function getInvites(userId) {
  const userInvites = pendingInvites.get(userId) || [];
  const now = Date.now();
  
  // Filter out expired invites
  const validInvites = userInvites.filter(inv => now <= inv.expiresAt);
  
  // Update the map if any were removed
  if (validInvites.length !== userInvites.length) {
    if (validInvites.length === 0) {
      pendingInvites.delete(userId);
    } else {
      pendingInvites.set(userId, validInvites);
    }
  }
  
  return {
    success: true,
    invites: validInvites.map(inv => ({
      guildId: inv.guildId,
      guildName: inv.guildName,
      guildTag: inv.guildTag,
      inviterName: inv.inviterName,
      expiresAt: inv.expiresAt
    }))
  };
}

/**
 * Clear all pending invites for a user
 */
function clearInvites(userId) {
  pendingInvites.delete(userId);
  return { success: true };
}

function leaveGuild(userId, username) {
  const info = getUserGuildInfo(userId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    clearUserGuildInfo(userId);
    return { success: false, error: 'Guild not found' };
  }
  
  if (idEqual(guild.leaderId, userId)) {
    return { success: false, error: 'Guild leader must transfer leadership or disband' };
  }
  
  guild.members = guild.members.filter(m => !idEqual(m.userId ?? m.oderId, userId));
  saveGuild(guild);
  clearUserGuildInfo(userId);
  
  notifyGuild(guild.id, 'guild/left', [{ userId, username }]);
  
  logger.info('GUILD', `Player left guild`, { userId, guildId: guild.id });
  
  return { success: true };
}

function kickMember(actorId, targetUserId) {
  const info = getUserGuildInfo(actorId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!hasPermission(guild, actorId, Permission.KICK)) {
    return { success: false, error: 'You do not have permission to kick members' };
  }
  
  if (!canModifyMember(guild, actorId, targetUserId)) {
    return { success: false, error: 'Cannot kick member of equal or higher rank' };
  }
  
  const targetMember = findMember(guild, targetUserId);
  if (!targetMember) {
    return { success: false, error: 'Member not found' };
  }
  
  guild.members = guild.members.filter(m => !idEqual(m.userId ?? m.oderId, targetUserId));
  saveGuild(guild);
  clearUserGuildInfo(targetUserId);
  
  notifyGuild(guild.id, 'guild/kicked', [{ userId: targetUserId, username: targetMember.username || targetMember.name || 'Unknown' }]);
  notifyUser(targetUserId, 'guild/you_kicked', [{ guildName: guild.name }]);
  
  logger.info('GUILD', `Member kicked`, { actorId, targetUserId, guildId: guild.id });
  
  return { success: true };
}

function promoteMember(actorId, targetUserId) {
  const info = getUserGuildInfo(actorId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!hasPermission(guild, actorId, Permission.PROMOTE)) {
    return { success: false, error: 'You do not have permission to promote' };
  }
  
  const actorRank = getMemberRank(guild, actorId);
  const targetMember = findMember(guild, targetUserId);
  if (!targetMember) {
    return { success: false, error: 'Member not found' };
  }
  
  const targetRank = guild.ranks.find(r => r.id === targetMember.rankId);
  if (!targetRank) {
    return { success: false, error: 'Invalid rank' };
  }
  
  const sortedRanks = [...guild.ranks].sort((a, b) => a.priority - b.priority);
  const currentIndex = sortedRanks.findIndex(r => r.id === targetRank.id);
  
  if (currentIndex <= 0) {
    return { success: false, error: 'Member is already at highest rank' };
  }
  
  const newRank = sortedRanks[currentIndex - 1];
  
  if (newRank.priority <= actorRank.priority) {
    return { success: false, error: 'Cannot promote member to your rank or higher' };
  }
  
  targetMember.rankId = newRank.id;
  saveGuild(guild);
  setUserGuildInfo(targetUserId, { ...getUserGuildInfo(targetUserId), rankId: newRank.id });
  
  notifyGuild(guild.id, 'guild/promoted', [{ 
    userId: targetUserId, 
    username: targetMember.username || targetMember.name || 'Unknown',
    newRank: newRank.name 
  }]);
  
  logger.info('GUILD', `Member promoted`, { actorId, targetUserId, newRank: newRank.id });
  
  return { success: true, newRank: newRank.name };
}

function demoteMember(actorId, targetUserId) {
  const info = getUserGuildInfo(actorId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!hasPermission(guild, actorId, Permission.DEMOTE)) {
    return { success: false, error: 'You do not have permission to demote' };
  }
  
  if (!canModifyMember(guild, actorId, targetUserId)) {
    return { success: false, error: 'Cannot demote member of equal or higher rank' };
  }
  
  const targetMember = findMember(guild, targetUserId);
  if (!targetMember) {
    return { success: false, error: 'Member not found' };
  }
  
  const targetRank = guild.ranks.find(r => r.id === targetMember.rankId);
  const sortedRanks = [...guild.ranks].sort((a, b) => a.priority - b.priority);
  const currentIndex = sortedRanks.findIndex(r => r.id === targetRank.id);
  
  if (currentIndex >= sortedRanks.length - 1) {
    return { success: false, error: 'Member is already at lowest rank' };
  }
  
  const newRank = sortedRanks[currentIndex + 1];
  
  targetMember.rankId = newRank.id;
  saveGuild(guild);
  setUserGuildInfo(targetUserId, { ...getUserGuildInfo(targetUserId), rankId: newRank.id });
  
  notifyGuild(guild.id, 'guild/demoted', [{ 
    userId: targetUserId, 
    username: targetMember.username || targetMember.name || 'Unknown',
    newRank: newRank.name 
  }]);
  
  logger.info('GUILD', `Member demoted`, { actorId, targetUserId, newRank: newRank.id });
  
  return { success: true, newRank: newRank.name };
}

function transferLeadership(currentLeaderId, newLeaderId) {
  const info = getUserGuildInfo(currentLeaderId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!idEqual(guild.leaderId, currentLeaderId)) {
    return { success: false, error: 'Only the guild leader can transfer leadership' };
  }
  
  const newLeader = findMember(guild, newLeaderId);
  if (!newLeader) {
    return { success: false, error: 'Target member not found' };
  }
  
  const oldLeader = findMember(guild, currentLeaderId);
  
  guild.leaderId = newLeaderId;
  newLeader.rankId = 'leader';
  oldLeader.rankId = 'officer';
  
  saveGuild(guild);
  setUserGuildInfo(newLeaderId, { ...getUserGuildInfo(newLeaderId), rankId: 'leader' });
  setUserGuildInfo(currentLeaderId, { ...getUserGuildInfo(currentLeaderId), rankId: 'officer' });
  
  notifyGuild(guild.id, 'guild/leadership_transferred', [{ 
    oldLeaderId: currentLeaderId,
    newLeaderId: newLeaderId,
    newLeaderName: newLeader.username || newLeader.name || 'Unknown'
  }]);
  
  logger.info('GUILD', `Leadership transferred`, { currentLeaderId, newLeaderId, guildId: guild.id });
  
  return { success: true };
}

function disbandGuild(leaderId) {
  const info = getUserGuildInfo(leaderId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!idEqual(guild.leaderId, leaderId)) {
    return { success: false, error: 'Only the guild leader can disband the guild' };
  }
  
  notifyGuild(guild.id, 'guild/disbanded', [{ guildName: guild.name }]);
  
  for (const member of guild.members) {
    clearUserGuildInfo(member.userId ?? member.oderId);
  }
  
  deleteGuild(guild.id);
  
  logger.info('GUILD', `Guild disbanded`, { leaderId, guildId: guild.id, guildName: guild.name });
  
  return { success: true };
}

function updateMotd(actorId, newMotd) {
  const info = getUserGuildInfo(actorId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!hasPermission(guild, actorId, Permission.EDIT_MOTD)) {
    return { success: false, error: 'You do not have permission to edit MOTD' };
  }
  
  if (newMotd.length > MOTD_MAX_LENGTH) {
    return { success: false, error: `MOTD cannot exceed ${MOTD_MAX_LENGTH} characters` };
  }
  
  guild.motd = newMotd;
  saveGuild(guild);
  
  notifyGuild(guild.id, 'guild/motd_updated', [{ motd: newMotd }]);
  
  return { success: true };
}

function updateMemberNote(actorId, targetUserId, note) {
  const info = getUserGuildInfo(actorId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }
  
  if (!hasPermission(guild, actorId, Permission.EDIT_NOTES)) {
    return { success: false, error: 'You do not have permission to edit notes' };
  }
  
  if (note.length > NOTE_MAX_LENGTH) {
    return { success: false, error: `Note cannot exceed ${NOTE_MAX_LENGTH} characters` };
  }
  
  const member = findMember(guild, targetUserId);
  if (!member) {
    return { success: false, error: 'Member not found' };
  }
  
  member.note = note;
  saveGuild(guild);
  
  return { success: true };
}

function getGuildForUser(userId) {
  const info = getUserGuildInfo(userId);
  if (!info?.guildId) {
    return null;
  }

  const guild = getGuild(info.guildId);
  if (!guild) {
    clearUserGuildInfo(userId);
    return null;
  }

  const member = ensureMemberOrClear(userId, guild);
  if (!member) {
    return null;
  }

  member.lastOnline = Date.now();
  saveGuild(guild);

  return guild;
}

function getRoster(userId) {
  const info = getUserGuildInfo(userId);
  if (!info?.guildId) {
    return { success: false, error: 'You are not in a guild' };
  }
  
  const guild = getGuild(info.guildId);
  if (!guild) {
    return { success: false, error: 'Guild not found' };
  }

  const me = ensureMemberOrClear(userId, guild);
  if (!me) {
    return { success: false, error: 'You are not in a guild' };
  }

  const roster = guild.members.map(m => {
    const memberId = (m.userId ?? m.oderId);
    const accountName = (m.username ?? m.name ?? 'Unknown');
    const characterName = (m.characterName ?? accountName);
    const rank = guild.ranks.find(r => r.id === m.rankId);

    const isOnline = !!(memberId != null &&
      global.connections?.has(memberId) &&
      global.connections.get(memberId).readyState === 1);

    return {
      userId: memberId,
      username: accountName,
      characterName: characterName,
      oderId: memberId,
      name: accountName,
      rankId: m.rankId,
      rankName: rank?.name || 'Unknown',
      rankPriority: rank?.priority ?? 99,
      joinedAt: m.joinedAt,
      lastOnline: m.lastOnline,
      isOnline,
      note: hasPermission(guild, userId, Permission.VIEW_NOTES) ? m.note : undefined
    };
  });

  roster.sort((a, b) => {
    if (a.rankPriority !== b.rankPriority) return a.rankPriority - b.rankPriority;
    return (a.characterName || a.username).localeCompare(b.characterName || b.username);
  });
  
  return { success: true, roster };
}

function cleanupExpiredInvites() {
  const now = Date.now();
  for (const [userId, invites] of pendingInvites) {
    const validInvites = invites.filter(inv => now <= inv.expiresAt);
    if (validInvites.length === 0) {
      pendingInvites.delete(userId);
    } else if (validInvites.length !== invites.length) {
      pendingInvites.set(userId, validInvites);
    }
  }
  
  // Also clean up old cooldowns (older than 1 hour)
  const cooldownExpiry = now - (60 * 60 * 1000);
  for (const [inviterId, timestamp] of inviteCooldowns) {
    if (timestamp < cooldownExpiry) {
      inviteCooldowns.delete(inviterId);
    }
  }
}

setInterval(cleanupExpiredInvites, 60000);

// ============================================================================
// GUILD CHAT HANDLER
// ============================================================================

function handleGuildChat(ws, message) {
  const info = getUserGuildInfo(ws.userId);
  if (!info?.guildId) return;

  const guild = getGuild(info.guildId);
  if (!guild) {
    clearUserGuildInfo(ws.userId);
    return;
  }

  const member = ensureMemberOrClear(ws.userId, guild);
  if (!member) return;

  if (typeof message !== 'string') return;
  const text = message.trim().substring(0, 500); // Server-side length cap
  if (!text) return;

  notifyGuild(info.guildId, 'g/chat', [{
    from: ws.userId,
    name: ws.username,
    message: text
  }], null);
}

// ============================================================================
// COMMAND ROUTER (Merged from guildCommands.js)
// ============================================================================

/**
 * Send response directly to user
 */
function sendResponse(ws, code, data) {
  const message = createRecv('guild', 'server', code, [data]);
  ws.send(message);
}

/**
 * Sanitize guild data for client
 */
function sanitizeGuild(guildData) {
  return {
    id: guildData.id,
    name: guildData.name,
    tag: guildData.tag,
    leaderId: guildData.leaderId,
    motd: guildData.motd || '',
    level: guildData.level || 1,
    memberCount: Array.isArray(guildData.members) ? guildData.members.length : (guildData.memberCount || 0),
    ranks: guildData.ranks || []
  };
}

/**
 * Process guild command from client
 * @returns {boolean} true if command was handled
 */
function processGuildCommand(ws, code, args) {
  const { userId, username } = ws;

  let result = { success: false, error: 'Unknown command' };

  try {
    switch (code) {
      case 'g/info': {
        const guildData = getGuildForUser(userId);
        if (guildData) {
          const member = guildData.members?.find(m => idEqual(m.userId, userId) || idEqual(m.oderId, userId));
          const myRankId = member?.rankId || 'member';
          const isLeader = idEqual(guildData.leaderId, userId);

          result = {
            success: true,
            guild: sanitizeGuild(guildData),
            myRankId,
            isLeader
          };
        } else {
          result = { success: false, error: 'Not in a guild' };
        }
        sendResponse(ws, 'g/info/res', result);
        return true;
      }

      case 'g/roster': {
        result = getRoster(userId);
        sendResponse(ws, 'g/roster/res', result);
        return true;
      }

      case 'g/create': {
        const [guildName, guildTag, characterName] = args;
        result = createGuild(userId, username, characterName || username, guildName, guildTag);
        sendResponse(ws, 'g/create/res', result);
        if (result.success) {
          subscribeToGuild(ws, result.guild.id);
        }
        return true;
      }

      case 'g/invite': {
        // Supports:
        // 1) ID-based invite: g/invite [targetUserId, targetCharacterName]
        // 2) Username-based invite: g/invite [targetUsername]
        if (args.length === 1 && typeof args[0] === 'string') {
          const targetUsername = args[0].trim();
          if (!targetUsername) {
            result = { success: false, error: 'Username is required' };
          } else {
            const targetUser = users.getByUsername(targetUsername);
            if (!targetUser) {
              result = { success: false, error: `User not found: ${targetUsername}` };
            } else if (String(targetUser.id) === String(userId)) {
              result = { success: false, error: "You can't invite yourself" };
            } else {
              result = invitePlayer(userId, username, targetUser.id, null);
            }
          }
        } else {
          const [targetUserId, targetCharacterName] = args;
          result = invitePlayer(userId, username, targetUserId, targetCharacterName);
        }
        sendResponse(ws, 'g/invite/res', result);
        return true;
      }

      case 'g/acceptMail': {
        const mailId = args?.[0];
        const characterName = String(args?.[1] ?? '').trim() || String(username);

        const mailbox = getMailbox(userId);
        const msg = mailbox.inbox.find((m) => m && m.type === 'guild_invite' && String(m.id) === String(mailId));
        if (!msg) {
          result = { success: false, error: 'Invite mail not found.' };
          sendResponse(ws, 'g/acceptMail/res', result);
          return true;
        }

        const guildId = msg.meta?.guildId;
        if (!guildId) {
          result = { success: false, error: 'Invite mail missing guildId.' };
          sendResponse(ws, 'g/acceptMail/res', result);
          return true;
        }

        result = acceptInvite(userId, username, characterName, guildId);
        sendResponse(ws, 'g/acceptMail/res', result);
        return true;
      }
      case 'g/declineMail': {
        const mailId = args?.[0];
        const characterName = String(args?.[1] ?? '').trim() || String(username);

        const mailbox = getMailbox(userId);
        const msg = mailbox.inbox.find((m) => m && m.type === 'guild_invite' && String(m.id) === String(mailId));
        if (!msg) {
          result = { success: false, error: 'Invite mail not found.' };
          sendResponse(ws, 'g/declineMail/res', result);
          return true;
        }

        const guildId = msg.meta?.guildId;
        if (!guildId) {
          result = { success: false, error: 'Invite mail missing guildId.' };
          sendResponse(ws, 'g/declineMail/res', result);
          return true;
        }

        result = declineInvite(userId, username, characterName, guildId);
        sendResponse(ws, 'g/declineMail/res', result);
        return true;
      }
      case 'g/accept': {
        const [guildId, characterName] = args;
        result = acceptInvite(userId, username, characterName || username, guildId);
        sendResponse(ws, 'g/accept/res', result);
        if (result.success) {
          subscribeToGuild(ws, result.guild.id);
        }
        return true;
      }

      case 'g/decline': {
        const [guildId, characterName] = args;
        result = declineInvite(userId, username, characterName || username, guildId);
        sendResponse(ws, 'g/decline/res', result);
        return true;
      }

      case 'g/invites': {
        result = getInvites(userId);
        sendResponse(ws, 'g/invites/res', result);
        return true;
      }

      case 'g/invites/clear': {
        result = clearInvites(userId);
        sendResponse(ws, 'g/invites/clear/res', result);
        return true;
      }

      case 'g/leave': {
        result = leaveGuild(userId, username);
        sendResponse(ws, 'g/leave/res', result);
        if (result.success) {
          unsubscribeFromGuild(ws);
        }
        return true;
      }

      case 'g/kick': {
        const [targetId] = args;
        result = kickMember(userId, targetId);
        sendResponse(ws, 'g/kick/res', result);
        if (result.success) {
          const targetConn = global.connections?.get(targetId);
          if (targetConn) unsubscribeFromGuild(targetConn);
        }
        return true;
      }

      case 'g/promote': {
        const [targetId] = args;
        result = promoteMember(userId, targetId);
        sendResponse(ws, 'g/promote/res', result);
        return true;
      }

      case 'g/demote': {
        const [targetId] = args;
        result = demoteMember(userId, targetId);
        sendResponse(ws, 'g/demote/res', result);
        return true;
      }

      case 'g/transfer': {
        const [targetId] = args;
        result = transferLeadership(userId, targetId);
        sendResponse(ws, 'g/transfer/res', result);
        return true;
      }

      case 'g/disband': {
        result = disbandGuild(userId);
        sendResponse(ws, 'g/disband/res', result);
        if (result.success) {
          unsubscribeFromGuild(ws);
        }
        return true;
      }

      case 'g/motd': {
        const [motd] = args;
        result = updateMotd(userId, motd || '');
        sendResponse(ws, 'g/motd/res', result);
        return true;
      }

      case 'g/note': {
        const [targetId, note] = args;
        result = updateMemberNote(userId, targetId, note || '');
        sendResponse(ws, 'g/note/res', result);
        return true;
      }

      case 'g/chat': {
        const [chatMessage] = args;
        handleGuildChat(ws, chatMessage);
        return true;
      }

      default:
        return false;
    }
  } catch (error) {
    // FIX: Use logger instead of console.error
    logger.error('GUILD', 'Guild command error', { code, userId, error: error.message, stack: error.stack });
    sendResponse(ws, `${code}/res`, { success: false, error: 'Server error' });
    return true;
  }
}

/**
 * Player login: subscribe to guild channel and inform others.
 */
function onPlayerLogin(ws) {
  const { userId, username } = ws;
  const guildData = getGuildForUser(userId);

  if (guildData) {
    subscribeToGuild(ws, guildData.id);

    const member = guildData.members?.find(m => idEqual(m.userId, userId) || idEqual(m.oderId, userId));
    const myRankId = member?.rankId || 'member';
    const isLeader = idEqual(guildData.leaderId, userId);
    
    sendResponse(ws, 'g/info/res', {
      success: true,
      guild: sanitizeGuild(guildData),
      myRankId,
      isLeader
    });

    notifyGuild(guildData.id, 'g/online', [{ userId, username }], ws);
    
    return guildData;
  }
  
  return null;
}

/**
 * Player logout: notify guild and unsubscribe.
 */
function onPlayerLogout(ws) {
  const { userId, username } = ws;
  const guildInfo = getUserGuildInfo(userId);

  if (guildInfo?.guildId) {
    notifyGuild(guildInfo.guildId, 'g/offline', [{ userId, username }], ws);
    unsubscribeFromGuild(ws);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Constants
  Permission,
  GUILD_CREATION_COST,
  MAX_GUILD_MEMBERS,
  
  // Guild operations
  createGuild,
  invitePlayer,
  acceptInvite,
  declineInvite,
  leaveGuild,
  kickMember,
  promoteMember,
  demoteMember,
  transferLeadership,
  disbandGuild,
  updateMotd,
  updateMemberNote,
  
  // Query operations
  getGuild,
  getGuildForUser,
  getUserGuildInfo,
  getRoster,
  hasPermission,
  getInvites,
  clearInvites,
  
  // Subscription helpers
  subscribeToGuild,
  unsubscribeFromGuild,
  notifyGuild,
  notifyUser,
  
  // Chat
  handleGuildChat,
  
  // Command routing (merged from guildCommands.js)
  processGuildCommand,
  onPlayerLogin,
  onPlayerLogout,
  
  // Cleanup
  cleanupExpiredInvites
};
