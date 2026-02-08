/*:
 * @target MZ
 * @plugindesc [ATB v3.0] Spatial Skills — Full screen range, no restrictions
 * @author Hyaku no Sekai
 * @orderAfter ATB_EnemyRuntime
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
 *
 * == AOE TAGS ==
 * <SkillAoE: CIRCLE, radius>
 * <SkillAoE: LINE, length, width>
 * <SkillAoE: CONE, radius, angle>
 * <AoEOrigin: caster|target>
 * <AoEApply: true|false>
 * <AoEWidth: N>
 * <AoELength: N>
 * <AoEAngle: N>
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
   * Get AoE shape info for a skill. Target expansion is optional via AoEApply.
   */
  ATB.getSkillAoE = function(skill) {
    if (!skill) return { type: "SINGLE" };
    const tags = ATB.parseNotetags(skill);
    if (tags.aoeShape) {
      return {
        type: tags.aoeShape,
        radius: tags.aoeRadius || 80,
        length: tags.aoeLength || tags.aoeRadius || 0,
        width: tags.aoeWidth || tags.aoeAngle || ATB.PIERCE_DEFAULT_WIDTH,
        angle:  tags.aoeAngle  || 0,
        origin: tags.aoeOrigin || "caster",
        applyTargets: tags.aoeApply !== false,
      };
    }
    return { type: "SINGLE" };
  };

  ATB.getAoEOriginPoint = function(action, baseTargets, origin) {
    const subject = action.subject();
    if (origin === "target" && baseTargets && baseTargets[0]) {
      const t = baseTargets[0];
      return { x: t._battleX || 0, y: t._battleY || 0 };
    }
    return { x: subject._battleX || 0, y: subject._battleY || 0 };
  };

  ATB.getAoEDirectionAngle = function(origin, baseTargets) {
    if (!baseTargets || !baseTargets[0]) return null;
    const t = baseTargets[0];
    const dx = (t._battleX || 0) - origin.x;
    const dy = (t._battleY || 0) - origin.y;
    if (dx === 0 && dy === 0) return null;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  };

  ATB.getAoETargets = function(action, baseTargets) {
    const item = action.item();
    if (!item) return baseTargets;
    const aoe = ATB.getSkillAoE(item);
    if (!aoe || aoe.type === "SINGLE") return baseTargets;

    const subject = action.subject();
    if (!subject) return baseTargets;
    const team = action.isForOpponent()
      ? (subject.isActor() ? "enemy" : "party")
      : (subject.isActor() ? "party" : "enemy");

    const origin = ATB.getAoEOriginPoint(action, baseTargets, aoe.origin);

    if (aoe.type === "CIRCLE") {
      return ATB.getBattlersInRadius(origin.x, origin.y, aoe.radius, team);
    }

    if (aoe.type === "LINE") {
      const dir = ATB.getAoEDirectionAngle(origin, baseTargets);
      if (dir === null) return baseTargets;
      const rad = (dir * Math.PI) / 180;
      const x2 = origin.x + Math.cos(rad) * aoe.length;
      const y2 = origin.y + Math.sin(rad) * aoe.length;
      return ATB.getBattlersInLine(origin.x, origin.y, x2, y2, aoe.width, team);
    }

    if (aoe.type === "CONE") {
      const dir = ATB.getAoEDirectionAngle(origin, baseTargets);
      if (dir === null) return baseTargets;
      const angle = aoe.angle || 60;
      return ATB.getBattlersInCone(origin.x, origin.y, dir, angle / 2, aoe.radius, team);
    }

    return baseTargets;
  };

  // ========================================================================
  // AOE TARGET EXPANSION — Preserve default behavior when no tags present
  // ========================================================================

  const _GA_makeTargets = Game_Action.prototype.makeTargets;
  Game_Action.prototype.makeTargets = function() {
    const targets = _GA_makeTargets.call(this);
    const item = this.item();
    if (!item) return targets;
    const aoe = ATB.getSkillAoE(item);
    if (!aoe || aoe.type === "SINGLE" || aoe.applyTargets === false) return targets;
    return ATB.getAoETargets(this, targets);
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
