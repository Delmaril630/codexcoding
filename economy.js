/**
 * Economy Validation Module (Server Side)
 * 
 * Two-lane validation system for game economy data:
 * 
 * LANE 1: Normal Saves (delta-capped)
 *   Client calls client.save("gold", ...) etc.
 *   Server checks that changes are within reasonable deltas.
 *   Covers: shop purchases, battle drops, small quest rewards.
 * 
 * LANE 2: Server-Authorized Rewards
 *   For large/special rewards (event completions, boss kills, etc.)
 *   Client broadcasts "reward/claim" with event context.
 *   Server verifies eligibility, writes reward directly.
 *   Tamper-proof: server decides the amount, not the client.
 * 
 * IMPORTANT FOR DEVELOPMENT:
 *   - devMode (below) relaxes delta caps and logs warnings instead of rejecting.
 *   - When adding new items to the game database client-side, devMode allows
 *     those items to be saved without tripping unknown-item checks.
 *   - Set devMode = false before public launch.
 * 
 * Storage Keys Validated:
 *   - "gold"    -> { gold: number }
 *   - "item"    -> { [itemId]: quantity }
 *   - "weapon"  -> { [weaponId]: quantity }
 *   - "armor"   -> { [armorId]: quantity }
 *   - "actor"   -> { [actorId]: { ...actorData } }
 */

const storage = require('../database/storage');
const logger = require('../utils/logger');
const { createRecv } = require('./protocol');

// ============================================================================
// CONFIGURATION
// ============================================================================

// Set to true during development — relaxes checks and logs instead of rejecting
const devMode = true;

// Lane 1: Delta caps for normal saves
const LIMITS = {
  // Gold
  GOLD_MAX_GAIN_PER_SAVE: 100000,
  GOLD_MAX_LOSS_PER_SAVE: 100000,
  GOLD_ABSOLUTE_MAX: 99999999,

  // Items (per item per save)
  ITEM_MAX_GAIN_PER_SAVE: 99,
  ITEM_MAX_STACK: 9999,
  ITEM_MIN_ID: 1,
  ITEM_MAX_ID: 5000,

  // Weapons / Armor
  EQUIP_MAX_GAIN_PER_SAVE: 10,
  EQUIP_MAX_STACK: 999,
  EQUIP_MIN_ID: 1,
  EQUIP_MAX_ID: 5000,

  // Actor / Stats
  ACTOR_MAX_LEVEL: 999,
  ACTOR_MAX_LEVEL_GAIN_PER_SAVE: 10,
  ACTOR_MAX_HP: 999999,
  ACTOR_MAX_MP: 99999,
  ACTOR_MAX_STAT: 9999,
  ACTOR_MAX_EXP_GAIN_PER_SAVE: 500000,
};

// Lane 2: Server-authorized reward registry
const rewardRegistry = new Map();

// Track claimed one-time rewards: Set of "userId:eventKey"
const claimedRewards = new Set();

// ============================================================================
// LANE 1: DELTA VALIDATION
// ============================================================================

function validateGold(userId, fields, existing) {
  const newGold = fields?.gold;
  const oldGold = existing?.gold ?? 0;

  if (typeof newGold !== 'number' || !Number.isFinite(newGold) || newGold < 0) {
    return { valid: false, reason: 'Invalid gold value', anomaly: { type: 'invalid_gold', newGold } };
  }

  if (newGold > LIMITS.GOLD_ABSOLUTE_MAX) {
    return { valid: false, reason: `Gold exceeds cap (${LIMITS.GOLD_ABSOLUTE_MAX})`, anomaly: { type: 'gold_cap_exceeded', newGold } };
  }

  const delta = newGold - oldGold;

  if (delta > LIMITS.GOLD_MAX_GAIN_PER_SAVE) {
    if (devMode) {
      logger.warn('ECONOMY', `[DEV] Gold gain ${delta} exceeds cap ${LIMITS.GOLD_MAX_GAIN_PER_SAVE}`, { userId, oldGold, newGold });
      return { valid: true };
    }
    return { valid: false, reason: `Gold gain too large (${delta})`, anomaly: { type: 'suspicious_gold_gain', delta, oldGold, newGold } };
  }

  if (-delta > LIMITS.GOLD_MAX_LOSS_PER_SAVE) {
    if (devMode) {
      logger.warn('ECONOMY', `[DEV] Gold loss ${-delta} exceeds cap`, { userId, oldGold, newGold });
      return { valid: true };
    }
    return { valid: false, reason: `Gold loss too large (${-delta})`, anomaly: { type: 'suspicious_gold_loss', delta, oldGold, newGold } };
  }

  return { valid: true };
}

