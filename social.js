// social.js
// Friends + Blocklist (server authoritative)
//
// Storage key: 'social' (server-owned personal key)
// Structure: { friends: [userIdString], blocks: [userIdString] }
//
// FIXES APPLIED:
// - Added bidirectional friend request check (prevents duplicate cross-requests)
//
// NOTE: This version is hardened to avoid startup crashes if your logger path differs.
// It will try ../utils/logger first, then ../core/logger, then fall back to console.

const storage = require('../database/storage');
const users = require('../database/users');

let logger;
try {
  // Your server uses ../utils/logger (most common in your repo)
  logger = require('../utils/logger');
} catch (e1) {
  try {
    // Fallback for other layouts
    logger = require('../core/logger');
  } catch (e2) {
    // Last resort: console shim
    logger = {
      info: (...args) => console.log('[SOCIAL]', ...args),
      warn: (...args) => console.warn('[SOCIAL]', ...args),
      error: (...args) => console.error('[SOCIAL]', ...args),
    };
  }
}

const { createRecv } = require('./protocol');

const SOCIAL_KEY = 'social';
const MAIL_KEY = 'mail';

// Cache to avoid repeated storage reads on hot paths (chat filtering)
const socialCache = new Map(); // userIdKey -> { friends:Set<string>, blocks:Set<string>, ts:number }
const CACHE_TTL_MS = 10_000;

function idKey(id) {
  return String(id ?? '');
}

function now() {
  return Date.now();
}

function normalizeSocial(raw) {
  const out = {
    friends: [],
    blocks: [],
  };

  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.friends)) out.friends = raw.friends.map(idKey);
    // Backward-compat: some older builds stored this as `blocked`.
    if (Array.isArray(raw.blocks)) out.blocks = raw.blocks.map(idKey);
    else if (Array.isArray(raw.blocked)) out.blocks = raw.blocked.map(idKey);
  }

  // Unique
  out.friends = Array.from(new Set(out.friends.filter((x) => x)));
  out.blocks = Array.from(new Set(out.blocks.filter((x) => x)));

  return out;
}

function getSocial(userId) {
  const key = idKey(userId);
  const cached = socialCache.get(key);
  const t = now();
  if (cached && (t - cached.ts) <= CACHE_TTL_MS) return cached;

  const raw = storage.getPersonal(userId, SOCIAL_KEY);
  const norm = normalizeSocial(raw);

  const entry = {
    friends: new Set(norm.friends),
    blocks: new Set(norm.blocks),
    ts: t,
  };
  socialCache.set(key, entry);
  return entry;
}

function saveSocial(userId, socialEntry) {
  const key = idKey(userId);

  const friends = Array.from(socialEntry.friends || []).map(idKey).filter((x) => x);
  const blocks = Array.from(socialEntry.blocks || []).map(idKey).filter((x) => x);

  const norm = normalizeSocial({ friends, blocks });
  storage.setPersonal(userId, SOCIAL_KEY, norm);

  socialCache.set(key, {
    friends: new Set(norm.friends),
    blocks: new Set(norm.blocks),
    ts: now(),
  });
}

function resolveUserFlexible(arg) {
  const raw = String(arg ?? '').trim();
  if (!raw) return null;

  // Try username first (preferred)
  const byName = users.getByUsername(raw);
  if (byName) return byName;

  // Fallback: try ID (string or number)
  const byId = users.getById(raw);
  if (byId) return byId;

  const n = Number(raw);
  if (!Number.isNaN(n)) {
    const byNum = users.getById(n);
    if (byNum) return byNum;
  }
  return null;
}

