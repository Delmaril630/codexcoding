/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Sprite Extension — Battle character sprites & movement
 * @author Hyaku no Sekai
 * @orderAfter ATB_Core
 *
 * @help
 * ============================================================================
 * ATB_SpriteExtension v3.0.1 — Battle Sprites & Skill Movement
 * ============================================================================
 *
 * Replaces MZ's side-view battler system with CT-style character sprites.
 * Handles all visual movement for the 5 SkillMove types:
 *
 *   stay       — Cast in place
 *   dashback   — Rush to target, attack, retreat to custom angle/dist or home
 *   rush       — Rush to target, attack, stay there
 *   passthrough — Rush to target, attack, continue past
 *   pierce     — Line charge through all enemies in path
 *
 * Also: no map blur, no battleback, death fade to 0, afterimages on crit.
 */

(() => {
  "use strict";

  // ========================================================================
  // ANIMATION STATES
  // ========================================================================
  const AnimState = {
    IDLE:       "idle",
    WALKING:    "walking",
    ATTACKING:  "attacking",
    CASTING:    "casting",
    DAMAGED:    "damaged",
    DODGING:    "dodging",
    DEAD:       "dead",
    VICTORY:    "victory",
    RUSHING:    "rushing",
    RETURNING:  "returning",
    PASSTHROUGH:"passthrough",
    PIERCING:   "piercing",
  };

  const WALK_DIR_DOWN  = 0;
  const WALK_DIR_LEFT  = 1;
  const WALK_DIR_RIGHT = 2;
  const WALK_DIR_UP    = 3;

  // ========================================================================
  // SAFE CONTAINER HELPER
  // ========================================================================
  function _safeContainer(spriteset) {
    if (spriteset._battleField) return spriteset._battleField;
    if (spriteset._baseSprite) return spriteset._baseSprite;
    return spriteset;
  }

  // ========================================================================
  // NO MAP BLUR — Keep map crisp behind battle (CT-style)
  // ========================================================================
  const _SM_snapForBackground = SceneManager.snapForBackground;
  SceneManager.snapForBackground = function() {
    _SM_snapForBackground.call(this);
    if (this._backgroundBitmap) {
      this._backgroundBitmap = Bitmap.snap(this._scene);
    }
  };

  // ========================================================================
  // NO BATTLEBACK + SAFE INIT
  // ========================================================================
  // Instead of overriding createBattleback (which has init-order issues),
  // we hook into createLowerLayer AFTER everything is created and hide them.
  const _SSB_createLowerLayer_ext = Spriteset_Battle.prototype.createLowerLayer;
  Spriteset_Battle.prototype.createLowerLayer = function() {
    _SSB_createLowerLayer_ext.call(this);
    // Hide battlebacks so the map shows through
    if (this._back1Sprite) this._back1Sprite.visible = false;
    if (this._back2Sprite) this._back2Sprite.visible = false;
  };

  // ========================================================================
  // Sprite_BattleCharacter — Main battle sprite class
  // ========================================================================

  class Sprite_BattleCharacter extends Sprite_Battler {
    constructor(battler) {
      super(battler);
      this._battler = battler;
      this._animState = AnimState.IDLE;
      this._animFrame = 0;
      this._animTimer = 0;
      this._animCallback = null;
      this._afterimages = [];

      this._rushStartX = 0;
      this._rushStartY = 0;
      this._rushTargetX = 0;
      this._rushTargetY = 0;
      this._rushProgress = 0;
      this._rushSpeed = ATB.RUSH_SPEED;
      this._isCritRush = false;
      this._moveType = "dashback";
      this._retreatInfo = null;
      this._skillAction = null;
      this._stayAtTarget = false;

      this._passthroughDestX = 0;
      this._passthroughDestY = 0;

      this._pierceTargetX = 0;
      this._pierceTargetY = 0;
      this._pierceWidth = ATB.PIERCE_DEFAULT_WIDTH;
      this._pierceDamaged = new Set();

      this._deathFadeTimer = -1;

      this._largeBitmap = null;
      this._largeFrameW = 0;
      this._largeFrameH = 0;

      this._charBitmap = null;
      this._charIndex = 0;

      this._loadBattlerGraphic();
    }

    _loadBattlerGraphic() {
      const b = this._battler;
      if (!b) return;

      try {
        if (b.isEnemy()) {
          const enemy = b.enemy();
          if (!enemy) return;
          const tags = ATB.parseNotetags(enemy);

          if (tags.battleCharSheet) {
            this._charBitmap = ImageManager.loadCharacter(tags.battleCharSheet);
            this._charIndex = 0;
          } else if (tags.battleSprite) {
            this._largeBitmap = ImageManager.loadEnemy(tags.battleSprite);
            if (tags.battleSize) {
              this._largeFrameW = tags.battleSize.w;
              this._largeFrameH = tags.battleSize.h;
            }
          } else {
            const name = b.battlerName();
            if (name) {
              if ($gameSystem.isSideView()) {
                this._largeBitmap = ImageManager.loadSvEnemy(name);
              } else {
                this._largeBitmap = ImageManager.loadEnemy(name);
              }
            }
          }
        } else if (b.isActor()) {
          const actor = b.actor();
          if (!actor) return;
          const tags = ATB.parseNotetags(actor);
          const charName = tags.battleSheet || b.characterName();
          if (charName) {
            this._charBitmap = ImageManager.loadCharacter(charName);
            this._charIndex = b.characterIndex();
          }
        }
      } catch (e) {
        console.warn("[ATB_SpriteExt] Error loading battler graphic:", e);
      }
    }

    setAnimState(state, callback) {
      if (this._animState === AnimState.DEAD && state !== AnimState.IDLE) return;
      this._animState = state;
      this._animFrame = 0;
      this._animTimer = 0;
      this._animCallback = callback || null;
    }

    update() {
      super.update();
      if (!this._battler) return;

      this.updateAnimState();
      this.updateFrame();
      this.updateBattlePosition();
      this.updateDeathFade();
      this.updateAfterimages();
      this.updateScale();
    }

    updateScale() {
      this.scale.x = ATB.BATTLER_SCALE;
      this.scale.y = ATB.BATTLER_SCALE;
    }

    updateBattlePosition() {
      const b = this._battler;
      if (!b) return;

      switch (this._animState) {
        case AnimState.RUSHING:    this.updateRush(); break;
        case AnimState.RETURNING:  this.updateReturn(); break;
        case AnimState.PASSTHROUGH:this.updatePassthrough(); break;
        case AnimState.PIERCING:   this.updatePierce(); break;
      }

      this.x = b._battleX;
      this.y = b._battleY;
    }

    updateAnimState() {
      this._animTimer++;
      const fd = 12;

      switch (this._animState) {
        case AnimState.IDLE:
          if (this._animTimer >= fd) {
            this._animTimer = 0;
            this._animFrame = (this._animFrame + 1) % 3;
          }
          break;

        case AnimState.WALKING:
        case AnimState.RUSHING:
        case AnimState.RETURNING:
        case AnimState.PASSTHROUGH:
        case AnimState.PIERCING:
          if (this._animTimer >= 8) {
            this._animTimer = 0;
            this._animFrame = (this._animFrame + 1) % 4;
          }
          break;

        case AnimState.ATTACKING:
        case AnimState.CASTING:
          if (this._animTimer >= fd) {
            this._animTimer = 0;
            this._animFrame++;
            if (this._animFrame >= 3) {
              if (this._animCallback) {
                const cb = this._animCallback;
                this._animCallback = null;
                cb();
              } else {
                this.setAnimState(AnimState.IDLE);
              }
            }
          }
          break;

        case AnimState.DAMAGED:
          if (this._animTimer >= 30) this.setAnimState(AnimState.IDLE);
          break;

        case AnimState.DODGING:
          if (this._animTimer >= 20) this.setAnimState(AnimState.IDLE);
          break;

        case AnimState.DEAD:
          break;

        case AnimState.VICTORY:
          if (this._animTimer >= fd) {
            this._animTimer = 0;
            this._animFrame = (this._animFrame + 1) % 3;
          }
          break;
      }
    }

    updateFrame() {
      if (this._charBitmap && this._charBitmap.isReady()) {
        this.updateCharacterFrame();
      } else if (this._largeBitmap && this._largeBitmap.isReady()) {
        this.updateLargeFrame();
      }
    }

    updateCharacterFrame() {
      const bmp = this._charBitmap;
      if (!bmp || !bmp.isReady()) return;
      this.bitmap = bmp;

      const charName = this._getBattlerCharName();
      const big = charName ? ImageManager.isBigCharacter(charName) : false;
      const pw = big ? bmp.width / 3 : bmp.width / 12;
      const ph = big ? bmp.height / 4 : bmp.height / 8;

      const ci = this._charIndex;
      const col = big ? 0 : (ci % 4);
      const row = big ? 0 : Math.floor(ci / 4);
      const dir = this._getDirectionRow();
      const frame = Math.min(this._animFrame, 2);

      this.setFrame((col * 3 + frame) * pw, (row * 4 + dir) * ph, pw, ph);
      this.anchor.set(0.5, 1.0);
    }

    _getBattlerCharName() {
      const b = this._battler;
      if (!b) return "";
      try {
        if (b.isActor()) {
          const actor = b.actor();
          const tags = actor ? ATB.parseNotetags(actor) : {};
          return tags.battleSheet || b.characterName() || "";
        } else {
          const enemy = b.enemy();
          const tags = enemy ? ATB.parseNotetags(enemy) : {};
          return tags.battleCharSheet || "";
        }
      } catch (e) {
        return "";
      }
    }

    _getDirectionRow() {
      const b = this._battler;
      if (!b) return WALK_DIR_DOWN;

      if (this._animState === AnimState.RUSHING ||
          this._animState === AnimState.PIERCING) {
        const dx = this._rushTargetX - b._battleX;
        const dy = this._rushTargetY - b._battleY;
        if (Math.abs(dx) > Math.abs(dy)) {
          return dx > 0 ? WALK_DIR_RIGHT : WALK_DIR_LEFT;
        }
        return dy > 0 ? WALK_DIR_DOWN : WALK_DIR_UP;
      }

      if (this._animState === AnimState.RETURNING ||
          this._animState === AnimState.PASSTHROUGH) {
        const dx = this._rushTargetX - b._battleX;
        if (Math.abs(dx) > 5) {
          return dx > 0 ? WALK_DIR_RIGHT : WALK_DIR_LEFT;
        }
      }

      return b.isActor() ? WALK_DIR_RIGHT : WALK_DIR_LEFT;
    }

    updateLargeFrame() {
      const bmp = this._largeBitmap;
      if (!bmp || !bmp.isReady()) return;
      this.bitmap = bmp;

      if (this._largeFrameW <= 0 || this._largeFrameH <= 0) {
        this.setFrame(0, 0, bmp.width, bmp.height);
        this.anchor.set(0.5, 1.0);
        return;
      }

      const fw = this._largeFrameW;
      const fh = this._largeFrameH;
      const frame = Math.min(this._animFrame, 2);
      this.setFrame(frame * fw, 0, fw, fh);
      this.anchor.set(0.5, 1.0);
    }

    // ================================================================
    // DEATH FADE
    // ================================================================

    updateDeathFade() {
      const b = this._battler;
      if (!b) return;

      if (b.isDead()) {
        if (this._animState !== AnimState.DEAD) {
          this.setAnimState(AnimState.DEAD);
          this._deathFadeTimer = 60;
        }
        if (this._deathFadeTimer > 0) {
          this._deathFadeTimer--;
          this.opacity = Math.floor(255 * (this._deathFadeTimer / 60));
        } else {
          this.opacity = 0;
        }
      } else {
        this._deathFadeTimer = -1;
        if (this.opacity < 255 && this._animState !== AnimState.DEAD) {
          this.opacity = 255;
        }
      }
    }

    updateAfterimages() {
      for (let i = this._afterimages.length - 1; i >= 0; i--) {
        this._afterimages[i].alpha -= 0.05;
        if (this._afterimages[i].alpha <= 0) this._afterimages.splice(i, 1);
      }
    }

    // ================================================================
    // PERFORM ACTION — Entry point
    // ================================================================

    performAction(action) {
      if (!action) return;
      const item = action.item();
      if (!item) return;

      const moveType = ATB.getSkillMoveType(action);
      this._moveType = moveType;
      this._skillAction = action;
      this._retreatInfo = ATB.getRetreatInfo(item);

      switch (moveType) {
        case "dashback":    this._performDashback(action); break;
        case "rush":        this._performRush(action); break;
        case "passthrough": this._performPassthrough(action); break;
        case "pierce":      this._performPierce(action); break;
        case "stay": default: this._performStay(action); break;
      }
    }

    _performStay(action) {
      const isPhys = action.isAttack() || (action.item() && action.item().hitType === 1);
      this.setAnimState(isPhys ? AnimState.ATTACKING : AnimState.CASTING, () => {
        this.setAnimState(AnimState.IDLE);
      });
    }

    _performDashback(action) {
      const target = this._findTarget(action);
      if (!target) { this._performStay(action); return; }
      this._stayAtTarget = false;
      this._startRushTo(target);
    }

    _performRush(action) {
      const target = this._findTarget(action);
      if (!target) { this._performStay(action); return; }
      this._stayAtTarget = true;
      this._startRushTo(target);
    }

    _performPassthrough(action) {
      const target = this._findTarget(action);
      if (!target) { this._performStay(action); return; }

      const b = this._battler;
      this._rushStartX = b._battleX;
      this._rushStartY = b._battleY;

      const tx = target._battleX || 0;
      const ty = target._battleY || 0;
      const offset = (b.isActor() ? -1 : 1) * (ATB.DEFAULT_COLLISION_RAD * 2);
      this._rushTargetX = tx + offset;
      this._rushTargetY = ty;
      this._rushProgress = 0;
      this._rushSpeed = ATB.RUSH_SPEED;

      const dx = tx - b._battleX;
      const dy = ty - b._battleY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const overshoot = Math.max(80, dist * 0.5);
      const dest = ATB.clampToBattlefield(tx + nx * overshoot, ty + ny * overshoot);
      this._passthroughDestX = dest.x;
      this._passthroughDestY = dest.y;

      this.setAnimState(AnimState.RUSHING);
    }

    _performPierce(action) {
      const target = this._findTarget(action);
      if (!target) { this._performStay(action); return; }

      const b = this._battler;
      const item = action.item();
      this._rushStartX = b._battleX;
      this._rushStartY = b._battleY;
      this._rushTargetX = target._battleX || 0;
      this._rushTargetY = target._battleY || 0;

      const dx = this._rushTargetX - b._battleX;
      const dy = this._rushTargetY - b._battleY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const dest = ATB.clampToBattlefield(
        this._rushTargetX + nx * 60,
        this._rushTargetY + ny * 60
      );
      this._pierceTargetX = dest.x;
      this._pierceTargetY = dest.y;
      this._pierceWidth = ATB.getPierceWidth(item);
      this._pierceDamaged = new Set();
      this._rushProgress = 0;
      this._rushSpeed = ATB.RUSH_SPEED * 1.2;

      this.setAnimState(AnimState.PIERCING);
    }

    _findTarget(action) {
      try {
        const targets = action.makeTargets();
        return (targets && targets[0]) ? targets[0] : null;
      } catch (e) { return null; }
    }

    _startRushTo(target) {
      const b = this._battler;
      this._rushStartX = b._battleX;
      this._rushStartY = b._battleY;

      const offset = (b.isActor() ? -1 : 1) * (ATB.DEFAULT_COLLISION_RAD * 2);
      this._rushTargetX = (target._battleX || 0) + offset;
      this._rushTargetY = target._battleY || 0;
      this._rushProgress = 0;
      this._rushSpeed = ATB.RUSH_SPEED;
      this._isCritRush = false;

      this.setAnimState(AnimState.RUSHING);
    }

    // ================================================================
    // RUSH
    // ================================================================

    updateRush() {
      const b = this._battler;
      if (!b) return;

      this._rushProgress += this._rushSpeed;
      const t = 1 - Math.pow(1 - Math.min(this._rushProgress, 1.0), 2);

      if (this._rushProgress >= 1.0) {
        b._battleX = this._rushTargetX;
        b._battleY = this._rushTargetY;
        this.setAnimState(AnimState.ATTACKING, () => this._onRushComplete());
      } else {
        b._battleX = this._rushStartX + (this._rushTargetX - this._rushStartX) * t;
        b._battleY = this._rushStartY + (this._rushTargetY - this._rushStartY) * t;
      }

      if (this._isCritRush && this._afterimages.length < 4) {
        this._afterimages.push({ x: this.x, y: this.y, alpha: 0.5 });
      }
    }

    _onRushComplete() {
      const b = this._battler;

      if (this._moveType === "passthrough") {
        this._rushStartX = b._battleX;
        this._rushStartY = b._battleY;
        this._rushTargetX = this._passthroughDestX;
        this._rushTargetY = this._passthroughDestY;
        this._rushProgress = 0;
        this._rushSpeed = ATB.RUSH_SPEED * 0.8;
        this.setAnimState(AnimState.PASSTHROUGH);
        return;
      }

      if (this._stayAtTarget) {
        b._homeX = b._battleX;
        b._homeY = b._battleY;
        this.setAnimState(AnimState.IDLE);
        return;
      }

      this._startRetreat();
    }

    // ================================================================
    // RETREAT / RETURN
    // ================================================================

    _startRetreat() {
      const b = this._battler;
      this._rushStartX = b._battleX;
      this._rushStartY = b._battleY;

      if (this._retreatInfo) {
        const dest = ATB.calcRetreatPoint(
          b._battleX, b._battleY,
          this._retreatInfo.angle,
          this._retreatInfo.dist
        );
        this._rushTargetX = dest.x;
        this._rushTargetY = dest.y;
        b._homeX = dest.x;
        b._homeY = dest.y;
      } else {
        const scatter = ATB.RETREAT_SCATTER;
        const sx = b._homeX + (Math.random() - 0.5) * scatter * 2;
        const sy = b._homeY + (Math.random() - 0.5) * scatter * 2;
        const dest = ATB.clampToBattlefield(sx, sy);
        this._rushTargetX = dest.x;
        this._rushTargetY = dest.y;
      }

      this._rushProgress = 0;
      this._rushSpeed = ATB.RETURN_SPEED;
      this.setAnimState(AnimState.RETURNING);
    }

    updateReturn() {
      const b = this._battler;
      if (!b) return;

      this._rushProgress += this._rushSpeed;
      const t = 1 - Math.pow(1 - Math.min(this._rushProgress, 1.0), 2);

      if (this._rushProgress >= 1.0) {
        b._battleX = this._rushTargetX;
        b._battleY = this._rushTargetY;
        this.setAnimState(AnimState.IDLE);
      } else {
        b._battleX = this._rushStartX + (this._rushTargetX - this._rushStartX) * t;
        b._battleY = this._rushStartY + (this._rushTargetY - this._rushStartY) * t;
      }
    }

    updatePassthrough() {
      const b = this._battler;
      if (!b) return;

      this._rushProgress += this._rushSpeed;
      const t = Math.min(this._rushProgress, 1.0);

      if (this._rushProgress >= 1.0) {
        b._battleX = this._rushTargetX;
        b._battleY = this._rushTargetY;
        b._homeX = b._battleX;
        b._homeY = b._battleY;
        this.setAnimState(AnimState.IDLE);
      } else {
        b._battleX = this._rushStartX + (this._rushTargetX - this._rushStartX) * t;
        b._battleY = this._rushStartY + (this._rushTargetY - this._rushStartY) * t;
      }
    }

    updatePierce() {
      const b = this._battler;
      if (!b) return;

      this._rushProgress += this._rushSpeed;
      const t = Math.min(this._rushProgress, 1.0);

      b._battleX = this._rushStartX + (this._pierceTargetX - this._rushStartX) * t;
      b._battleY = this._rushStartY + (this._pierceTargetY - this._rushStartY) * t;

      this._checkPierceHits();

      if (this._rushProgress >= 1.0) {
        b._battleX = this._pierceTargetX;
        b._battleY = this._pierceTargetY;
        this._moveType = "dashback";
        this.setAnimState(AnimState.ATTACKING, () => this._startRetreat());
      }
    }

    _checkPierceHits() {
      const b = this._battler;
      if (!b || !this._skillAction) return;

      const halfWidth = this._pierceWidth / 2;
      const opponents = b.isActor() ? $gameTroop.aliveMembers() : $gameParty.aliveMembers();

      for (const enemy of opponents) {
        if (!enemy || enemy.isDead() || this._pierceDamaged.has(enemy)) continue;

        const dx = (enemy._battleX || 0) - b._battleX;
        const dy = (enemy._battleY || 0) - b._battleY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= halfWidth + ATB.DEFAULT_COLLISION_RAD) {
          this._pierceDamaged.add(enemy);
          try {
            this._skillAction.apply(enemy);
            if (enemy.isDead()) enemy.performCollapse();
            if (enemy.result) {
              const r = enemy.result();
              if (r.hpDamage !== 0) enemy.startDamagePopup();
            }
          } catch (e) {
            console.warn("[ATB_SpriteExt] Pierce damage error:", e);
          }
        }
      }
    }

    // ================================================================
    // DAMAGE / DODGE / VICTORY / COLLAPSE
    // ================================================================

    performDamage()   { this.setAnimState(AnimState.DAMAGED); }
    performDodge()    { this.setAnimState(AnimState.DODGING); }
    performVictory()  { this.setAnimState(AnimState.VICTORY); }
    performCollapse() { this.setAnimState(AnimState.DEAD); this._deathFadeTimer = 60; }
  }

  // Expose
  ATB.Sprite_BattleCharacter = Sprite_BattleCharacter;
  ATB.AnimState = AnimState;

  // ========================================================================
  // SPRITESET_BATTLE — Replace sprite creation (safe container)
  // ========================================================================

  Spriteset_Battle.prototype.createActors = function() {
    this._actorSprites = [];
    const container = _safeContainer(this);
    for (const actor of $gameParty.battleMembers()) {
      const sprite = new Sprite_BattleCharacter(actor);
      this._actorSprites.push(sprite);
      container.addChild(sprite);
    }
  };

  Spriteset_Battle.prototype.createEnemies = function() {
    this._enemySprites = [];
    const container = _safeContainer(this);
    for (const enemy of $gameTroop.members()) {
      const sprite = new Sprite_BattleCharacter(enemy);
      this._enemySprites.push(sprite);
      container.addChild(sprite);
    }
  };

  Spriteset_Battle.prototype.findSpriteForBattler = function(battler) {
    if (!battler) return null;
    const all = (this._actorSprites || []).concat(this._enemySprites || []);
    for (const s of all) {
      if (s && s._battler === battler) return s;
    }
    return null;
  };

  // ========================================================================
  // HOOK — Connect action execution to sprite movement
  // ========================================================================

  const _BM_startAction = BattleManager.startAction;
  BattleManager.startAction = function() {
    _BM_startAction.call(this);

    const subject = this._subject;
    const action = subject ? subject.currentAction() : null;
    if (!subject || !action) return;

    const scene = SceneManager._scene;
    const spriteset = scene ? scene._spriteset : null;
    if (!spriteset || !spriteset.findSpriteForBattler) return;

    const sprite = spriteset.findSpriteForBattler(subject);
    if (sprite && sprite.performAction) {
      sprite.performAction(action);
    }
  };

  // ========================================================================
  // SAFE ANIMATION GUARDS
  // ========================================================================

  const _SA_update = Sprite_Animation.prototype.update;
  Sprite_Animation.prototype.update = function() {
    try { _SA_update.call(this); } catch (e) { /* suppress */ }
  };

  if (Sprite_Animation.prototype.targetPosition) {
    const _orig = Sprite_Animation.prototype.targetPosition;
    Sprite_Animation.prototype.targetPosition = function(renderer) {
      try { return _orig.call(this, renderer); } catch (e) { return { x: 0, y: 0 }; }
    };
  }

  if (Sprite_Animation.prototype.targetSpritePosition) {
    const _orig2 = Sprite_Animation.prototype.targetSpritePosition;
    Sprite_Animation.prototype.targetSpritePosition = function(sprite) {
      try { return _orig2.call(this, sprite); } catch (e) { return { x: 0, y: 0 }; }
    };
  }

  console.log("[ATB_SpriteExtension] v3.0.1 — Safe init, skill movement loaded.");
})();
