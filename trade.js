/**
 * Trade Escrow Module (Server Side)
 * 
 * SECURITY FIX #3: Server-side trade validation
 * 
 * Problem: The trade system was entirely client-side. Both players' clients
 * independently deducted and added items via save() calls. This meant:
 *   - A modified client could skip item deduction (free items)
 *   - A disconnect during trade could duplicate or lose items
 *   - A client could lie about what items it offered
 * 
 * Solution: Server-side escrow that:
 *   1. Tracks active trades and each player's offer
 *   2. Intercepts "tradeUpdate" publishes to record offers server-side
 *   3. Intercepts "tradeReady" publishes to track readiness
 *   4. When both ready: validates both inventories, executes atomic swap
 *   5. Sends authoritative "tradeComplete" to both clients
 * 
 * Integration:
 *   - handler.js calls processTradePublish() for trade-channel messages
 *   - handler.js routes trade subscribe/unsubscribe to lifecycle hooks
 *   - Relies on storage module for reading/writing player inventories
 *   - Works alongside economy.js delta validation
 * 
 * Trade Channel Protocol (client publishes to "trade" group):
 *   - "tradeUpdate" args[0] = { gold: number, items: [[[dataClass, id], qty], ...] }
 *   - "tradeReady"  args[0] = null
 * 
 * Trade SENDTO Protocol (client sends directly to other player):
 *   - "tradeRequest"  { name, guid }   -- just P2P signaling, relay as-is
 *   - "tradeAccept"   { guid }
 *   - "tradeReject"   { reason }
 */

const storage = require('../database/storage');
const logger = require('../utils/logger');
const { createRecv } = require('./protocol');

// ============================================================================
// CONFIGURATION
// ============================================================================

const MAX_OFFER_ITEMS = 50;          // Max distinct item stacks per offer
const MAX_TRADE_GOLD = 99999999;     // Max gold in a single trade
const MAX_ITEM_QTY = 9999;           // Max quantity per item stack
const TRADE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min auto-cancel

// Valid item data classes (RPG Maker MZ)
const VALID_DATA_CLASSES = new Set(['item', 'weapon', 'armor']);

// Map dataClass -> storage key
const CLASS_TO_KEY = { 'item': 'item', 'weapon': 'weapon', 'armor': 'armor' };

// ============================================================================
// STATE
// ============================================================================

/**
 * Active trades: guid -> TradeState
 * 
 * TradeState: {
 *   guid, playerA, playerB,
 *   offerA: { gold, items: [{dataClass, itemId, quantity}] },
 *   offerB: { gold, items: [...] },
 *   readyA, readyB, createdAt, executed
 * }
 */
const activeTrades = new Map();
const userToTrade = new Map();  // userId -> guid

// ============================================================================
// LIFECYCLE
// ============================================================================

/**
 * Called when a player subscribes to a trade channel.
 */
function onTradeSubscribe(userId, channel) {
  if (!channel || channel.length < 10) return;

  let trade = activeTrades.get(channel);
  if (!trade) {
    trade = {
      guid: channel,
      playerA: userId,
      playerB: null,
      offerA: { gold: 0, items: [] },
      offerB: { gold: 0, items: [] },
      readyA: false,
      readyB: false,
      createdAt: Date.now(),
      executed: false,
    };
    activeTrades.set(channel, trade);
    userToTrade.set(userId, channel);
    logger.info('TRADE', `Trade created: ${channel.substring(0, 12)}...`, { playerA: userId });
  } else if (!trade.playerB && trade.playerA !== userId) {
    trade.playerB = userId;
    userToTrade.set(userId, channel);
    logger.info('TRADE', `Trade joined`, { playerA: trade.playerA, playerB: userId });
  } else if (trade.playerA === userId || trade.playerB === userId) {
    userToTrade.set(userId, channel);
  } else {
    logger.security('Trade join blocked (full)', { userId, channel: channel.substring(0, 12) });
  }
}

/**
 * Called when a player unsubscribes from a trade channel.
 */
function onTradeUnsubscribe(userId, channel) {
  if (!channel) return;
  const trade = activeTrades.get(channel);
  if (!trade) return;
  if (trade.playerA === userId || trade.playerB === userId) {
    cancelTrade(channel, `Player ${userId} left`);
  }
}