function isOnline(userIdKeyStr) {
  const conns = global.connections;
  if (!conns) return false;
  if (conns.has(userIdKeyStr)) return true;
  const n = Number(userIdKeyStr);
  if (!Number.isNaN(n) && conns.has(n)) return true;
  return false;
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

function deleteInboxMessageById(userId, msgId) {
  const idNum = Number(msgId);
  const mailbox = getMailbox(userId);
  const before = mailbox.inbox.length;
  mailbox.inbox = mailbox.inbox.filter((m) => Number(m.id) !== idNum);
  if (mailbox.inbox.length !== before) {
    saveMailbox(userId, mailbox);
    return true;
  }
  return false;
}

function findInboxMessageById(userId, msgId) {
  const idNum = Number(msgId);
  const mailbox = getMailbox(userId);
  const msg = mailbox.inbox.find((m) => Number(m.id) === idNum);
  return msg || null;
}

function hasPendingFriendRequest(toUserId, fromUserId) {
  const mailbox = getMailbox(toUserId);
  const fromKeyStr = idKey(fromUserId);
  return mailbox.inbox.some((m) => (m && m.type === 'friend_request' && idKey(m.fromId) === fromKeyStr));
}

function sendSocial(ws, code, payload) {
  try {
    ws.send(createRecv('social', 'server', code, [payload]));
  } catch (e) {
    logger.warn('Failed to send social message', { code, err: String(e) });
  }
}

function pushSocialUpdateTo(userId) {
  const conns = global.connections;
  if (!conns) return;
  const key = idKey(userId);

  const ws =
    conns.get(userId) ||
    conns.get(key) ||
    (() => {
      const n = Number(key);
      return !Number.isNaN(n) ? conns.get(n) : null;
    })();

  if (!ws) return;

  const payload = buildListPayload(userId);
  sendSocial(ws, 'social/update', payload);
}

function buildListPayload(userId) {
  const social = getSocial(userId);

  const friends = [];
  for (const fid of social.friends) {
    const u =
      users.getById(fid) ||
      (() => {
        const n = Number(fid);
        return !Number.isNaN(n) ? users.getById(n) : null;
      })();
    if (!u) continue;
    friends.push({
      userId: idKey(u.id),
      username: u.username,
      online: isOnline(idKey(u.id)),
    });
  }

  const blocks = [];
  for (const bid of social.blocks) {
    const u =
      users.getById(bid) ||
      (() => {
        const n = Number(bid);
        return !Number.isNaN(n) ? users.getById(n) : null;
      })();
    if (!u) continue;
    blocks.push({
      userId: idKey(u.id),
      username: u.username,
    });
  }

  friends.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  blocks.sort((a, b) => String(a.username).localeCompare(String(b.username)));

  return { success: true, friends, blocks };
}

// Public API used by chat filtering
function isBlocked(blockerUserId, candidateUserId) {
  const blocker = getSocial(blockerUserId);
  const candKey = idKey(candidateUserId);
  return blocker.blocks.has(candKey);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function handleList(ws) {
  const payload = buildListPayload(ws.userId);
  sendSocial(ws, 's/list/res', payload);
}

function handleFriendRequest(ws, args) {
  const targetName = String(args?.[0] ?? '').trim();
  if (!targetName) {
    return sendSocial(ws, 'f/request/res', { success: false, error: 'Username required.' });
  }

  const target = users.getByUsername(targetName);
  if (!target) {
    return sendSocial(ws, 'f/request/res', { success: false, error: 'Player not found.' });
  }

  const fromKey = idKey(ws.userId);
  const toKey = idKey(target.id);

  if (fromKey === toKey) {
    return sendSocial(ws, 'f/request/res', { success: false, error: 'You cannot add yourself.' });
  }

  const fromSocial = getSocial(ws.userId);
  if (fromSocial.blocks.has(toKey)) {
    return sendSocial(ws, 'f/request/res', { success: false, error: 'You have this player blocked.' });
  }

  const toSocial = getSocial(target.id);
  if (toSocial.blocks.has(fromKey)) {
    // Avoid revealing the block explicitly
    return sendSocial(ws, 'f/request/res', { success: false, error: 'Unable to send friend request.' });
  }

  if (fromSocial.friends.has(toKey)) {
    return sendSocial(ws, 'f/request/res', { success: false, error: 'Already friends.' });
  }

  // FIX: Check for pending request in BOTH directions
  // This prevents A from sending a request to B when B already sent one to A
  if (hasPendingFriendRequest(target.id, ws.userId)) {
    return sendSocial(ws, 'f/request/res', { success: false, error: 'Friend request already sent.' });
  }
  
  // FIX: Also check if the target has already sent US a request
  if (hasPendingFriendRequest(ws.userId, target.id)) {
    return sendSocial(ws, 'f/request/res', { 
      success: false, 
      error: 'This player has already sent you a friend request. Check your mailbox!' 
    });
  }

  // Create a mail message (type: friend_request)
  const mailbox = getMailbox(target.id);
  const msg = {
    id: mailbox.nextId++,
    fromId: fromKey,
    fromUsername: ws.username,
    toId: toKey,
    toUsername: target.username,
    subject: `Friend request from ${ws.username}`,
    body: `${ws.username} wants to add you as a friend.\n\nOpen your mailbox and use Accept/Decline.`,
    timestamp: Date.now(),
    read: false,
    type: 'friend_request',
    meta: {},
  };
  mailbox.inbox.push(msg);
  saveMailbox(target.id, mailbox);

  // Optional: copy in sender sent box
  const senderMailbox = getMailbox(ws.userId);
  senderMailbox.sent.push({
    id: senderMailbox.nextId++,
    fromId: fromKey,
    fromUsername: ws.username,
    toId: toKey,
    toUsername: target.username,
    subject: `Friend request to ${target.username}`,
    body: `Friend request sent to ${target.username}.`,
    timestamp: Date.now(),
    read: true,
    type: 'friend_request_out',
    meta: {},
  });
  saveMailbox(ws.userId, senderMailbox);

  // If recipient is online, ping their mail system
  const conns = global.connections;
  if (conns) {
    const wst =
      conns.get(target.id) ||
      conns.get(toKey) ||
      (() => {
        const n = Number(toKey);
        return !Number.isNaN(n) ? conns.get(n) : null;
      })();
    if (wst) {
      try {
        wst.send(createRecv('mail', 'server', 'mail/new', [{
        id: msg.id,
        fromUsername: msg.fromUsername,
        toUsername: msg.toUsername,
        subject: msg.subject,
        timestamp: msg.timestamp,
        read: false,
        type: msg.type || 'mail'
      }]));
      } catch (_) {}
    }
  }

  sendSocial(ws, 'f/request/res', { success: true, message: 'Friend request sent.' });
}

function handleFriendAccept(ws, args) {
  const mailId = args?.[0];
  const msg = findInboxMessageById(ws.userId, mailId);
  if (!msg || msg.type !== 'friend_request') {
    return sendSocial(ws, 'f/accept/res', { success: false, error: 'Friend request not found.' });
  }

  const meKey = idKey(ws.userId);
  const otherKey = idKey(msg.fromId);

  if (!otherKey) {
    deleteInboxMessageById(ws.userId, mailId);
    return sendSocial(ws, 'f/accept/res', { success: false, error: 'Invalid request.' });
  }

  const meSocial = getSocial(ws.userId);
  const otherUser =
    users.getById(otherKey) ||
    (() => {
      const n = Number(otherKey);
      return !Number.isNaN(n) ? users.getById(n) : null;
    })();

  if (!otherUser) {
    deleteInboxMessageById(ws.userId, mailId);
    return sendSocial(ws, 'f/accept/res', { success: false, error: 'Player not found.' });
  }

  // Check blocks either direction
  if (meSocial.blocks.has(otherKey) || getSocial(otherUser.id).blocks.has(meKey)) {
    return sendSocial(ws, 'f/accept/res', { success: false, error: 'Cannot accept this request.' });
  }

  // Add friendship both ways
  meSocial.friends.add(otherKey);
  saveSocial(ws.userId, meSocial);

  const otherSocial = getSocial(otherUser.id);
  otherSocial.friends.add(meKey);
  saveSocial(otherUser.id, otherSocial);

  // Remove the mail request
  deleteInboxMessageById(ws.userId, mailId);

  // Notify both sides (if online)
  pushSocialUpdateTo(ws.userId);
  pushSocialUpdateTo(otherUser.id);

  // Notify requester via mail
  const requesterMailbox = getMailbox(otherUser.id);
  requesterMailbox.inbox.push({
    id: requesterMailbox.nextId++,
    fromId: 'server',
    fromUsername: 'Server',
    toId: otherKey,
    toUsername: otherUser.username,
    subject: `${ws.username} accepted your friend request`,
    body: `You are now friends with ${ws.username}.`,
    timestamp: Date.now(),
    read: false,
    type: 'friend_response',
    meta: { accepted: true, from: meKey },
  });
  saveMailbox(otherUser.id, requesterMailbox);

  sendSocial(ws, 'f/accept/res', { success: true, message: 'Friend request accepted.' });
}

function handleFriendDecline(ws, args) {
  const mailId = args?.[0];
  const msg = findInboxMessageById(ws.userId, mailId);
  if (!msg || msg.type !== 'friend_request') {
    return sendSocial(ws, 'f/decline/res', { success: false, error: 'Friend request not found.' });
  }

  const otherKey = idKey(msg.fromId);
  deleteInboxMessageById(ws.userId, mailId);

  // Notify requester via mail (optional)
  if (otherKey) {
    const otherUser =
      users.getById(otherKey) ||
      (() => {
        const n = Number(otherKey);
        return !Number.isNaN(n) ? users.getById(n) : null;
      })();
    if (otherUser) {
      const requesterMailbox = getMailbox(otherUser.id);
      requesterMailbox.inbox.push({
        id: requesterMailbox.nextId++,
        fromId: 'server',
        fromUsername: 'Server',
        toId: otherKey,
        toUsername: otherUser.username,
        subject: `${ws.username} declined your friend request`,
        body: `${ws.username} declined your friend request.`,
        timestamp: Date.now(),
        read: false,
        type: 'friend_response',
        meta: { accepted: false, from: idKey(ws.userId) },
      });
      saveMailbox(otherUser.id, requesterMailbox);
    }
  }

  sendSocial(ws, 'f/decline/res', { success: true, message: 'Friend request declined.' });
}

function handleFriendRemove(ws, args) {
  const targetArg = String(args?.[0] ?? '').trim();
  if (!targetArg) return sendSocial(ws, 'f/remove/res', { success: false, error: 'Username required.' });

  const target = resolveUserFlexible(targetArg);
  if (!target) return sendSocial(ws, 'f/remove/res', { success: false, error: 'Player not found.' });

  const meKey = idKey(ws.userId);
  const otherKey = idKey(target.id);

  const meSocial = getSocial(ws.userId);
  const otherSocial = getSocial(target.id);

  meSocial.friends.delete(otherKey);
  saveSocial(ws.userId, meSocial);

  otherSocial.friends.delete(meKey);
  saveSocial(target.id, otherSocial);

  pushSocialUpdateTo(ws.userId);
  pushSocialUpdateTo(target.id);

  sendSocial(ws, 'f/remove/res', { success: true, message: 'Friend removed.' });
}

function handleBlock(ws, args) {
  const targetArg = String(args?.[0] ?? '').trim();
  if (!targetArg) return sendSocial(ws, 'b/block/res', { success: false, error: 'Username required.' });

  const target = resolveUserFlexible(targetArg);
  if (!target) return sendSocial(ws, 'b/block/res', { success: false, error: 'Player not found.' });

  const meKey = idKey(ws.userId);
  const otherKey = idKey(target.id);

  if (meKey === otherKey) return sendSocial(ws, 'b/block/res', { success: false, error: 'You cannot block yourself.' });

  const meSocial = getSocial(ws.userId);
  meSocial.blocks.add(otherKey);
  meSocial.friends.delete(otherKey);
  saveSocial(ws.userId, meSocial);

  // Remove friendship from other side too
  const otherSocial = getSocial(target.id);
  otherSocial.friends.delete(meKey);
  saveSocial(target.id, otherSocial);

  pushSocialUpdateTo(ws.userId);
  pushSocialUpdateTo(target.id);

  sendSocial(ws, 'b/block/res', { success: true, message: 'Player blocked.' });
}

function handleUnblock(ws, args) {
  const targetArg = String(args?.[0] ?? '').trim();
  if (!targetArg) return sendSocial(ws, 'b/unblock/res', { success: false, error: 'Username required.' });

  const target = resolveUserFlexible(targetArg);
  if (!target) return sendSocial(ws, 'b/unblock/res', { success: false, error: 'Player not found.' });

  const otherKey = idKey(target.id);

  const meSocial = getSocial(ws.userId);
  meSocial.blocks.delete(otherKey);
  saveSocial(ws.userId, meSocial);

  pushSocialUpdateTo(ws.userId);

  sendSocial(ws, 'b/unblock/res', { success: true, message: 'Player unblocked.' });
}

function processSocialCommand(ws, code, args) {
  try {
    switch (code) {
      case 's/list': return handleList(ws);
      case 'f/request': return handleFriendRequest(ws, args);
      case 'f/accept': return handleFriendAccept(ws, args);
      case 'f/decline': return handleFriendDecline(ws, args);
      case 'f/remove': return handleFriendRemove(ws, args);
      case 'b/block': return handleBlock(ws, args);
      case 'b/unblock': return handleUnblock(ws, args);
      default:
        return sendSocial(ws, 'error', { success: false, error: 'Unknown social command.' });
    }
  } catch (e) {
    logger.error('processSocialCommand error', { code, err: String(e) });
    try {
      sendSocial(ws, 'error', { success: false, error: 'Server error.' });
    } catch (_) {}
  }
}

module.exports = {
  processSocialCommand,
  isBlocked,
};
