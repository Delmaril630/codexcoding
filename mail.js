/**
 * Player Mail System - Server Side
 *
 * Commands (broadcast codes):
 * - m/send [toUsername, subject, body]
 * - m/list []
 * - m/read [box, id]          box: "inbox" | "sent" (optional; defaults to "inbox")
 * - m/delete [box, id]        box: "inbox" | "sent" (optional; defaults to "inbox")
 * - m/clear [scope]           scope: "mail" | "inbox" | "sent" (optional; defaults to "mail")
 *                             ("mail" clears inbox non-requests + all sent)
 *
 * Responses (direct RECV to requester, group "mail"):
 * - m/send/res   { success, error? }
 * - m/list/res   { inbox: MailSummary[], sent: MailSummary[] }
 * - m/read/res   { success, error?, message? }
 * - m/delete/res { success, error? }
 * - m/clear/res  { success, error?, scope }
 *
 * Push notification (direct RECV to recipient, group "mail"):
 * - mail/new     MailSummary
 */

const users = require('../database/users');
const storage = require('../database/storage');
const logger = require('../utils/logger');
const { createRecv } = require('./protocol');

const MAIL_KEY = 'mail';
const SOCIAL_KEY = 'social';
const MAX_INBOX = 200;
const MAX_SENT = 200;
const MAX_SUBJECT = 40;
const MAX_BODY = 1000;

function now() { return Date.now(); }

function sendResponse(ws, code, data) {
  try {
    ws.send(createRecv('mail', 'server', code, [data]));
  } catch (err) {
    logger.error('MAIL', 'Failed to sendResponse', { userId: ws.userId, code, error: err.message });
  }
}

function sendToUser(userId, code, data) {
  const conn = global.connections?.get(userId);
  if (!conn || conn.readyState !== 1) return false;
  try {
    conn.send(createRecv('mail', 'server', code, [data]));
    return true;
  } catch (err) {
    logger.error('MAIL', 'Failed to sendToUser', { userId, code, error: err.message });
    return false;
  }
}

function getMailbox(userId) {
  const box = storage.getPersonal(userId, MAIL_KEY);
  if (box && typeof box === 'object') {
    if (!Array.isArray(box.inbox)) box.inbox = [];
    if (!Array.isArray(box.sent)) box.sent = [];
    if (typeof box.nextId !== 'number') box.nextId = 1;
    return box;
  }
  return { nextId: 1, inbox: [], sent: [] };
}

function isBlockedByRecipient(toUserId, fromUserId) {
  try {
    const social = storage.getPersonal(toUserId, SOCIAL_KEY);
    if (!social || !Array.isArray(social.blocks)) return false;
    const fromKey = String(fromUserId ?? '');
    return social.blocks.some((b) => String(b) === fromKey);
  } catch (_) {
    return false;
  }
}

function saveMailbox(userId, mailbox) {
  storage.setPersonal(userId, MAIL_KEY, mailbox);
}