/**
 * Called when a player disconnects.
 */
function onPlayerDisconnect(userId) {
  const guid = userToTrade.get(userId);
  if (!guid) return;
  const trade = activeTrades.get(guid);
  if (trade && !trade.executed) {
    notifyTradeFailed(trade, 'Other player disconnected');
    cancelTrade(guid, `Player ${userId} disconnected`);
  }
  userToTrade.delete(userId);
}

/**
 * Cancel and clean up a trade.
 */
function cancelTrade(guid, reason) {
  const trade = activeTrades.get(guid);
  if (!trade) return;

  logger.info('TRADE', `Trade cancelled`, {
    reason, playerA: trade.playerA, playerB: trade.playerB,
  });

  if (trade.playerA) userToTrade.delete(trade.playerA);
  if (trade.playerB) userToTrade.delete(trade.playerB);
  activeTrades.delete(guid);
}

// ============================================================================
// PUBLISH INTERCEPTOR
// ============================================================================

/**
 * Process a trade-channel PUBLISH message.
 * Called from handler.js when publish group === 'trade'.
 * 
 * @returns {'handled'|'relay'} - 'handled' means don't relay, 'relay' means forward normally
 */
function processTradePublish(ws, code, args, channel) {
  const { userId } = ws;

  switch (code) {
    case 'tradeUpdate':
      return handleTradeUpdate(userId, channel, args);
    case 'tradeReady':
      return handleTradeReady(userId, channel);
    default:
      return 'relay';
  }
}

// ============================================================================
// TRADE UPDATE
// ============================================================================

function handleTradeUpdate(userId, channel, args) {
  const trade = activeTrades.get(channel);
  if (!trade) return 'relay';

  const isA = (trade.playerA === userId);
  const isB = (trade.playerB === userId);
  if (!isA && !isB) {
    logger.security('tradeUpdate from non-participant', { userId });
    return 'handled';
  }

  // Parse and validate
  const offer = args?.[0];
  if (!offer || typeof offer !== 'object') {
    logger.security('tradeUpdate invalid payload', { userId });
    return 'handled';
  }

  const result = validateOffer(offer);
  if (!result.valid) {
    logger.security(`tradeUpdate rejected: ${result.reason}`, { userId });
    return 'handled';
  }

  // Store validated offer; reset ready state
  if (isA) {
    trade.offerA = result.offer;
    trade.readyA = false;
  } else {
    trade.offerB = result.offer;
    trade.readyB = false;
  }

  logger.debug('TRADE', `Offer updated`, {
    userId, gold: result.offer.gold, items: result.offer.items.length,
  });

  return 'relay';
}

// ============================================================================
// TRADE READY + EXECUTION
// ============================================================================

function handleTradeReady(userId, channel) {
  const trade = activeTrades.get(channel);
  if (!trade) return 'relay';

  const isA = (trade.playerA === userId);
  const isB = (trade.playerB === userId);
  if (!isA && !isB) {
    logger.security('tradeReady from non-participant', { userId });
    return 'handled';
  }

  if (trade.executed) {
    logger.warn('TRADE', 'tradeReady on executed trade', { userId });
    return 'handled';
  }

  if (isA) trade.readyA = true;
  if (isB) trade.readyB = true;

  logger.info('TRADE', 'Player ready', {
    userId, readyA: trade.readyA, readyB: trade.readyB,
  });

  // Check both ready
  if (trade.readyA && trade.readyB && trade.playerA && trade.playerB) {
    const result = executeTrade(trade);
    if (result.success) {
      notifyTradeComplete(trade, result);
    } else {
      notifyTradeFailed(trade, result.reason);
      cancelTrade(channel, result.reason);
    }
  }

  return 'relay';
}

// ============================================================================
// OFFER VALIDATION
// ============================================================================

/**
 * Validate and normalize a trade offer from a client.
 * Client format: { gold: number, items: [[[dataClass, itemId], quantity], ...] }
 */
