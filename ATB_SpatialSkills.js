/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Spatial Skills — Full screen range, no restrictions
 * @author Hyaku no Sekai
 * @orderAfter ATB_EnemyAI
 *
 * @help
 * ============================================================================
 * ATB_SpatialSkills v3.0 — Full Screen Range
 * ============================================================================
 *
 * v3.0 CHANGE: All skills have full screen range. No range checks,
 * no greyed-out skills, no auto-positioning required before acting.
 * Every attack and skill can reach any target on the battlefield.
 *
 * AoE shape helpers are preserved for future skill effect areas but
 * do NOT restrict targeting.
 *
 * Pierce line-hit detection is handled by ATB_SpriteExtension.
 */

(() => {
  "use strict";

  // ========================================================================
  // REMOVE ALL RANGE RESTRICTIONS FROM TARGETING
  // ========================================================================

  // Override any existing range-check on skill usability
  // MZ's base doesn't have spatial range checks, but our v2 did.
  // This ensures no range-based restrictions exist.

  // Skills are always usable regardless of distance
  const _GA_isValid = Game_Action.prototype.isValid;
  Game_Action.prototype.isValid = function() {
    // No spatial range check — purely ability/MP/state validation
    return _GA_isValid.call(this);
  };

  // ========================================================================
  // AOE HELPERS (informational — no targeting restriction)
  // ========================================================================

  /**
   * Get AoE shape info for a skill. Used by visual effects, NOT by targeting.
   */
  ATB.getSkillAoE = function(skill) {
    if (!skill) return { type: "SINGLE" };
    const tags = ATB.parseNotetags(skill);
    if (tags.aoeShape) {
      return {
        type: tags.aoeShape,
        radius: tags.aoeRadius || 80,
        length: tags.aoeLength || 0,
        angle:  tags.aoeAngle  || 0,
      };
    }
    return { type: "SINGLE" };
  };

  /**
   * Find all battlers within an AoE circle centered on a point.
   * Used for AoE damage application, NOT for targeting restriction.
   */
  ATB.getBattlersInRadius = function(centerX, centerY, radius, team) {
    const members = team === "enemy" ? $gameTroop.aliveMembers() :
                    team === "party" ? $gameParty.aliveMembers() :
                    BattleManager.allBattleMembers().filter(b => b && !b.isDead());

    const results = [];
    for (const b of members) {
      if (!b) continue;
      const dx = (b._battleX || 0) - centerX;
      const dy = (b._battleY || 0) - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        results.push(b);
      }
    }
    return results;
  };

  /**
   * Find all battlers in a line from point A to point B with given width.
   * Used by pierce skills and line AoEs.
   */
  ATB.getBattlersInLine = function(x1, y1, x2, y2, width, team) {
    const members = team === "enemy" ? $gameTroop.aliveMembers() :
                    team === "party" ? $gameParty.aliveMembers() :
                    BattleManager.allBattleMembers().filter(b => b && !b.isDead());

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    if (lineLen === 0) return [];

    // Normal vector perpendicular to line
    const nx = -dy / lineLen;
    const ny =  dx / lineLen;

    const halfWidth = width / 2;
    const results = [];

    for (const b of members) {
      if (!b) continue;
      const bx = (b._battleX || 0) - x1;
      const by = (b._battleY || 0) - y1;

      // Project onto line direction
      const along = (bx * dx + by * dy) / lineLen;
      // Check if along the line segment
      if (along < -ATB.DEFAULT_COLLISION_RAD || along > lineLen + ATB.DEFAULT_COLLISION_RAD) continue;

      // Distance from line
      const perp = Math.abs(bx * nx + by * ny);
      if (perp <= halfWidth + ATB.DEFAULT_COLLISION_RAD) {
        results.push(b);
      }
    }
    return results;
  };

  /**
   * Find all battlers in a cone from a point in a given direction.
   */
  ATB.getBattlersInCone = function(originX, originY, dirAngle, halfAngle, radius, team) {
    const members = team === "enemy" ? $gameTroop.aliveMembers() :
                    team === "party" ? $gameParty.aliveMembers() :
                    BattleManager.allBattleMembers().filter(b => b && !b.isDead());

    const dirRad = (dirAngle * Math.PI) / 180;
    const halfRad = (halfAngle * Math.PI) / 180;
    const results = [];

    for (const b of members) {
      if (!b) continue;
      const dx = (b._battleX || 0) - originX;
      const dy = (b._battleY || 0) - originY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius + ATB.DEFAULT_COLLISION_RAD) continue;

      const angle = Math.atan2(dy, dx);
      let diff = angle - dirRad;
      // Normalize to -PI..PI
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) <= halfRad) {
        results.push(b);
      }
    }
    return results;
  };

  console.log("[ATB_SpatialSkills] v3.0 — Full screen range, AoE helpers loaded.");
})();