function clampString(value, maxLen) {
  const s = (value === undefined || value === null) ? '' : String(value);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeBoxName(box) {
  const b = String(box || 'inbox').toLowerCase();
  return (b === 'sent') ? 'sent' : 'inbox';
}

function capArray(arr, max) {
  if (!Array.isArray(arr)) return;
  if (arr.length <= max) return;
  arr.splice(0, arr.length - max);
}

function isRequestType(type) {
  const t = String(type || '').toLowerCase();
  return t === 'friend_request' || t === 'guild_invite';
}

function makeSummary(msg) {
  return {
    id: msg.id,
    fromUsername: msg.fromUsername,
    toUsername: msg.toUsername,
    subject: msg.subject,
    timestamp: msg.timestamp,
    read: !!msg.read,
    type: msg.type || 'mail'
  };
}

function findMessage(mailbox, boxName, id) {
  const list = (boxName === 'sent') ? mailbox.sent : mailbox.inbox;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  return list.find(m => m && m.id === numId) || null;
}

function deleteMessage(mailbox, boxName, id) {
  const list = (boxName === 'sent') ? mailbox.sent : mailbox.inbox;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return false;
  const index = list.findIndex(m => m && m.id === numId);
  if (index < 0) return false;
  list.splice(index, 1);
  return true;
}

function handleSend(ws, args) {
  const fromId = ws.userId;
  const fromUsername = ws.username || String(fromId);

  const toUsernameRaw = args?.[0];
  const subjectRaw = args?.[1];
  const bodyRaw = args?.[2];

  const toUsername = clampString(toUsernameRaw, 24).trim();
  const subject = clampString(subjectRaw, MAX_SUBJECT).trim() || '(No Subject)';
  const body = clampString(bodyRaw, MAX_BODY).trim();

  if (!toUsername) {
    sendResponse(ws, 'm/send/res', { success: false, error: 'Recipient username required.' });
    return true;
  }
  if (!body) {
    sendResponse(ws, 'm/send/res', { success: false, error: 'Message body cannot be empty.' });
    return true;
  }

  const targetUser = users.getByUsername(toUsername);
  if (!targetUser) {
    sendResponse(ws, 'm/send/res', { success: false, error: `User not found: ${toUsername}` });
    return true;
  }

  const targetId = targetUser.id;

  // SECURITY: Respect recipient blocklist — blocked senders cannot deliver mail.
  if (isBlockedByRecipient(targetId, fromId)) {
    sendResponse(ws, 'm/send/res', { success: false, error: 'Recipient is unavailable.' });
    return true;
  }

  // Create message for recipient
  const recipientBox = getMailbox(targetId);
  const messageId = recipientBox.nextId++;
  const message = {
    id: messageId,
    fromId,
    fromUsername,
    toId: targetId,
    toUsername: targetUser.username || toUsername,
    subject,
    body,
    timestamp: now(),
    read: false
  };

  recipientBox.inbox.push(message);
  capArray(recipientBox.inbox, MAX_INBOX);
  saveMailbox(targetId, recipientBox);

  // Store copy in sender "sent"
  const senderBox = getMailbox(fromId);
  const sentCopy = { ...message, read: true }; // sent is always "read"
  senderBox.sent.push(sentCopy);
  capArray(senderBox.sent, MAX_SENT);
  saveMailbox(fromId, senderBox);

  // Notify recipient if online
  sendToUser(targetId, 'mail/new', makeSummary(message));

  sendResponse(ws, 'm/send/res', { success: true });

  logger.info('MAIL', 'Mail sent', { fromId, to: targetId, subjectLen: subject.length, bodyLen: body.length });
  return true;
}

function handleList(ws) {
  const userId = ws.userId;
  const box = getMailbox(userId);

  // Sort newest first
  const inbox = [...box.inbox].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(makeSummary);
  const sent = [...box.sent].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).map(makeSummary);

  sendResponse(ws, 'm/list/res', { inbox, sent });
  return true;
}

function handleRead(ws, args) {
  const userId = ws.userId;
  const boxName = normalizeBoxName(args?.[0]);
  const id = (args?.length >= 2) ? args[1] : args?.[0]; // allow m/read [id]

  const box = getMailbox(userId);
  const msg = findMessage(box, boxName, id);
  if (!msg) {
    sendResponse(ws, 'm/read/res', { success: false, error: 'Message not found.' });
    return true;
  }

  if (boxName === 'inbox') {
    msg.read = true;
    saveMailbox(userId, box);
  }

  sendResponse(ws, 'm/read/res', {
    success: true,
    message: {
      id: msg.id,
      fromUsername: msg.fromUsername,
      toUsername: msg.toUsername,
      subject: msg.subject,
      body: msg.body,
      timestamp: msg.timestamp,
      read: !!msg.read
    }
  });
  return true;
}

function handleDelete(ws, args) {
  const userId = ws.userId;
  const boxName = normalizeBoxName(args?.[0]);
  const id = (args?.length >= 2) ? args[1] : args?.[0]; // allow m/delete [id]

  const box = getMailbox(userId);
  const ok = deleteMessage(box, boxName, id);
  if (!ok) {
    sendResponse(ws, 'm/delete/res', { success: false, error: 'Message not found.' });
    return true;
  }

  saveMailbox(userId, box);
  sendResponse(ws, 'm/delete/res', { success: true });
  return true;
}

function handleClear(ws, args) {
  const userId = ws.userId;
  const scopeRaw = args?.[0];
  const scope = String(scopeRaw || 'mail').toLowerCase();

  const box = getMailbox(userId);
  let changed = false;

  // Clear sent (always safe)
  if (scope === 'mail' || scope === 'sent') {
    if (box.sent.length > 0) {
      box.sent = [];
      changed = true;
    }
  }

  // Clear inbox (but keep request-type entries by default)
  if (scope === 'mail' || scope === 'inbox') {
    const before = box.inbox.length;
    box.inbox = box.inbox.filter(m => m && isRequestType(m.type));
    if (box.inbox.length !== before) changed = true;
  }

  if (changed) saveMailbox(userId, box);

  sendResponse(ws, 'm/clear/res', { success: true, scope });
  return true;
}

function processMailCommand(ws, code, args) {
  try {
    switch (code) {
      case 'm/send':
        return handleSend(ws, args);
      case 'm/list':
        return handleList(ws);
      case 'm/read':
        return handleRead(ws, args);
      case 'm/delete':
        return handleDelete(ws, args);
      case 'm/clear':
        return handleClear(ws, args);
      default:
        return false;
    }
  } catch (err) {
    logger.error('MAIL', 'processMailCommand error', { userId: ws.userId, code, error: err.message, stack: err.stack });
    sendResponse(ws, `${code}/res`, { success: false, error: 'Server error.' });
    return true;
  }
}

module.exports = { processMailCommand };