function validateOffer(raw) {
  // Gold
  const gold = raw.gold;
  if (typeof gold !== 'number' || !Number.isFinite(gold) || gold < 0 ||
      gold > MAX_TRADE_GOLD || !Number.isInteger(gold)) {
    return { valid: false, reason: `Invalid gold: ${gold}` };
  }

  // Items
  if (!Array.isArray(raw.items)) {
    return { valid: false, reason: 'Items must be array' };
  }
  if (raw.items.length > MAX_OFFER_ITEMS) {
    return { valid: false, reason: `Too many items: ${raw.items.length}` };
  }

  const items = [];
  for (let i = 0; i < raw.items.length; i++) {
    const entry = raw.items[i];
    if (!Array.isArray(entry) || entry.length !== 2) {
      return { valid: false, reason: `Bad entry at ${i}` };
    }

    const [tuple, quantity] = entry;

    if (typeof quantity !== 'number' || !Number.isFinite(quantity) ||
        quantity <= 0 || quantity > MAX_ITEM_QTY || !Number.isInteger(quantity)) {
      return { valid: false, reason: `Bad qty at ${i}: ${quantity}` };
    }

    if (!Array.isArray(tuple) || tuple.length !== 2) {
      return { valid: false, reason: `Bad tuple at ${i}` };
    }

    const [dataClass, itemId] = tuple;
    if (!VALID_DATA_CLASSES.has(dataClass)) {
      return { valid: false, reason: `Bad class at ${i}: ${dataClass}` };
    }
    if (typeof itemId !== 'number' || !Number.isFinite(itemId) ||
        itemId < 1 || !Number.isInteger(itemId)) {
      return { valid: false, reason: `Bad id at ${i}: ${itemId}` };
    }

    items.push({ dataClass, itemId, quantity });
  }

  return { valid: true, offer: { gold, items } };
}

// ============================================================================
// ATOMIC SWAP
// ============================================================================

/**
 * Execute the trade: validate inventories, deduct from both, add to both.
 */
function executeTrade(trade) {
  const { playerA, playerB, offerA, offerB, guid } = trade;

  if (trade.executed) {
    return { success: false, reason: 'Already executed' };
  }
  trade.executed = true;

  logger.info('TRADE', `Executing trade`, {
    guid: guid.substring(0, 12),
    playerA, playerB,
    offerA: { gold: offerA.gold, itemCount: offerA.items.length },
    offerB: { gold: offerB.gold, itemCount: offerB.items.length },
  });

  // Phase 1: Validate both have what they offered
  const vA = checkInventory(playerA, offerA);
  if (!vA.valid) {
    logger.security('Trade failed: A missing items', { playerA, reason: vA.reason });
    return { success: false, reason: `Player A: ${vA.reason}` };
  }

  const vB = checkInventory(playerB, offerB);
  if (!vB.valid) {
    logger.security('Trade failed: B missing items', { playerB, reason: vB.reason });
    return { success: false, reason: `Player B: ${vB.reason}` };
  }

  // Phase 2: Atomic swap
  try {
    deduct(playerA, offerA);
    deduct(playerB, offerB);
    grant(playerB, offerA); // B gets what A offered
    grant(playerA, offerB); // A gets what B offered

    logger.info('TRADE', 'Trade executed successfully', { guid: guid.substring(0, 12) });
    return { success: true, swappedA: offerA, swappedB: offerB };
  } catch (err) {
    logger.error('TRADE', 'CRITICAL: Trade execution error', {
      guid, error: err.message, playerA, playerB,
    });
    return { success: false, reason: 'Server error during trade' };
  }
}

/**
 * Check that a player has all offered gold + items.
 */
function checkInventory(userId, offer) {
  if (offer.gold > 0) {
    const d = storage.getPersonal(userId, 'gold') || {};
    if ((d.gold ?? 0) < offer.gold) {
      return { valid: false, reason: `Not enough gold (has ${d.gold ?? 0}, need ${offer.gold})` };
    }
  }

  for (const { dataClass, itemId, quantity } of offer.items) {
    const key = CLASS_TO_KEY[dataClass];
    const d = storage.getPersonal(userId, key) || {};
    const has = d[itemId] ?? 0;
    if (has < quantity) {
      return { valid: false, reason: `Not enough ${dataClass}#${itemId} (has ${has}, need ${quantity})` };
    }
  }

  return { valid: true };
}

