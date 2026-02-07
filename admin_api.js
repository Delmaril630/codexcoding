
/**
 * Admin API for the /admin panel (REST)
 *
 * Your admin HTML expects endpoints under /api/admin/* (see admin/login.html and admin/index.html). fileciteturn4file0 fileciteturn4file1
 *
 * This file provides those endpoints with:
 * - Simple password login (env-based) => bearer token
 * - Token auth middleware
 * - A few useful endpoints implemented now (dashboard, pubsub, announce, reload-data stub)
 *
 * NOTE:
 * - This avoids depending on unknown users/password hashing in your DB layer.
 * - Set ADMIN_USER and ADMIN_PASS env vars before starting the server.
 *
 * Usage (Express):
 *   const express = require('express');
 *   const app = express();
 *   app.use(express.json());
 *   require('./admin_api').installAdminApi(app, { basePath: '/api/admin' });
 */

const crypto = require('crypto');

const pubsub = require('./pubsub');
const logger = require('../utils/logger');

// In-memory sessions: token -> { user, createdAt, expiresAt }
const sessions = new Map();

// Default 12h session lifetime
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function now() { return Date.now(); }

function getEnv(name, fallback = '') {
  const v = process.env[name];
  return (v === undefined || v === null) ? fallback : String(v);
}

function json(res, status, obj) {
  res.status(status).json(obj);
}

function mintToken() {
  // 32 bytes url-safe
  return crypto.randomBytes(32).toString('base64url');
}

function pruneSessions() {
  const t = now();
  for (const [token, s] of sessions) {
    if (!s || s.expiresAt <= t) sessions.delete(token);
  }
}