function validateInventory(userId, keyName, fields, existing, limits) {
  const { maxGain, maxStack, minId, maxId } = limits;

  if (typeof fields !== 'object' || fields === null) {
    return { valid: false, reason: `Invalid ${keyName} payload` };
  }

  for (const [rawId, quantity] of Object.entries(fields)) {
    const id = Number(rawId);

    if (!Number.isFinite(id) || id < minId) {
      if (devMode) {
        logger.warn('ECONOMY', `[DEV] ${keyName} ID out of range: ${rawId}`, { userId });
        continue;
      }
      return { valid: false, reason: `Invalid ${keyName} ID: ${rawId}`, anomaly: { type: `invalid_${keyName}_id`, id: rawId } };
    }

    if (id > maxId) {
      if (devMode) {
        logger.warn('ECONOMY', `[DEV] ${keyName} ID ${id} exceeds maxId ${maxId} — new item?`, { userId });
        continue;
      }
      return { valid: false, reason: `${keyName} ID ${id} exceeds max`, anomaly: { type: `unknown_${keyName}_id`, id } };
    }

    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
      return { valid: false, reason: `Invalid ${keyName} quantity for ID ${id}`, anomaly: { type: `invalid_${keyName}_qty`, id, quantity } };
    }

    if (quantity > maxStack) {
      if (devMode) {
        logger.warn('ECONOMY', `[DEV] ${keyName} ID ${id} qty ${quantity} exceeds stack cap ${maxStack}`, { userId });
        continue;
      }
      return { valid: false, reason: `${keyName} ID ${id} exceeds stack cap`, anomaly: { type: `${keyName}_stack_exceeded`, id, quantity } };
    }

    const oldQty = existing?.[rawId] ?? 0;
    const delta = quantity - oldQty;

    if (delta > maxGain) {
      if (devMode) {
        logger.warn('ECONOMY', `[DEV] ${keyName} ID ${id} gain ${delta} exceeds cap ${maxGain}`, { userId });
        continue;
      }
      return { valid: false, reason: `${keyName} ID ${id} gain too large (${delta})`, anomaly: { type: `suspicious_${keyName}_gain`, id, delta } };
    }
  }

  return { valid: true };
}