/**
 * Deduct gold and items from a player.
 */
function deduct(userId, offer) {
  if (offer.gold > 0) {
    const d = storage.getPersonal(userId, 'gold') || {};
    d.gold = Math.max(0, (d.gold ?? 0) - offer.gold);
    storage.setPersonal(userId, 'gold', d);
  }

  const grouped = groupItems(offer.items);
  for (const [key, list] of Object.entries(grouped)) {
    const d = storage.getPersonal(userId, key) || {};
    for (const { itemId, quantity } of list) {
      const cur = d[itemId] ?? 0;
      const nv = cur - quantity;
      if (nv > 0) d[itemId] = nv;
      else delete d[itemId];
    }
    storage.setPersonal(userId, key, d);
  }
}

/**
 * Add gold and items to a player.
 */
function grant(userId, offer) {
  if (offer.gold > 0) {
    const d = storage.getPersonal(userId, 'gold') || {};
    d.gold = Math.min((d.gold ?? 0) + offer.gold, MAX_TRADE_GOLD);
    storage.setPersonal(userId, 'gold', d);
  }

  const grouped = groupItems(offer.items);
  for (const [key, list] of Object.entries(grouped)) {
    const d = storage.getPersonal(userId, key) || {};
    for (const { itemId, quantity } of list) {
      d[itemId] = Math.min((d[itemId] ?? 0) + quantity, MAX_ITEM_QTY);
    }
    storage.setPersonal(userId, key, d);
  }
}

function groupItems(items) {
  const g = {};
  for (const { dataClass, itemId, quantity } of items) {
    const k = CLASS_TO_KEY[dataClass];
    if (!g[k]) g[k] = [];
    g[k].push({ itemId, quantity });
  }
  return g;
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function notifyTradeComplete(trade, result) {
  const { playerA, playerB, guid } = trade;
  const conns = global.connections;

  const base = { success: true, guid };

  // Player A receives B's offer, sent A's offer
  sendToPlayer(conns, playerA, 'trade/serverComplete', {
    ...base,
    received: serialize(result.swappedB),
    sent: serialize(result.swappedA),
  });

  // Player B receives A's offer, sent B's offer
  sendToPlayer(conns, playerB, 'trade/serverComplete', {
    ...base,
    received: serialize(result.swappedA),
    sent: serialize(result.swappedB),
  });

  cancelTrade(guid, 'completed');
}

function notifyTradeFailed(trade, reason) {
  const { playerA, playerB, guid } = trade;
  const conns = global.connections;
  const payload = { success: false, guid, reason: reason || 'Validation failed' };

  for (const uid of [playerA, playerB]) {
    if (uid) sendToPlayer(conns, uid, 'trade/serverFailed', payload);
  }
}

function sendToPlayer(conns, userId, code, payload) {
  if (!userId || !conns) return;
  const ws = conns.get(userId);
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(createRecv('trade', 'server', code, [payload]));
  } catch (e) {
    logger.error('TRADE', `Failed to send ${code}`, { userId, error: e.message });
  }
}

function serialize(offer) {
  return {
    gold: offer.gold,
    items: offer.items.map(({ dataClass, itemId, quantity }) => [[dataClass, itemId], quantity]),
  };
}

// ============================================================================
// CLEANUP
// ============================================================================

function cleanupStaleTrades() {
  const now = Date.now();
  const stale = [];
  for (const [guid, trade] of activeTrades.entries()) {
    if (now - trade.createdAt > TRADE_TIMEOUT_MS) stale.push(guid);
  }
  for (const guid of stale) {
    const trade = activeTrades.get(guid);
    if (trade) notifyTradeFailed(trade, 'Trade timed out');
    cancelTrade(guid, 'timeout');
  }
  if (stale.length > 0) {
    logger.info('TRADE', `Cleaned ${stale.length} stale trades`);
  }
}

setInterval(cleanupStaleTrades, 60 * 1000);

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  onTradeSubscribe,
  onTradeUnsubscribe,
  onPlayerDisconnect,
  processTradePublish,
  getActiveTrades: () => activeTrades,
  cancelTrade,
};
