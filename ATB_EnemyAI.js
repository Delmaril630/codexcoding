/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Enemy AI — Action-only, no movement
 * @author Hyaku no Sekai
 * @orderAfter ATB_Movement
 *
 * @help
 * ============================================================================
 * ATB_EnemyAI v3.0 — Simplified Enemy AI
 * ============================================================================
 *
 * v3.0: Enemies no longer make movement decisions. They stay in place
 * (with idle wander from ATB_Movement) and simply pick skills/targets
 * when their ATB gauge fills. The skill's <SkillMove> tag determines
 * how the enemy physically moves during the attack.
 *
 * Telegraph system still works: enemies with <TelegraphDuration: N>
 * on their skills will show a warning before executing.
 */

(() => {
  "use strict";

  // ========================================================================
  // ENEMY ATB DECISION — Pick skill + target when gauge is full
  // ========================================================================

  const _BM_update_ai = BattleManager.update;
  BattleManager.update = function(timeActive) {
    _BM_update_ai.call(this, timeActive);

    if (this._phase === "battleEnd" || this._phase === "init" || this._phase === "start") return;

    this._updateEnemyAI();
  };

  BattleManager._updateEnemyAI = function() {
    for (const enemy of $gameTroop.aliveMembers()) {
      if (!enemy) continue;

      // Handle telegraph timers
      if (enemy._telegraphActive) {
        const done = enemy.updateTelegraph();
        if (done) {
          // Telegraph finished — execute the skill
          this._executeEnemyAction(enemy);
        }
        continue;
      }

      // Check if gauge is full
      if (!enemy.isAtbReady()) continue;

      // Pick an action
      enemy.makeActions();
      const action = enemy.currentAction();
      if (!action || !action.item()) {
        enemy.resetAtbGauge();
        continue;
      }

      // Check for cast time
      if (enemy.startCasting(action)) {
        continue; // Will execute when cast completes
      }

      // Check for telegraph
      const skill = action.item();
      const tags = ATB.parseNotetags(skill);
      if (tags.telegraphDuration && tags.telegraphDuration > 0) {
        const target = this._pickEnemyTarget(enemy, action);
        const targetPoint = target ? { x: target._battleX, y: target._battleY } : null;
        enemy.startTelegraph(skill, targetPoint);
        enemy.resetAtbGauge();
        continue;
      }

      // Execute immediately
      this._executeEnemyAction(enemy);
    }
  };

  BattleManager._executeEnemyAction = function(enemy) {
    if (!enemy || enemy.isDead()) return;

    try {
      const action = enemy.currentAction();
      if (!action || !action.item()) {
        enemy.resetAtbGauge();
        return;
      }

      // Let BattleManager handle the action through its normal pipeline
      this._subject = enemy;
      this.startAction();
      enemy.resetAtbGauge();
    } catch (e) {
      console.warn("[ATB_EnemyAI] Error executing enemy action:", e);
      enemy.resetAtbGauge();
    }
  };

  BattleManager._pickEnemyTarget = function(enemy, action) {
    if (!action) return null;
    try {
      const targets = action.makeTargets();
      if (targets && targets.length > 0) {
        return targets[0];
      }
    } catch (e) {
      // Fall through
    }
    // Fallback: random alive party member
    const alive = $gameParty.aliveMembers();
    return alive.length > 0 ? alive[Math.floor(Math.random() * alive.length)] : null;
  };

  // ========================================================================
  // TELEGRAPH SYSTEM — Visual warning before powerful attacks
  // ========================================================================

  Game_Enemy.prototype.startTelegraph = function(skill, targetPoint) {
    const tags = ATB.parseNotetags(skill);
    const duration = tags.telegraphDuration || 0;
    if (duration <= 0) return false;

    this._telegraphActive = true;
    this._telegraphSkill = skill;
    this._telegraphTarget = targetPoint;
    this._telegraphTimer = Math.round(duration * 60);
    this._telegraphTimerMax = this._telegraphTimer;
    return true;
  };

  Game_Enemy.prototype.updateTelegraph = function() {
    if (!this._telegraphActive) return false;
    this._telegraphTimer--;
    if (this._telegraphTimer <= 0) {
      this._telegraphActive = false;
      return true; // telegraph done → execute
    }
    return false; // still telegraphing
  };

  Game_Enemy.prototype.telegraphRate = function() {
    if (!this._telegraphActive || this._telegraphTimerMax <= 0) return 0;
    return 1.0 - (this._telegraphTimer / this._telegraphTimerMax);
  };

  // Initialize telegraph fields
  const _GE_initMembers_ai = Game_Enemy.prototype.initMembers;
  Game_Enemy.prototype.initMembers = function() {
    _GE_initMembers_ai.call(this);
    this._telegraphActive = false;
    this._telegraphSkill = null;
    this._telegraphTarget = null;
    this._telegraphTimer = 0;
    this._telegraphTimerMax = 0;
  };

  console.log("[ATB_EnemyAI] v3.0 — Action-only AI (no movement decisions) loaded.");
})();
