/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Core — CT-style Active Time Battle foundation
 * @author Hyaku no Sekai
 * @orderAfter MMORPG_Core
 *
 * @param GLOBAL_BATTLE_SPEED
 * @text Global Battle Speed
 * @type number
 * @decimals 2
 * @default 1.00
 *
 * @param BATTLER_SCALE
 * @text Battler Scale
 * @type number
 * @decimals 2
 * @default 1.00
 *
 * @param RUSH_SPEED
 * @text Rush Speed
 * @desc Interpolation speed for rush-to-target (0-1 per frame)
 * @type number
 * @decimals 3
 * @default 0.100
 *
 * @param RETURN_SPEED
 * @text Return Speed
 * @desc Interpolation speed for return after attack
 * @type number
 * @decimals 3
 * @default 0.060
 *
 * @param RETREAT_SCATTER
 * @text Retreat Scatter
 * @desc Random scatter pixels when returning to home (no custom retreat)
 * @type number
 * @default 30
 *
 * @param PIERCE_DEFAULT_WIDTH
 * @text Pierce Default Width
 * @desc Default width in px for pierce-type hitbox
 * @type number
 * @default 60
 *
 * @param GUARD_DAMAGE_RATE
 * @text Guard Damage Rate
 * @type number
 * @decimals 2
 * @default 0.50
 *
 * @param INTERRUPT_GAUGE_REFUND
 * @text Interrupt Gauge Refund
 * @type number
 * @decimals 2
 * @default 0.50
 *
 * @param IDLE_WANDER_RADIUS
 * @text Idle Wander Radius
 * @desc Max pixels enemies wander from home
 * @type number
 * @default 20
 *
 * @param IDLE_WANDER_INTERVAL_MIN
 * @text Idle Wander Min Frames
 * @desc Minimum frames between enemy idle wanders
 * @type number
 * @default 90
 *
 * @param IDLE_WANDER_INTERVAL_MAX
 * @text Idle Wander Max Frames
 * @desc Maximum frames between enemy idle wanders
 * @type number
 * @default 240
 *
 * @param DEFAULT_COLLISION_RAD
 * @text Default Collision Radius
 * @type number
 * @default 24
 *
 * @param EDGE_PADDING
 * @text Edge Padding
 * @desc Pixels from screen edge that battlers won't move past
 * @type number
 * @default 40
 *
 * @help
 * ============================================================================
 * ATB_Core v3.0 — Active Time Battle Foundation
 * ============================================================================
 *
 * Core gauge system, notetag parser, battlefield position management.
 * All skills have FULL SCREEN RANGE — no range checks or greyed-out skills.
 *
 * == SKILL NOTETAGS ==
 *
 * <SkillMove: TYPE>
 *   stay       — Cast from current position (default for magic/healing)
 *   dashback   — Rush to target, attack, bounce back (default for physical)
 *   rush       — Rush to target, attack, stay at target position
 *   passthrough — Rush to target, attack, continue past target
 *   pierce     — Move in a line; all enemies in path take damage
 *
 * <RetreatAngle: N>   — 0-360 degrees (0=right, 90=down, 180=left, 270=up)
 * <RetreatDist: N>    — Pixels to retreat from attack point
 * <PierceWidth: N>    — Width of pierce hitbox (default: 60)
 * <CastTime: N>       — Cast time in seconds
 * <Interruptible: true|false>
 * <TelegraphDuration: N> — Telegraph duration in seconds (enemy warning)
 * <AoEOrigin: caster|target> — Center AoE on caster or the primary target
 * <AoEApply: true|false> — Apply AoE to targets (default: true when AoE tags exist)
 * <AoEWidth: N>      — Width in px for LINE AoE
 * <AoELength: N>     — Length in px for LINE AoE
 * <AoEAngle: N>      — Full angle in degrees for CONE AoE
 *
 * == EQUIPMENT NOTETAGS ==
 * <ATBSpeedBonus: +N%>
 * <ATBSpeedMod: N%>
 * <Knockback: N>
 * <Pull: N>
 *
 * == STATE NOTETAGS ==
 * <ATBSpeedMod: N%>
 * <ATBFreeze: true|false>
 *
 * == ENEMY NOTETAGS ==
 * <BattleCharSheet: filename>
 * <BattleSprite: filename>
 * <BattleSize: W, H>
 * <BattleFrames: idle=N, attack=N, damage=N, dead=N, walk=N, cast=N>
 * <CollisionRadius: N>
 *
 * == TROOP NOTETAGS ==
 * <EnemyPosition: index, x, y>
 * <PartyPosition: index, x, y>
 * <BattlefieldSize: W, H>
 *
 * == TECH NOTETAGS ==
 * <TechParticipants: actorId1, actorId2>
 * <TechClasses: classId1, classId2>
 * <TechReposition>
 *   caster1: target|stay|midpoint|offset,x,y
 *   caster2: target|stay|midpoint|offset,x,y
 * </TechReposition>
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "ATB_Core";
  const p = PluginManager.parameters(PLUGIN_NAME);

  // ========================================================================
  // GLOBAL CONFIG
  // ========================================================================
  const ATB = {
    GLOBAL_BATTLE_SPEED:    parseFloat(p["GLOBAL_BATTLE_SPEED"] || "1.0"),
    GUARD_DAMAGE_RATE:      parseFloat(p["GUARD_DAMAGE_RATE"] || "0.50"),
    INTERRUPT_GAUGE_REFUND: parseFloat(p["INTERRUPT_GAUGE_REFUND"] || "0.50"),
    BATTLER_SCALE:          parseFloat(p["BATTLER_SCALE"] || "1.0"),
    RUSH_SPEED:             parseFloat(p["RUSH_SPEED"] || "0.10"),
    RETURN_SPEED:           parseFloat(p["RETURN_SPEED"] || "0.06"),
    RETREAT_SCATTER:        Number(p["RETREAT_SCATTER"] || 30),
    PIERCE_DEFAULT_WIDTH:   Number(p["PIERCE_DEFAULT_WIDTH"] || 60),
    DEFAULT_COLLISION_RAD:  Number(p["DEFAULT_COLLISION_RAD"] || 24),
    IDLE_WANDER_RADIUS:     Number(p["IDLE_WANDER_RADIUS"] || 20),
    IDLE_WANDER_MIN:        Number(p["IDLE_WANDER_INTERVAL_MIN"] || 90),
    IDLE_WANDER_MAX:        Number(p["IDLE_WANDER_INTERVAL_MAX"] || 240),
    EDGE_PADDING:           Number(p["EDGE_PADDING"] || 40),
    MAX_ATB_GAUGE:          10000,
    AGI_REFERENCE_VALUE:    30,
    _currentBattleWidth:    0,
    _currentBattleHeight:   0,
  };

  window.ATB = ATB;

  // ========================================================================
  // NOTETAG PARSER
  // ========================================================================
  const _noteCache = new Map();

  ATB.parseNotetags = function(obj) {
    if (!obj || !obj.note) return {};
    if (_noteCache.has(obj)) return _noteCache.get(obj);

    const n = obj.note;
    const t = {};

    const f   = (rx) => { const m = n.match(rx); return m ? parseFloat(m[1]) : undefined; };
    const i   = (rx) => { const m = n.match(rx); return m ? parseInt(m[1], 10) : undefined; };
    const s   = (rx) => { const m = n.match(rx); return m ? m[1].trim() : undefined; };
    const b   = (rx) => { const m = n.match(rx); return m ? m[1].toLowerCase() === "true" : undefined; };
    const pct = (rx) => { const m = n.match(rx); return m ? parseInt(m[1], 10) / 100 : undefined; };

    // ---- v3 Skill Movement Tags ----
    const sm = s(/<SkillMove:\s*(\w+)>/i);
    if (sm !== undefined) t.skillMove = sm.toLowerCase();

    const ra = f(/<RetreatAngle:\s*([\d.]+)>/i);
    if (ra !== undefined) t.retreatAngle = ra;

    const rd = f(/<RetreatDist:\s*([\d.]+)>/i);
    if (rd !== undefined) t.retreatDist = rd;

    const pw = i(/<PierceWidth:\s*(\d+)>/i);
    if (pw !== undefined) t.pierceWidth = pw;

    // ---- Cast / Interrupt ----
    const ct = f(/<CastTime:\s*([\d.]+)>/i);
    if (ct !== undefined) t.castTime = ct;

    const intr = b(/<Interruptible:\s*(true|false)>/i);
    if (intr !== undefined) t.interruptible = intr;

    const td = f(/<TelegraphDuration:\s*([\d.]+)>/i);
    if (td !== undefined) t.telegraphDuration = td;

    // ---- Equipment / State modifiers ----
    const spd = pct(/<ATBSpeedBonus:\s*\+?(\d+)%>/i);
    if (spd !== undefined) t.atbSpeedBonus = spd;

    const smod = pct(/<ATBSpeedMod:\s*(\d+)%>/i);
    if (smod !== undefined) t.atbSpeedMod = smod;

    const kb = i(/<Knockback:\s*(\d+)>/i);
    if (kb !== undefined) t.knockback = kb;

    const pl = i(/<Pull:\s*(\d+)>/i);
    if (pl !== undefined) t.pull = pl;

    const aoeOrigin = s(/<AoEOrigin:\s*(caster|target)>/i);
    if (aoeOrigin !== undefined) t.aoeOrigin = aoeOrigin.toLowerCase();

    const aoeApply = b(/<AoEApply:\s*(true|false)>/i);
    if (aoeApply !== undefined) t.aoeApply = aoeApply;

    const aoeWidth = i(/<AoEWidth:\s*(\d+)>/i);
    if (aoeWidth !== undefined) t.aoeWidth = aoeWidth;

    const aoeLength = i(/<AoELength:\s*(\d+)>/i);
    if (aoeLength !== undefined) t.aoeLength = aoeLength;

    const aoeAngle = f(/<AoEAngle:\s*([\d.]+)>/i);
    if (aoeAngle !== undefined) t.aoeAngle = aoeAngle;

    const frz = b(/<ATBFreeze:\s*(true|false)>/i);
    if (frz !== undefined) t.atbFreeze = frz;

    // ---- AoE (kept for future use) ----
    const aoeMatch = n.match(/<SkillAoE:\s*(\w+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?>/i);
    if (aoeMatch) {
      t.aoeShape = aoeMatch[1].toUpperCase();
      if (aoeMatch[2]) t.aoeRadius = parseInt(aoeMatch[2]);
      if (aoeMatch[3]) t.aoeLength = parseInt(aoeMatch[3]);
      if (aoeMatch[4]) t.aoeAngle  = parseInt(aoeMatch[4]);
    }

    // ---- Enemy display tags ----
    const bcs = s(/<BattleCharSheet:\s*(.+?)>/i);
    if (bcs !== undefined) t.battleCharSheet = bcs;

    const bsp = s(/<BattleSprite:\s*(.+?)>/i);
    if (bsp !== undefined) t.battleSprite = bsp;

    const bsz = n.match(/<BattleSize:\s*(\d+)\s*,\s*(\d+)>/i);
    if (bsz) t.battleSize = { w: parseInt(bsz[1]), h: parseInt(bsz[2]) };

    const bfr = n.match(/<BattleFrames:\s*(.+?)>/i);
    if (bfr) {
      t.battleFrames = {};
      bfr[1].split(",").forEach(pair => {
        const [key, val] = pair.split("=").map(x => x.trim());
        if (key && val) t.battleFrames[key] = parseInt(val);
      });
    }

    const cr = i(/<CollisionRadius:\s*(\d+)>/i);
    if (cr !== undefined) t.collisionRadius = cr;

    // ---- Actor display tags ----
    const abs = s(/<BattleSheet:\s*(.+?)>/i);
    if (abs !== undefined) t.battleSheet = abs;

    // ---- Tech tags ----
    const tp = n.match(/<TechParticipants:\s*(.+?)>/i);
    if (tp) t.techParticipants = tp[1].split(",").map(x => parseInt(x.trim(), 10));

    const tc = n.match(/<TechClasses:\s*(.+?)>/i);
    if (tc) t.techClasses = tc[1].split(",").map(x => parseInt(x.trim(), 10));

    const trp = n.match(/<TechReposition>([\s\S]*?)<\/TechReposition>/i);
    if (trp) {
      t.techReposition = {};
      trp[1].trim().split("\n").forEach(line => {
        const ci = line.indexOf(":");
        if (ci >= 0) t.techReposition[line.substring(0, ci).trim()] = line.substring(ci + 1).trim();
      });
    }

    // ---- Troop position tags ----
    for (const m of n.matchAll(/<EnemyPosition:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)>/gi)) {
      if (!t.enemyPositions) t.enemyPositions = {};
      t.enemyPositions[parseInt(m[1])] = { x: parseInt(m[2]), y: parseInt(m[3]) };
    }
    for (const m of n.matchAll(/<PartyPosition:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)>/gi)) {
      if (!t.partyPositions) t.partyPositions = {};
      t.partyPositions[parseInt(m[1])] = { x: parseInt(m[2]), y: parseInt(m[3]) };
    }
    const bfs = n.match(/<BattlefieldSize:\s*(\d+)\s*,\s*(\d+)>/i);
    if (bfs) t.battlefieldSize = { w: parseInt(bfs[1]), h: parseInt(bfs[2]) };

    // ---- Skill Sequence DSL (future) ----
    const seq = n.match(/<SkillSequence>([\s\S]*?)<\/SkillSequence>/i);
    if (seq) t.skillSequence = seq[1].trim().split("\n").map(l => l.trim()).filter(Boolean);

    _noteCache.set(obj, t);
    return t;
  };

  // ========================================================================
  // SKILL MOVE TYPE DETECTION (v3.0)
  // ========================================================================

  /**
   * Returns the SkillMove type for a given action.
   * Priority: explicit <SkillMove> tag > auto-detect from skill properties.
   * Returns: "stay", "dashback", "rush", "passthrough", "pierce"
   */
  ATB.getSkillMoveType = function(action) {
    if (!action || !action.item()) return "stay";
    const item = action.item();
    const tags = ATB.parseNotetags(item);

    // Explicit notetag takes priority
    if (tags.skillMove) return tags.skillMove;

    // Auto-detect defaults
    if (action.isAttack()) return "dashback";
    if (action.isGuard()) return "stay";
    if (DataManager.isItem(item)) return "stay";

    // Healing/buff skills (scope = allies)
    if (item.scope >= 7 && item.scope <= 12) return "stay";

    // Physical hit type = melee dashback
    if (item.hitType === 1) return "dashback";

    // Magical / certain hit = stay in place
    return "stay";
  };

  /**
   * Get retreat info for a skill (used by dashback with custom positioning).
   * Returns { angle: degrees, dist: pixels } or null for default scatter-home.
   */
  ATB.getRetreatInfo = function(skill) {
    if (!skill) return null;
    const tags = ATB.parseNotetags(skill);
    if (tags.retreatAngle !== undefined || tags.retreatDist !== undefined) {
      return {
        angle: tags.retreatAngle !== undefined ? tags.retreatAngle : 180,
        dist:  tags.retreatDist  !== undefined ? tags.retreatDist  : 80,
      };
    }
    return null;
  };

  /**
   * Get pierce width for a skill.
   */
  ATB.getPierceWidth = function(skill) {
    if (!skill) return ATB.PIERCE_DEFAULT_WIDTH;
    const tags = ATB.parseNotetags(skill);
    return tags.pierceWidth || ATB.PIERCE_DEFAULT_WIDTH;
  };

  // ========================================================================
  // AGGREGATE HELPERS (equipment / states)
  // ========================================================================

  ATB.getEquipSpeedBonus = function(battler) {
    if (!battler || !battler.isActor || !battler.isActor()) return 0;
    let sum = 0;
    for (const eq of battler.equips()) {
      if (eq) { const tg = ATB.parseNotetags(eq); if (tg.atbSpeedBonus) sum += tg.atbSpeedBonus; }
    }
    return sum;
  };

  ATB.getStateSpeedMod = function(battler) {
    if (!battler || !battler.states) return 1.0;
    let mod = 1.0;
    for (const state of battler.states()) {
      const tg = ATB.parseNotetags(state);
      if (tg.atbSpeedMod) mod *= tg.atbSpeedMod;
    }
    return mod;
  };

  ATB.isAtbFrozen = function(battler) {
    if (!battler || !battler.states) return false;
    let hasNoFreezeTag = false;
    for (const state of battler.states()) {
      const tg = ATB.parseNotetags(state);
      if (tg.atbFreeze === true) return true;
      if (tg.atbFreeze === false) hasNoFreezeTag = true;
    }
    if (hasNoFreezeTag) return false;
    return !battler.canMove();
  };

  ATB.hasAtbFreezeOverride = function(battler) {
    if (!battler || !battler.states) return false;
    for (const state of battler.states()) {
      const tg = ATB.parseNotetags(state);
      if (tg.atbFreeze === false) return true;
    }
    return false;
  };

  // ========================================================================
  // UTILITY — Clamp position to battlefield edges
  // ========================================================================
  ATB.clampToBattlefield = function(x, y) {
    const pad = ATB.EDGE_PADDING;
    const w = ATB._currentBattleWidth || Graphics.width;
    const h = ATB._currentBattleHeight || Graphics.height;
    return {
      x: Math.max(pad, Math.min(w - pad, x)),
      y: Math.max(pad, Math.min(h - pad, y)),
    };
  };

  /**
   * Calculate endpoint for a retreat given angle (degrees) and distance (px)
   * from an origin point. 0=right, 90=down, 180=left, 270=up.
   */
  ATB.calcRetreatPoint = function(originX, originY, angleDeg, dist) {
    const rad = (angleDeg * Math.PI) / 180;
    const tx = originX + Math.cos(rad) * dist;
    const ty = originY + Math.sin(rad) * dist;
    return ATB.clampToBattlefield(tx, ty);
  };

  /**
   * Euclidean distance between two battlers (null-safe).
   */
  ATB.distanceBetween = function(a, b) {
    if (!a || !b) return 9999;
    const ax = a._battleX || 0, ay = a._battleY || 0;
    const bx = b._battleX || 0, by = b._battleY || 0;
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
  };

  // ========================================================================
  // BATTLE POSITION MIXIN — Game_BattlerBase
  // ========================================================================

  const _GBB_initMembers = Game_BattlerBase.prototype.initMembers;
  Game_BattlerBase.prototype.initMembers = function() {
    _GBB_initMembers.call(this);
    this._battleX = 0;
    this._battleY = 0;
    this._homeX = 0;
    this._homeY = 0;
    this._entryX = 0;       // where the battler entered the screen (for post-battle return)
    this._entryY = 0;
    this._atbGauge = 0;
    this._atbCasting = false;
    this._atbCastTimer = 0;
    this._atbCastAction = null;
    this._isGuarding = false;
    this._atbMoving = false;
  };

  Game_BattlerBase.prototype.setBattlePosition = function(x, y) {
    this._battleX = x;
    this._battleY = y;
  };

  Game_BattlerBase.prototype.setHomePosition = function(x, y) {
    this._homeX = x;
    this._homeY = y;
  };

  Game_BattlerBase.prototype.setEntryPosition = function(x, y) {
    this._entryX = x;
    this._entryY = y;
  };

  Game_BattlerBase.prototype.distanceTo = function(other) {
    return ATB.distanceBetween(this, other);
  };

  // ========================================================================
  // ATB GAUGE — Reshape MZ's TPB
  // ========================================================================

  /**
   * ATB fill rate per frame. Based on AGI with equipment/state modifiers.
   */
  Game_Battler.prototype.atbFillRate = function() {
    const agi = Math.max(1, this.agi);
    const base = (agi / ATB.AGI_REFERENCE_VALUE) * ATB.GLOBAL_BATTLE_SPEED;
    const equipBonus = ATB.getEquipSpeedBonus(this);
    const stateMod   = ATB.getStateSpeedMod(this);
    return base * (1.0 + equipBonus) * stateMod;
  };

  /**
   * Per-frame ATB update. Called from the battle update loop.
   */
  Game_Battler.prototype.updateAtbGauge = function() {
    if (this.isDead()) return;
    if (ATB.isAtbFrozen(this)) return;

    // Casting?
    if (this._atbCasting) {
      this._atbCastTimer -= this.atbFillRate() * (1 / 60);
      if (this._atbCastTimer <= 0) {
        this._atbCasting = false;
        // Ready to execute the cast action
        if (this._atbCastAction) {
          BattleManager.queueAtbAction(this, this._atbCastAction);
          this._atbCastAction = null;
        }
      }
      this._syncAtbGaugeFromTpb();
      return;
    }

    // Sync cached ATB gauge from TPB for UI and multiplayer payloads
    this._syncAtbGaugeFromTpb();
  };

  Game_Battler.prototype.isAtbReady = function() {
    return this.isTpbCharged() && !this._atbCasting;
  };

  Game_Battler.prototype.resetAtbGauge = function() {
    this.clearTpbChargeTime();
    this._atbGauge = 0;
  };

  Game_Battler.prototype._syncAtbGaugeFromTpb = function() {
    const charge = this._tpbChargeTime || 0;
    this._atbGauge = Math.round(ATB.MAX_ATB_GAUGE * charge);
  };

  Game_Battler.prototype.startCasting = function(action) {
    const skill = action.item();
    const tags = ATB.parseNotetags(skill);
    const castTime = tags.castTime || 0;
    if (castTime <= 0) return false;

    this._atbCasting = true;
    this._atbCastTimer = castTime;
    this._atbCastAction = action;
    this.resetAtbGauge();
    return true;
  };

  Game_Battler.prototype.interruptCast = function() {
    if (!this._atbCasting) return;
    const skill = this._atbCastAction ? this._atbCastAction.item() : null;
    const tags = skill ? ATB.parseNotetags(skill) : {};
    if (tags.interruptible === false) return; // uninterruptible

    this._atbCasting = false;
    this._atbCastAction = null;
    this._tpbState = "charging";
    this._tpbChargeTime = ATB.INTERRUPT_GAUGE_REFUND;
    this._syncAtbGaugeFromTpb();
  };

  const _GB_updateTpb = Game_Battler.prototype.updateTpb;
  Game_Battler.prototype.updateTpb = function() {
    if (ATB.isAtbFrozen(this)) {
      this._syncAtbGaugeFromTpb();
      return;
    }
    if (ATB.hasAtbFreezeOverride(this) && !this.canMove()) {
      this.updateTpbChargeTime();
      this.updateTpbCastTime();
      this.updateTpbAutoBattle();
      if (this.isAlive()) {
        this.updateTpbIdleTime();
      }
      this._syncAtbGaugeFromTpb();
      return;
    }
    _GB_updateTpb.call(this);
    this._syncAtbGaugeFromTpb();
  };

  // ========================================================================
  // GUARD — Lasts until next turn, reduces damage
  // ========================================================================

  const _GB_onDamage = Game_Battler.prototype.onDamage;
  Game_Battler.prototype.onDamage = function(value) {
    // Interrupt casting on damage
    if (this._atbCasting) this.interruptCast();
    _GB_onDamage.call(this, value);
  };

  // Apply guard damage reduction
  const _GA_makeDamageValue = Game_Action.prototype.makeDamageValue;
  Game_Action.prototype.makeDamageValue = function(target, critical) {
    let value = _GA_makeDamageValue.call(this, target, critical);
    if (target._isGuarding && value > 0) {
      value = Math.floor(value * ATB.GUARD_DAMAGE_RATE);
    }
    return value;
  };

  // Track guarding state from actions
  const _BM_startAction_guard = BattleManager.startAction;
  BattleManager.startAction = function() {
    const subject = this._subject;
    const action = subject ? subject.currentAction() : null;
    if (subject && action) {
      subject._isGuarding = action.isGuard();
    }
    _BM_startAction_guard.call(this);
  };

  // ========================================================================
  // ACTION QUEUE — Continuous ATB (replaces MZ turn-based phases)
  // ========================================================================

  BattleManager._atbActionQueue = [];

  BattleManager.queueAtbAction = function(battler, action) {
    if (!battler || !action) return;
    this._atbActionQueue.push({ battler, action });
  };

  BattleManager.hasQueuedActions = function() {
    return this._atbActionQueue.length > 0;
  };

  BattleManager.dequeueAtbAction = function() {
    return this._atbActionQueue.shift() || null;
  };

  BattleManager.processAtbActions = function() {
    const next = this.dequeueAtbAction();
    if (!next) return;
    const { battler, action } = next;
    if (!battler || battler.isDead() || !action) return;
    battler._actions = [action];
    battler.startTpbAction();
    if (!this._actionBattlers.includes(battler)) {
      this._actionBattlers.push(battler);
    }
  };

  // ========================================================================
  // BATTLE INITIALIZATION — Set positions
  // ========================================================================

  const _BM_startBattle = BattleManager.startBattle;
  BattleManager.startBattle = function() {
    _BM_startBattle.call(this);
    ATB._currentBattleWidth = Graphics.width;
    ATB._currentBattleHeight = Graphics.height;
    this._setupBattlePositions();
    this._atbActionQueue = [];
  };

  BattleManager._setupBattlePositions = function() {
    const w = ATB._currentBattleWidth;
    const h = ATB._currentBattleHeight;
    const pad = ATB.EDGE_PADDING;

    // Check troop notetags for custom positions
    const troop = $dataTroops[$gameTroop._troopId];
    const troopTags = troop ? ATB.parseNotetags(troop) : {};

    // ---- Party (left side of screen) ----
    const party = $gameParty.battleMembers();
    const partyStartX = pad + 60;
    const partySpacing = Math.min(60, (h - pad * 2) / (party.length + 1));
    const partyStartY = (h - (party.length - 1) * partySpacing) / 2;

    for (let i = 0; i < party.length; i++) {
      const member = party[i];
      let px, py;
      if (troopTags.partyPositions && troopTags.partyPositions[i]) {
        px = troopTags.partyPositions[i].x;
        py = troopTags.partyPositions[i].y;
      } else {
        px = partyStartX;
        py = partyStartY + i * partySpacing;
      }
      member.setBattlePosition(px, py);
      member.setHomePosition(px, py);
      member.setEntryPosition(px, py);
      member._syncAtbGaugeFromTpb();
      member._isGuarding = false;
    }

    // ---- Enemies (right side of screen) ----
    const enemies = $gameTroop.members();
    const enemyStartX = w - pad - 60;
    const enemySpacing = Math.min(60, (h - pad * 2) / (enemies.length + 1));
    const enemyStartY = (h - (enemies.length - 1) * enemySpacing) / 2;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      let ex, ey;
      if (troopTags.enemyPositions && troopTags.enemyPositions[i]) {
        ex = troopTags.enemyPositions[i].x;
        ey = troopTags.enemyPositions[i].y;
      } else {
        ex = enemyStartX;
        ey = enemyStartY + i * enemySpacing;
      }
      enemy.setBattlePosition(ex, ey);
      enemy.setHomePosition(ex, ey);
      enemy.setEntryPosition(ex, ey);
      enemy._syncAtbGaugeFromTpb();
    }
  };

  // ========================================================================
  // ATB TICK — Main update hook
  // ========================================================================

  const _BM_update = BattleManager.update;
  BattleManager.update = function(timeActive) {
    // Don't update ATB during non-battle phases
    if (this._phase === "init" || this._phase === "start") {
      _BM_update.call(this, timeActive);
      return;
    }

    // Update all battler gauges
    if (this._phase !== "battleEnd") {
      this.updateAllAtbGauges();
    }

    this.processAtbActions();

    _BM_update.call(this, timeActive);
  };

  BattleManager.updateAllAtbGauges = function() {
    const members = this.allBattleMembers();
    for (const battler of members) {
      if (battler && !battler.isDead()) {
        battler.updateAtbGauge();
      }
    }
  };

  // ========================================================================
  // SUPPRESS PARTY COMMAND — ATB has no party-level command phase
  // ========================================================================

  const _SB_startPartyCommandSelection = Scene_Battle.prototype.startPartyCommandSelection;
  Scene_Battle.prototype.startPartyCommandSelection = function() {
    // Skip party command in ATB — go straight to actor command
    // The original shows "Fight / Escape" which doesn't apply in ATB
  };

  // ========================================================================
  // ATB INPUT — Open command window when an actor's gauge is full
  // ========================================================================

  const _SB_update = Scene_Battle.prototype.update;
  Scene_Battle.prototype.update = function() {
    _SB_update.call(this);
    this.updateAtbInput();
  };

  Scene_Battle.prototype.updateAtbInput = function() {
    if (BattleManager._phase === "battleEnd") return;
    if (BattleManager._phase === "init" || BattleManager._phase === "start") return;

    // If command window is already active, don't interrupt
    if (this._actorCommandWindow && this._actorCommandWindow.active) return;
    if (this._skillWindow && this._skillWindow.active) return;
    if (this._itemWindow && this._itemWindow.active) return;
    if (this._enemyWindow && this._enemyWindow.active) return;
    if (this._actorWindow && this._actorWindow.active) return;

    // Find first ready actor
    const party = $gameParty.battleMembers();
    for (const actor of party) {
      if (actor && actor.isAtbReady() && actor.canInput() && !actor._isGuarding) {
        BattleManager._currentActor = actor;
        this._actorCommandWindow.setup(actor);
        break;
      }
    }
  };

  // ========================================================================
  // CLEAR CACHE ON DATABASE RELOAD
  // ========================================================================
  const _DM_onLoad = DataManager.onLoad;
  DataManager.onLoad = function(object) {
    _DM_onLoad.call(this, object);
    _noteCache.clear();
  };

  console.log("[ATB_Core] v3.0 — Full screen range, notetag-driven movement loaded.");
})();
