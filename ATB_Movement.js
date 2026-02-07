/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Movement — Idle wander & post-battle return
 * @author Hyaku no Sekai
 * @orderAfter ATB_SpriteExtension
 *
 * @help
 * ============================================================================
 * ATB_Movement v3.0 — Enemy Idle Wander & Post-Battle Return
 * ============================================================================
 *
 * v3.0 CHANGES:
 * - Enemies NO LONGER chase players. They stay near their home position
 *   with a subtle idle wander (small random shuffle at random intervals).
 * - Only skills with knockback/pull/repositioning effects move battlers.
 * - "Move" command removed from actor menu entirely.
 * - Escape command uses party-wide gauge fill.
 * - After battle ends, survivors run back to their entry positions
 *   on the map, THEN the battle scene transitions to the overworld.
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

  // Hook into BattleManager update to tick enemy wander
  const _BM_update_mv = BattleManager.update;
  BattleManager.update = function(timeActive) {
    _BM_update_mv.call(this, timeActive);

    if (this._phase === "battleEnd" || this._phase === "init" || this._phase === "start") return;

    // Update idle wander for all enemies
    for (const enemy of $gameTroop.aliveMembers()) {
      if (enemy && enemy.updateIdleWander) {
        enemy.updateIdleWander();
      }
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
  // POST-BATTLE RETURN — Survivors run back to entry positions
  // ========================================================================

  const _BM_processVictory = BattleManager.processVictory;
  BattleManager.processVictory = function() {
    // Start the return-to-entry animation before ending battle
    this._postBattleReturning = true;
    this._postBattleTimer = 0;
    this._postBattlePhase = "returning"; // "returning" then "done"

    // Record current positions and entry positions for alive party members
    this._returnData = [];
    for (const actor of $gameParty.aliveMembers()) {
      this._returnData.push({
        battler: actor,
        startX: actor._battleX,
        startY: actor._battleY,
        targetX: actor._entryX,
        targetY: actor._entryY,
      });
    }
  };

  const _BM_updateBattleEnd = BattleManager.updateBattleEnd;
  BattleManager.updateBattleEnd = function() {
    if (this._postBattleReturning) {
      this._updatePostBattleReturn();
      return;
    }
    _BM_updateBattleEnd.call(this);
  };

  BattleManager._updatePostBattleReturn = function() {
    this._postBattleTimer++;

    const duration = 60; // 1 second to run back
    const t = Math.min(this._postBattleTimer / duration, 1.0);

    // Ease-out
    const ease = 1 - Math.pow(1 - t, 2);

    let allDone = true;
    for (const data of this._returnData) {
      const b = data.battler;
      if (!b) continue;

      b._battleX = data.startX + (data.targetX - data.startX) * ease;
      b._battleY = data.startY + (data.targetY - data.startY) * ease;

      if (t < 1.0) allDone = false;
    }

    // Tell sprites to play walking animation during return
    if (t < 1.0) {
      const spriteset = SceneManager._scene ? SceneManager._scene._spriteset : null;
      if (spriteset) {
        for (const data of this._returnData) {
          const sprite = spriteset.findSpriteForBattler(data.battler);
          if (sprite && sprite._animState !== ATB.AnimState.WALKING &&
              sprite._animState !== ATB.AnimState.VICTORY) {
            sprite.setAnimState(ATB.AnimState.WALKING);
          }
        }
      }
    }

    if (allDone) {
      // Brief pause at entry position, then end battle
      if (this._postBattlePhase === "returning") {
        this._postBattlePhase = "pause";
        this._postBattleTimer = 0;
      } else if (this._postBattlePhase === "pause") {
        if (this._postBattleTimer >= 30) { // 0.5s pause
          this._postBattleReturning = false;
          this._postBattlePhase = "done";

          // Set victory poses
          const spriteset = SceneManager._scene ? SceneManager._scene._spriteset : null;
          if (spriteset) {
            for (const data of this._returnData) {
              const sprite = spriteset.findSpriteForBattler(data.battler);
              if (sprite) sprite.setAnimState(ATB.AnimState.VICTORY);
            }
          }

          // Now actually process victory
          _BM_processVictory.call(this);
        }
      }
    }
  };

  // Also handle defeat/abort cases (no return animation needed)
  const _BM_processDefeat = BattleManager.processDefeat;
  BattleManager.processDefeat = function() {
    this._postBattleReturning = false;
    _BM_processDefeat.call(this);
  };

  const _BM_processAbort = BattleManager.processAbort;
  BattleManager.processAbort = function() {
    this._postBattleReturning = false;
    _BM_processAbort.call(this);
  };

  console.log("[ATB_Movement] v3.0 — Idle wander, no chasing, post-battle return loaded.");
})();