function authMiddleware(opts = {}) {
  const headerName = (opts.headerName || 'authorization').toLowerCase();
  return function (req, res, next) {
    pruneSessions();

    const raw = req.headers[headerName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    const m = String(value || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return json(res, 401, { error: 'Missing token' });

    const token = m[1].trim();
    const session = sessions.get(token);
    if (!session) return json(res, 401, { error: 'Invalid token' });
    if (session.expiresAt <= now()) {
      sessions.delete(token);
      return json(res, 401, { error: 'Expired token' });
    }

    req.admin = session.user;
    req.adminToken = token;
    next();
  };
}

function requireExpressLike(app) {
  if (!app || typeof app.post !== 'function' || typeof app.get !== 'function') {
    throw new Error('installAdminApi expected an Express-like app (app.get/app.post).');
  }
}

function installAdminApi(app, options = {}) {
  requireExpressLike(app);

  const basePath = options.basePath || '/api/admin';
  const ttlMs = Number(options.sessionTtlMs || DEFAULT_SESSION_TTL_MS);

  const ADMIN_USER = getEnv('ADMIN_USER', 'admin');
  const ADMIN_PASS = getEnv('ADMIN_PASS', '');

  if (!ADMIN_PASS) {
    logger.warn('ADMIN', 'ADMIN_PASS is empty. Admin API is effectively disabled until you set it.');
  }

  // ---- LOGIN ----
  // POST /api/admin/login { username, password } => { token, user }
  app.post(`${basePath}/login`, (req, res) => {
    const { username, password } = req.body || {};
    if (!ADMIN_PASS) return json(res, 503, { error: 'Admin login not configured' });

    if (String(username || '') !== ADMIN_USER || String(password || '') !== ADMIN_PASS) {
      logger.warn('ADMIN', 'Admin login failed', { ip: req.ip || req.socket?.remoteAddress });
      return json(res, 401, { error: 'Invalid credentials' });
    }

    const token = mintToken();
    const createdAt = now();
    const expiresAt = createdAt + ttlMs;

    const user = { username: ADMIN_USER, role: 'admin' };
    sessions.set(token, { user, createdAt, expiresAt });

    logger.info('ADMIN', 'Admin login ok', { user: ADMIN_USER });

    return json(res, 200, { token, user });
  });

  // All endpoints below require bearer token
  const requireAdmin = authMiddleware();

  // ---- DASHBOARD ----
  // GET /api/admin/dashboard
  app.get(`${basePath}/dashboard`, requireAdmin, async (req, res) => {
    const online = global.connections ? Array.from(global.connections.values()).filter(c => c && c.readyState === 1).length : 0;

    // Minimal stats that we can compute from current server modules
    const pubsubStats = pubsub.getStats ? pubsub.getStats() : { groups: 0, channels: 0, connections: 0 };

    // These are placeholders until your DB layer is wired here
    return json(res, 200, {
      online,
      totalUsers: null,
      flaggedUsers: null,
      pendingReports: null,
      recentActivity: [],
      pubsub: pubsubStats
    });
  });

  // ---- PLAYERS (stub for now) ----
  app.get(`${basePath}/players`, requireAdmin, async (req, res) => {
    return json(res, 501, { error: 'Not implemented: wire users database functions here.' });
  });

  app.get(`${basePath}/players/online`, requireAdmin, async (req, res) => {
    const out = [];
    if (global.connections) {
      for (const [id, conn] of global.connections) {
        if (conn && conn.readyState === 1) {
          out.push({
            id,
            username: conn.username || String(id),
            isAdmin: !!conn.isAdmin,
            connectedAt: conn.connectedAt || null,
            ip: conn.ip || null
          });
        }
      }
    }
    return json(res, 200, out);
  });

  app.post(`${basePath}/players/:id/kick`, requireAdmin, async (req, res) => {
    const id = String(req.params.id || '');
    const conn = global.connections?.get(id);
    if (!conn) return json(res, 404, { error: 'Player not online' });

    try {
      conn.close(1000, 'Kicked by admin panel');
      return json(res, 200, { success: true });
    } catch (e) {
      return json(res, 500, { error: 'Kick failed' });
    }
  });

  // ---- REPORTS/LOGS/STORAGE (stubs) ----
  app.get(`${basePath}/reports`, requireAdmin, async (req, res) => json(res, 501, { error: 'Not implemented' }));
  app.post(`${basePath}/reports/:id/resolve`, requireAdmin, async (req, res) => json(res, 501, { error: 'Not implemented' }));
  app.get(`${basePath}/logs`, requireAdmin, async (req, res) => json(res, 501, { error: 'Not implemented' }));
  app.get(`${basePath}/global-storage`, requireAdmin, async (req, res) => json(res, 501, { error: 'Not implemented' }));
  app.delete(`${basePath}/global-storage/:key`, requireAdmin, async (req, res) => json(res, 501, { error: 'Not implemented' }));

  // ---- PUBSUB ----
  app.get(`${basePath}/pubsub`, requireAdmin, async (req, res) => {
    const details = pubsub.getDetailedStats ? pubsub.getDetailedStats() : [];
    return json(res, 200, details.map(d => ({
      group: d.group,
      channel: d.channel,
      subscribers: d.subscribers
    })));
  });

  // ---- ANNOUNCE ----
  // POST /api/admin/announce { message }
  app.post(`${basePath}/announce`, requireAdmin, async (req, res) => {
    const message = String(req.body?.message || '').trim();
    if (!message) return json(res, 400, { error: 'Missing message' });

    let sent = 0;
    if (global.connections) {
      const { createRecv } = require('./protocol');
      const announceMsg = createRecv('system', 'server', '@/announce', [message]);
      for (const conn of global.connections.values()) {
        if (conn && conn.readyState === 1) {
          try { conn.send(announceMsg); sent++; } catch (_) {}
        }
      }
    }

    logger.info('ADMIN', 'Announcement sent', { by: req.admin?.username, sent });
    return json(res, 200, { sent });
  });

  // ---- RELOAD DATA (stub hook) ----
  app.post(`${basePath}/reload-data`, requireAdmin, async (req, res) => {
    // If you have a dataloader module, call it here.
    logger.warn('ADMIN', 'reload-data called (stub)', { by: req.admin?.username });
    return json(res, 200, { success: true, note: 'Stub: wire your data reload here.' });
  });

  return { sessions };
}

module.exports = { installAdminApi };
