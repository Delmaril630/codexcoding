/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Enemy Runtime — Idle wander, telegraph AI, reposition, escape
 * @author Hyaku no Sekai
 * @orderAfter ATB_SpriteExtension
 *
 * @help
 * ============================================================================
 * ATB_EnemyRuntime v3.0 — Enemy Movement + AI Runtime
 * ============================================================================
 *
 * Combines:
 *  - Enemy idle wander (no chasing)
 *  - Knockback & pull skill repositioning
 *  - Escape vote handling
 *  - Enemy ATB AI + telegraph warnings
 *
 * This is a consolidation of ATB_Movement + ATB_EnemyAI.
 */

(() => {
  "use strict";

  // ========================================================================
  // ENEMY IDLE WANDER
  // ========================================================================
  // Each enemy gets a wander timer. When it fires, they shift a few pixels
  // from home. No chasing, no tactical positioning — just visual life.

  const _GE_initMembers = Game_Enemy.prototype.initMembers;
  Game_Enemy.prototype.initMembers = function() {
    _GE_initMembers.call(this);
    this._idleWanderTimer = this._randomWanderDelay();
    this._wanderTargetX = 0;
    this._wanderTargetY = 0;
    this._isWandering = false;
    this._wanderProgress = 0;
    this._wanderStartX = 0;
    this._wanderStartY = 0;

    this._telegraphActive = false;
    this._telegraphSkill = null;
    this._telegraphTarget = null;
    this._telegraphTimer = 0;
    this._telegraphTimerMax = 0;
  };

  Game_Enemy.prototype._randomWanderDelay = function() {
    return ATB.IDLE_WANDER_MIN +
      Math.floor(Math.random() * (ATB.IDLE_WANDER_MAX - ATB.IDLE_WANDER_MIN));
  };

  Game_Enemy.prototype.updateIdleWander = function() {
    if (this.isDead()) return;
    if (this._atbCasting) return;

    if (this._isWandering) {
      this._updateWanderMove();
      return;
    }

    this._idleWanderTimer--;
    if (this._idleWanderTimer <= 0) {
      this._startWander();
      this._idleWanderTimer = this._randomWanderDelay();
    }
  };

  Game_Enemy.prototype._startWander = function() {
    const radius = ATB.IDLE_WANDER_RADIUS;
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * radius;

    const tx = this._homeX + Math.cos(angle) * dist;
    const ty = this._homeY + Math.sin(angle) * dist;
    const clamped = ATB.clampToBattlefield(tx, ty);

    this._wanderTargetX = clamped.x;
    this._wanderTargetY = clamped.y;
    this._wanderStartX = this._battleX;
    this._wanderStartY = this._battleY;
    this._wanderProgress = 0;
    this._isWandering = true;
  };

  Game_Enemy.prototype._updateWanderMove = function() {
    this._wanderProgress += 0.02; // Slow shuffle

    if (this._wanderProgress >= 1.0) {
      this._battleX = this._wanderTargetX;
      this._battleY = this._wanderTargetY;
      this._isWandering = false;
    } else {
      // Smooth ease-in-out
      const t = this._wanderProgress;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this._battleX = this._wanderStartX + (this._wanderTargetX - this._wanderStartX) * ease;
      this._battleY = this._wanderStartY + (this._wanderTargetY - this._wanderStartY) * ease;
    }
  };

  // ========================================================================
  // SKILL REPOSITIONING — Knockback & Pull
  // ========================================================================
  // When a skill hits, check for <Knockback: N> or <Pull: N> tags.
  // These physically move the TARGET after the hit.

  const _GA_apply = Game_Action.prototype.apply;
  Game_Action.prototype.apply = function(target) {
    _GA_apply.call(this, target);

    // Only reposition on successful hit
    if (!target || !target.result || !target.result().isHit()) return;

    const item = this.item();
    if (!item) return;
    const tags = ATB.parseNotetags(item);
    const subject = this.subject();

    if (tags.knockback && tags.knockback > 0 && subject) {
      this._applyKnockback(subject, target, tags.knockback);
    }

    if (tags.pull && tags.pull > 0 && subject) {
      this._applyPull(subject, target, tags.pull);
    }
  };

  Game_Action.prototype._applyKnockback = function(subject, target, dist) {
    const dx = (target._battleX || 0) - (subject._battleX || 0);
    const dy = (target._battleY || 0) - (subject._battleY || 0);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const nx = dx / len;
    const ny = dy / len;
    const dest = ATB.clampToBattlefield(
      target._battleX + nx * dist,
      target._battleY + ny * dist
    );
    target._battleX = dest.x;
    target._battleY = dest.y;
    // Update enemy home position too so wander stays near new spot
    if (target.isEnemy && target.isEnemy()) {
      target._homeX = dest.x;
      target._homeY = dest.y;
    }
  };

  Game_Action.prototype._applyPull = function(subject, target, dist) {
    const dx = (subject._battleX || 0) - (target._battleX || 0);
    const dy = (subject._battleY || 0) - (target._battleY || 0);
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const nx = dx / len;
    const ny = dy / len;
    const pullDist = Math.min(dist, len - ATB.DEFAULT_COLLISION_RAD * 2);
    if (pullDist <= 0) return;

    const dest = ATB.clampToBattlefield(
      target._battleX + nx * pullDist,
      target._battleY + ny * pullDist
    );
    target._battleX = dest.x;
    target._battleY = dest.y;
    if (target.isEnemy && target.isEnemy()) {
      target._homeX = dest.x;
      target._homeY = dest.y;
    }
  };

  // ========================================================================
  // ESCAPE — Party-wide gauge fill
  // ========================================================================
  // Instead of instant escape, each party member fills an "escape gauge."
  // When enough members vote escape, the party flees.

  BattleManager._escapeVotes = 0;

  const _WCA_addCommand = Window_ActorCommand.prototype.makeCommandList;
  Window_ActorCommand.prototype.makeCommandList = function() {
    _WCA_addCommand.call(this);
    // "Move" command removed in v3.0.
    // Escape is kept on the actor command menu.
    if (this._actor && BattleManager.canEscape()) {
      this.addCommand(TextManager.escape, "escape");
    }
  };

  // ========================================================================
  // ENEMY ATB DECISION — Pick skill + target when gauge is full
  // ========================================================================

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
      console.warn("[ATB_EnemyRuntime] Error executing enemy action:", e);
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

  // ========================================================================
  // UPDATE HOOK — Tick wander and AI each frame
  // ========================================================================

  const _BM_update_runtime = BattleManager.update;
  BattleManager.update = function(timeActive) {
    _BM_update_runtime.call(this, timeActive);

    if (this._phase === "battleEnd" || this._phase === "init" || this._phase === "start") return;

    // Update idle wander for all enemies
    for (const enemy of $gameTroop.aliveMembers()) {
      if (enemy && enemy.updateIdleWander) {
        enemy.updateIdleWander();
      }
    }

    this._updateEnemyAI();
  };

  console.log("[ATB_EnemyRuntime] v3.0 — Idle wander + action-only AI loaded.");
})();
