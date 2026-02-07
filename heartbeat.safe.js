'use strict';

/**
 * Safe WebSocket heartbeat for the `ws` library.
 *
 * Design goals:
 * - Do NOT disconnect players just for being idle.
 * - Only disconnect when the socket stops responding (no pong AND no inbound messages).
 * - Be tolerant of hiccups (requires multiple missed intervals before termination).
 * - Idempotent: calling startHeartbeat() twice does nothing.
 *
 * Usage (server):
 *   const { startHeartbeat, attachHeartbeat } = require('./heartbeat.safe');
 *   wss.on('connection', (ws) => attachHeartbeat(ws));
 *   startHeartbeat(wss, { logger });
 */

const WebSocket = require('ws');

function nowMs() {
  return Date.now();
}

function safeString(err) {
  try {
    return String(err && (err.message || err));
  } catch (_) {
    return 'unknown';
  }
}

function mkLog(logger) {
  // Your project logger appears to be logger.debug('GAME', msg, data)
  // Fall back to console if not provided.
  const has = (k) => logger && typeof logger[k] === 'function';
  return {
    debug: has('debug') ? logger.debug.bind(logger) : () => {},
    info:  has('info')  ? logger.info.bind(logger)  : () => {},
    warn:  has('warn')  ? logger.warn.bind(logger)  : () => {},
    error: has('error') ? logger.error.bind(logger) : () => {},
  };
}

/**
 * Attach per-socket tracking. Safe to call multiple times.
 * Tracks both 'pong' and any inbound 'message' as liveness.
 */
function attachHeartbeat(ws) {
  if (!ws || typeof ws !== 'object') return null;
  if (ws._hb) return ws._hb;

  const t = nowMs();
  ws._hb = {
    lastSeenAt: t,   // updated on ANY inbound message or pong
    lastPongAt: t,   // updated on pong
    lastPingAt: 0,   // updated when server sends ping
  };

  // Any inbound traffic means the connection is alive.
  ws.on('message', () => {
    if (ws._hb) ws._hb.lastSeenAt = nowMs();
  });

  // Standard pong tracking.
  ws.on('pong', () => {
    const t2 = nowMs();
    if (ws._hb) {
      ws._hb.lastPongAt = t2;
      ws._hb.lastSeenAt = t2;
    }
  });

  return ws._hb;
}

/**
 * Start a single heartbeat interval on a WebSocketServer.
 *
 * Options:
 * - pingIntervalMs: how often to ping (default 30s)
 * - deadTimeoutMs: how long a socket can be silent (no pong and no inbound messages)
 *                  before being terminated (default 3 minutes). This is NOT "idle timeout"
 *                  because pings are sent regularly and clients auto-pong.
 * - terminateGraceMs: delay between close() and terminate() (default 1000ms)
 * - logger: your logger instance (optional)
 */
function startHeartbeat(wss, opts = {}) {
  if (!wss || typeof wss !== 'object') {
    throw new TypeError('startHeartbeat(wss): wss is required');
  }

  // Idempotent: if already started, do nothing.
  if (wss._hbTimer) return wss._hbTimer;

  const pingIntervalMs = Number.isFinite(opts.pingIntervalMs) ? opts.pingIntervalMs : 30_000;

  // Require at least 3 missed-ish intervals before killing.
  const requestedDeadTimeout = Number.isFinite(opts.deadTimeoutMs) ? opts.deadTimeoutMs : 180_000;
  const deadTimeoutMs = Math.max(requestedDeadTimeout, pingIntervalMs * 3);

  const terminateGraceMs = Number.isFinite(opts.terminateGraceMs) ? opts.terminateGraceMs : 1_000;
  const log = mkLog(opts.logger);

  // If you forget to attach in your connection handler, this ensures sockets still get tracking.
  // (attachHeartbeat() is idempotent, so it's safe even if you already do it elsewhere.)
  wss.on('connection', (ws) => attachHeartbeat(ws));

  wss._hbTimer = setInterval(() => {
    const t = nowMs();

    for (const ws of wss.clients) {
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;

      const hb = attachHeartbeat(ws);
      if (!hb) continue;

      const lastLiveAt = Math.max(hb.lastSeenAt || 0, hb.lastPongAt || 0);
      const silentForMs = t - lastLiveAt;

      if (silentForMs > deadTimeoutMs) {
        // Dead socket (no pong and no inbound messages for deadTimeoutMs).
        log.debug('GAME', 'Terminating dead connection', {
          userId: ws.userId,
          silentForMs,
          deadTimeoutMs,
        });

        // Try graceful close first so the client can see a reason if it’s still responsive.
        try { ws.close(4000, 'heartbeat timeout'); } catch (_) {}

        // Hard terminate after a short grace period.
        setTimeout(() => {
          try { ws.terminate(); } catch (_) {}
        }, terminateGraceMs);

        continue;
      }

      // Ping regularly. Idle players will auto-pong and stay connected indefinitely.
      try {
        hb.lastPingAt = t;
        ws.ping();
      } catch (err) {
        log.warn('GAME', 'Heartbeat ping failed; terminating connection', {
          userId: ws.userId,
          error: safeString(err),
        });
        try { ws.terminate(); } catch (_) {}
      }
    }
  }, pingIntervalMs);

  // Allow Node to exit if this timer is the only thing left (useful in dev/test).
  if (typeof wss._hbTimer.unref === 'function') wss._hbTimer.unref();

  log.debug('GAME', 'Heartbeat started', { pingIntervalMs, deadTimeoutMs });

  // Clean up if the server is closed.
  wss.once('close', () => stopHeartbeat(wss, { logger: opts.logger }));

  return wss._hbTimer;
}

function stopHeartbeat(wss, { logger } = {}) {
  if (!wss || typeof wss !== 'object') return;
  const log = mkLog(logger);

  if (wss._hbTimer) {
    clearInterval(wss._hbTimer);
    wss._hbTimer = null;
    log.debug('GAME', 'Heartbeat stopped');
  }
}

module.exports = {
  attachHeartbeat,
  startHeartbeat,
  stopHeartbeat,
};
