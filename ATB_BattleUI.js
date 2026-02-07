/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Battle UI — Gauges, telegraph, no range circles
 * @author Hyaku no Sekai
 * @orderAfter ATB_SpatialSkills
 *
 * @param SHOW_ATB_GAUGE
 * @text Show ATB Gauge
 * @type boolean
 * @default true
 *
 * @param GAUGE_WIDTH
 * @text Gauge Width
 * @type number
 * @default 60
 *
 * @param GAUGE_HEIGHT
 * @text Gauge Height
 * @type number
 * @default 6
 *
 * @param GAUGE_Y_OFFSET
 * @text Gauge Y Offset
 * @desc Pixels above the battler to draw the gauge
 * @type number
 * @default 8
 *
 * @param TELEGRAPH_COLOR
 * @text Telegraph Warning Color
 * @desc CSS color for telegraph warning circle
 * @default rgba(255, 80, 80, 0.4)
 *
 * @help
 * ============================================================================
 * ATB_BattleUI v3.0.1 — Battle UI Overlay
 * ============================================================================
 *
 * Draws ATB gauge bars above battlers and telegraph warning indicators.
 * Range circle indicators removed in v3.0 (all skills full screen range).
 *
 * Overlay creation is deferred to first update() to avoid init-order
 * issues with _battleField.
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "ATB_BattleUI";
  const p = PluginManager.parameters(PLUGIN_NAME);

  const SHOW_GAUGE    = p["SHOW_ATB_GAUGE"] !== "false";
  const GAUGE_WIDTH   = Number(p["GAUGE_WIDTH"] || 60);
  const GAUGE_HEIGHT  = Number(p["GAUGE_HEIGHT"] || 6);
  const GAUGE_Y_OFF   = Number(p["GAUGE_Y_OFFSET"] || 8);
  const TELEGRAPH_CLR = p["TELEGRAPH_COLOR"] || "rgba(255, 80, 80, 0.4)";

  // ========================================================================
  // ATB GAUGE SPRITE
  // ========================================================================

  class Sprite_AtbGauge extends Sprite {
    constructor(battler) {
      super();
      this._battler = battler;
      this.bitmap = new Bitmap(GAUGE_WIDTH + 2, GAUGE_HEIGHT + 2);
      this.anchor.set(0.5, 1.0);
    }

    update() {
      super.update();
      const b = this._battler;
      if (!b || b.isDead()) {
        this.visible = false;
        return;
      }
      this.visible = SHOW_GAUGE;
      this.x = b._battleX || 0;
      this.y = (b._battleY || 0) - GAUGE_Y_OFF;
      this._drawGauge();
    }

    _drawGauge() {
      const bmp = this.bitmap;
      bmp.clear();

      const b = this._battler;
      const rate = Math.min(1.0, (b._atbGauge || 0) / ATB.MAX_ATB_GAUGE);

      bmp.fillRect(0, 0, GAUGE_WIDTH + 2, GAUGE_HEIGHT + 2, "rgba(0,0,0,0.5)");

      const fillW = Math.floor(GAUGE_WIDTH * rate);
      const color = rate >= 1.0 ? "#ffdd44" :
                    b._atbCasting ? "#88aaff" :
                    b.isActor() ? "#44cc44" : "#cc4444";
      bmp.fillRect(1, 1, fillW, GAUGE_HEIGHT, color);
    }
  }

  // ========================================================================
  // TELEGRAPH SPRITE
  // ========================================================================

  class Sprite_Telegraph extends Sprite {
    constructor(battler) {
      super();
      this._battler = battler;
      this._maxRadius = 40;
      this.bitmap = new Bitmap(this._maxRadius * 2 + 4, this._maxRadius * 2 + 4);
      this.anchor.set(0.5, 0.5);
      this.visible = false;
    }

    update() {
      super.update();
      const b = this._battler;
      if (!b || !b._telegraphActive) {
        this.visible = false;
        return;
      }

      this.visible = true;
      const target = b._telegraphTarget;
      if (target) {
        this.x = target.x || 0;
        this.y = target.y || 0;
      } else {
        this.x = b._battleX || 0;
        this.y = b._battleY || 0;
      }

      this._drawTelegraph(b.telegraphRate ? b.telegraphRate() : 0);
    }

    _drawTelegraph(rate) {
      const bmp = this.bitmap;
      bmp.clear();

      const cx = this._maxRadius + 2;
      const cy = this._maxRadius + 2;
      const ctx = bmp.context;

      const radius = this._maxRadius * rate;
      const alpha = 0.3 + 0.3 * Math.sin(Date.now() / 150);

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
      ctx.fillStyle = TELEGRAPH_CLR.replace(/[\d.]+\)$/, alpha + ")");
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 60, 60, " + (0.5 + alpha) + ")";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ========================================================================
  // DEFERRED OVERLAY CREATION — Created on first update, not createLowerLayer
  // ========================================================================
  // This avoids ALL _battleField initialization order issues.

  const _SSB_update_ui = Spriteset_Battle.prototype.update;
  Spriteset_Battle.prototype.update = function() {
    _SSB_update_ui.call(this);

    // Create overlays on first update when everything is guaranteed initialized
    if (!this._atbOverlaysCreated) {
      this._atbOverlaysCreated = true;
      this._createAtbOverlays();
    }
  };

  Spriteset_Battle.prototype._createAtbOverlays = function() {
    this._atbGaugeSprites = [];
    this._atbTelegraphSprites = [];

    // Find the best container — _battleField should definitely exist by now
    const container = this._battleField || this._baseSprite || this;

    const allBattlers = $gameParty.battleMembers().concat($gameTroop.members());
    for (const battler of allBattlers) {
      if (!battler) continue;

      if (SHOW_GAUGE) {
        const gauge = new Sprite_AtbGauge(battler);
        this._atbGaugeSprites.push(gauge);
        container.addChild(gauge);
      }

      if (battler.isEnemy && battler.isEnemy()) {
        const telegraph = new Sprite_Telegraph(battler);
        this._atbTelegraphSprites.push(telegraph);
        container.addChild(telegraph);
      }
    }
  };

  console.log("[ATB_BattleUI] v3.0.1 — Deferred init, gauges + telegraph loaded.");
})();