function validateActor(userId, fields, existing) {
  if (typeof fields !== 'object' || fields === null) {
    return { valid: false, reason: 'Invalid actor payload' };
  }

  for (const [actorId, actorData] of Object.entries(fields)) {
    if (typeof actorData !== 'object' || actorData === null) continue;

    const oldActor = existing?.[actorId] || {};

    // Level check
    if (actorData.level !== undefined) {
      if (typeof actorData.level !== 'number' || actorData.level < 1 || actorData.level > LIMITS.ACTOR_MAX_LEVEL) {
        if (devMode) {
          logger.warn('ECONOMY', `[DEV] Actor ${actorId} level ${actorData.level} out of range`, { userId });
        } else {
          return { valid: false, reason: `Actor ${actorId} level out of range`, anomaly: { type: 'invalid_actor_level', actorId, level: actorData.level } };
        }
      }

      const oldLevel = oldActor.level || 1;
      const levelGain = actorData.level - oldLevel;
      if (levelGain > LIMITS.ACTOR_MAX_LEVEL_GAIN_PER_SAVE) {
        if (devMode) {
          logger.warn('ECONOMY', `[DEV] Actor ${actorId} leveled up ${levelGain} times in one save`, { userId });
        } else {
          return { valid: false, reason: `Actor ${actorId} leveled too fast`, anomaly: { type: 'suspicious_level_gain', actorId, levelGain } };
        }
      }
    }

    // EXP check
    if (actorData.exp !== undefined) {
      const oldExp = oldActor.exp || 0;
      const expGain = (actorData.exp || 0) - oldExp;
      if (expGain > LIMITS.ACTOR_MAX_EXP_GAIN_PER_SAVE) {
        if (devMode) {
          logger.warn('ECONOMY', `[DEV] Actor ${actorId} exp gain ${expGain} exceeds cap`, { userId });
        } else {
          return { valid: false, reason: `Actor ${actorId} exp gain too large`, anomaly: { type: 'suspicious_exp_gain', actorId, expGain } };
        }
      }
    }

    // Stat caps
    const statChecks = [
      { key: 'hp', max: LIMITS.ACTOR_MAX_HP },
      { key: 'mp', max: LIMITS.ACTOR_MAX_MP },
      { key: 'maxHp', max: LIMITS.ACTOR_MAX_HP },
      { key: 'maxMp', max: LIMITS.ACTOR_MAX_MP },
      { key: 'atk', max: LIMITS.ACTOR_MAX_STAT },
      { key: 'def', max: LIMITS.ACTOR_MAX_STAT },
      { key: 'mat', max: LIMITS.ACTOR_MAX_STAT },
      { key: 'mdf', max: LIMITS.ACTOR_MAX_STAT },
      { key: 'agi', max: LIMITS.ACTOR_MAX_STAT },
      { key: 'luk', max: LIMITS.ACTOR_MAX_STAT },
    ];

    for (const { key, max } of statChecks) {
      if (actorData[key] !== undefined) {
        if (typeof actorData[key] !== 'number' || actorData[key] < 0 || actorData[key] > max) {
          if (devMode) {
            logger.warn('ECONOMY', `[DEV] Actor ${actorId} stat ${key}=${actorData[key]} out of range (max ${max})`, { userId });
          } else {
            return { valid: false, reason: `Actor ${actorId} stat ${key} out of range`, anomaly: { type: 'invalid_actor_stat', actorId, stat: key, value: actorData[key] } };
          }
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Master validation dispatcher — called from handler.js handleSave
 */
function validateEconomySave(userId, keyName, fields, existing) {
  switch (keyName) {
    case 'gold':
      return validateGold(userId, fields, existing);
    case 'item':
      return validateInventory(userId, keyName, fields, existing, {
        maxGain: LIMITS.ITEM_MAX_GAIN_PER_SAVE,
        maxStack: LIMITS.ITEM_MAX_STACK,
        minId: LIMITS.ITEM_MIN_ID,
        maxId: LIMITS.ITEM_MAX_ID,
      });
    case 'weapon':
      return validateInventory(userId, keyName, fields, existing, {
        maxGain: LIMITS.EQUIP_MAX_GAIN_PER_SAVE,
        maxStack: LIMITS.EQUIP_MAX_STACK,
        minId: LIMITS.EQUIP_MIN_ID,
        maxId: LIMITS.EQUIP_MAX_ID,
      });
    case 'armor':
      return validateInventory(userId, keyName, fields, existing, {
        maxGain: LIMITS.EQUIP_MAX_GAIN_PER_SAVE,
        maxStack: LIMITS.EQUIP_MAX_STACK,
        minId: LIMITS.EQUIP_MIN_ID,
        maxId: LIMITS.EQUIP_MAX_ID,
      });
    case 'actor':
      return validateActor(userId, fields, existing);
    default:
      return { valid: true };
  }
}


// ============================================================================
// LANE 2: SERVER-AUTHORIZED REWARDS
// ============================================================================

/**
 * Register a reward that can be claimed via broadcast.
 * 
 * @param {string} eventKey - Unique ID (e.g. "quest_dragon_slayer", "event_festival_2025")
 * @param {object} reward - { gold?, items?: [{id,qty}], weapons?: [{id,qty}], armor?: [{id,qty}] }
 * @param {object} options - { oneTime?: boolean, mapId?: number, requireMap?: boolean }
 */
function registerReward(eventKey, reward, options = {}) {
  rewardRegistry.set(eventKey, {
    ...reward,
    oneTime: options.oneTime ?? true,
    mapId: options.mapId ?? null,
    requireMap: options.requireMap ?? false,
  });
  logger.info('ECONOMY', `Reward registered: ${eventKey}`, reward);
}

/**
 * Process a reward claim from a client.
 * Server validates eligibility and writes rewards directly to storage.
 */
function claimReward(ws, eventKey, mapId) {
  const { userId, username } = ws;
  const reward = rewardRegistry.get(eventKey);

  if (!reward) {
    return { success: false, error: 'Unknown reward' };
  }

  const claimKey = `${userId}:${eventKey}`;
  if (reward.oneTime && claimedRewards.has(claimKey)) {
    return { success: false, error: 'Already claimed' };
  }

  if (reward.requireMap && reward.mapId != null && mapId !== reward.mapId) {
    logger.security('Reward claim rejected (wrong map)', { userId, eventKey, expectedMap: reward.mapId, actualMap: mapId });
    return { success: false, error: 'Not eligible' };
  }

  const applied = {};

  // Gold
  if (reward.gold) {
    const goldData = storage.getPersonal(userId, 'gold') || {};
    const currentGold = goldData.gold ?? 0;
    const newGold = Math.min(currentGold + reward.gold, LIMITS.GOLD_ABSOLUTE_MAX);
    storage.setPersonal(userId, 'gold', { ...goldData, gold: newGold });
    applied.gold = reward.gold;
  }

  // Items
  if (reward.items && Array.isArray(reward.items)) {
    const itemData = storage.getPersonal(userId, 'item') || {};
    for (const { id, qty } of reward.items) {
      const current = itemData[id] ?? 0;
      itemData[id] = Math.min(current + qty, LIMITS.ITEM_MAX_STACK);
    }
    storage.setPersonal(userId, 'item', itemData);
    applied.items = reward.items;
  }

  // Weapons
  if (reward.weapons && Array.isArray(reward.weapons)) {
    const weaponData = storage.getPersonal(userId, 'weapon') || {};
    for (const { id, qty } of reward.weapons) {
      const current = weaponData[id] ?? 0;
      weaponData[id] = Math.min(current + qty, LIMITS.EQUIP_MAX_STACK);
    }
    storage.setPersonal(userId, 'weapon', weaponData);
    applied.weapons = reward.weapons;
  }

  // Armor
  if (reward.armor && Array.isArray(reward.armor)) {
    const armorData = storage.getPersonal(userId, 'armor') || {};
    for (const { id, qty } of reward.armor) {
      const current = armorData[id] ?? 0;
      armorData[id] = Math.min(current + qty, LIMITS.EQUIP_MAX_STACK);
    }
    storage.setPersonal(userId, 'armor', armorData);
    applied.armor = reward.armor;
  }

  if (reward.oneTime) {
    claimedRewards.add(claimKey);
  }

  logger.info('ECONOMY', `Reward claimed: ${eventKey}`, { userId, applied });

  try {
    ws.send(createRecv('system', 'server', 'reward/granted', [{ eventKey, rewards: applied }]));
  } catch (_) {}

  return { success: true, rewards: applied };
}


// ============================================================================
// BROADCAST HANDLER INTEGRATION
// ============================================================================

/**
 * Process economy-related broadcast commands.
 * Plug into handler.js handleBroadcast.
 * @returns {boolean} true if command was handled
 */
function processEconomyCommand(ws, code, args) {
  if (code === 'reward/claim') {
    const eventKey = args?.[0];
    const mapId = args?.[1];

    if (!eventKey || typeof eventKey !== 'string') {
      const msg = createRecv('system', 'server', 'reward/claim/res', [{ success: false, error: 'Invalid event key' }]);
      ws.send(msg);
      return true;
    }

    const result = claimReward(ws, eventKey, mapId);
    const msg = createRecv('system', 'server', 'reward/claim/res', [result]);
    ws.send(msg);
    return true;
  }

  return false;
}


module.exports = {
  validateEconomySave,
  LIMITS,
  devMode,
  registerReward,
  claimReward,
  processEconomyCommand,
};
