/*:
 * @target MZ
 * @plugindesc DotMoveSystem bridge for MMORPG_ plugins with Combat Status support
 * @author Nate, Gemini 3 Pro, and Claude
 * @orderAfter DotMoveSystem
 * @orderAfter MMORPG_Characters
 * @orderAfter Geck_CombatStatus
 *
 * @param heartbeatInterval
 * @text Heartbeat Interval (ms)
 * @type number
 * @min 1000
 * @max 5000
 * @default 2000
 * @desc Safety net position sync interval during movement.
 *
 * @help
 * ============================================================================
 * MMORPG + DOT MOVE BRIDGE v19.0 (Velocity-Only Sync)
 * ============================================================================
 * 
 * NETWORK STRATEGY:
 * - Sends ONLY on: start, stop, direction change
 * - Heartbeat every 2 sec as safety net (corrects major drift)
 * - Receiver uses pure dead reckoning (no position corrections)
 * - Result: Buttery smooth movement, minimal network traffic
 * 
 * FEATURES:
 * 1. MOVEMENT: Velocity-based sync for smooth remote player movement
 * 2. FACING: Syncs direction changes instantly
 * 3. INTERACTION: Restores Action Button functionality on remote players
 * 4. COMBAT: Respects Geck_CombatStatus - freezes remote players in combat
 * 
 * v19.0 Changes:
 * - Velocity-only sync (no position spam during movement)
 * - Pure dead reckoning on receiver (no jitter corrections)
 * - 2-second heartbeat for desync recovery
 * - ~90%+ reduction in movement network traffic
 */

(() => {
    // Safety Check
    if (typeof DotMoveSystem === "undefined") return;

    // Plugin Parameters
    const pluginName = "MMORPG_DotMove_Bridge";
    const parameters = PluginManager.parameters(pluginName);
    const HEARTBEAT_INTERVAL = Number(parameters["heartbeatInterval"]) || 2000;

    console.log(`MMORPG_DotMove_Bridge v19.0 loaded - Heartbeat: ${HEARTBEAT_INTERVAL}ms`);

    // Helper: Read MMORPG Config
    function showLoginName() {
        return PluginManager.parameters("MMORPG_Characters")["showLoginName"] == "true";
    }

    // Helper: Resolve account username from userId (populated by Social/Mail listeners)
    function lookupAccountUsername(userId) {
        try {
            const dir = window.MMO_UserDirectory;
            if (dir && typeof dir.get === 'function') {
                const u = dir.get(userId);
                if (u) return String(u);
            }
        } catch (_) {}
        return null;
    }


    // Helper: Convert Physical Vector to 8-Way Direction
    function vectorToDir8(dx, dy) {
        const threshold = 0.0001; 
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return 0;

        const angle = Math.atan2(dy, dx); 
        const deg = (angle * 180 / Math.PI) + 90; 
        const d = (deg + 360) % 360;

        if (d < 22.5)  return 8;
        if (d < 67.5)  return 9;
        if (d < 112.5) return 6;
        if (d < 157.5) return 3;
        if (d < 202.5) return 2;
        if (d < 247.5) return 1;
        if (d < 292.5) return 4;
        if (d < 337.5) return 7;
        return 8;
    }

    // Helper: Get velocity components from d8 direction
    function dir8ToVelocity(d8) {
        switch (d8) {
            case 1: return { vx: -1, vy:  1 }; // down-left
            case 2: return { vx:  0, vy:  1 }; // down
            case 3: return { vx:  1, vy:  1 }; // down-right
            case 4: return { vx: -1, vy:  0 }; // left
            case 6: return { vx:  1, vy:  0 }; // right
            case 7: return { vx: -1, vy: -1 }; // up-left
            case 8: return { vx:  0, vy: -1 }; // up
            case 9: return { vx:  1, vy: -1 }; // up-right
            default: return { vx: 0, vy: 0 }; // stopped
        }
    }

    // ========================================================================
    // 1. SENDER: Velocity-Only Sync (send on start/stop/direction change)
    // ========================================================================
    
    Game_CharacterBase.prototype.packChar = function() {
        return {
            x: this._realX,
            y: this._realY,
            // On stop packets, send the direction captured when movement ended,
            // not the current direction (which RPG Maker may have changed).
            d: (this === $gamePlayer && this._netD8 === 0 && this._lastMovingDir)
                ? this._lastMovingDir : this.direction(),
            s: this.realMoveSpeed(),
            d8: (this === $gamePlayer) ? this._netD8 : 0
        };
    };

    Game_Player.prototype.initNetworkInput = function() {
        this._netD8 = 0;           
        this._lastSentD8 = 0;     
        this._lastSentDir = this.direction(); 
        this._lastMovingDir = this.direction(); // direction while actively moving
        this._lastSendTime = 0;
        this._lastHeartbeat = 0;
        this._frameLastX = this._realX; 
        this._frameLastY = this._realY;
        this._stoppedFrames = 0; // Debounce counter for stops
    };

    // Force-send a d8=0 stop packet immediately (no debounce).
    // Called when the player is locked out of movement (menu, event, combat,
    // scene transition, etc.) while remotes still think we're walking.
    Game_Player.prototype.forceNetworkStop = function() {
        // Capture direction before clearing state — _lastMovingDir was
        // updated every frame while moving, so it holds the correct facing.
        if (!this._lastMovingDir) this._lastMovingDir = this.direction();
        this._netD8 = 0;
        this._lastSentD8 = 0;
        this._stoppedFrames = STOP_DEBOUNCE_FRAMES;
        this._lastSendTime = performance.now();
        if (this.publishMoves) this.publishMoves();
        if (this.savePosition) this.savePosition();
    };

    const _Game_Player_update = Game_Player.prototype.update;
    Game_Player.prototype.update = function(sceneActive) {
        _Game_Player_update.call(this, sceneActive);

        if (this._frameLastX === undefined) this.initNetworkInput();

        // Network Logic - check if we can move AND not in active combat
        if (sceneActive) {
            // Check if in active combat (method provided by Geck_CombatStatus)
            const inCombat = this.isInActiveCombat && this.isInActiveCombat();
            
            if (!inCombat && this.canMove()) {
                this.checkNetworkInput();
            } else if (this._lastSentD8 !== 0) {
                // Player was moving but is now locked (menu, event, combat).
                // Force an immediate stop so remotes don't keep dead-reckoning.
                this.forceNetworkStop();
            }
        } else if (this._lastSentD8 !== 0) {
            // Scene is no longer active (transition, battle start, etc.)
            this.forceNetworkStop();
        }

        this._frameLastX = this._realX;
        this._frameLastY = this._realY;
    };

    const STOP_DEBOUNCE_FRAMES = 3; // Wait 3 frames before confirming stop
    const STOP_SAFETY_TIMEOUT = 200; // ms - force stop if nothing sent and we appear stopped
    
    Game_Player.prototype.checkNetworkInput = function() {
        if (this._lastSentD8 === undefined) this.initNetworkInput();

        const dx = this._realX - this._frameLastX;
        const dy = this._realY - this._frameLastY;
        
        // Threshold must be high enough to ignore DotMove floating-point
        // artifacts during collision resolution, especially diagonal slides.
        const moveThreshold = 0.02; 
		this._netD8 = (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) ? vectorToDir8(dx, dy) : 0;

        // Track stopped frames for debounce
        if (this._netD8 === 0) {
            this._stoppedFrames++;
        } else {
            this._stoppedFrames = 0;
            // Continuously track direction while moving so it's correct
            // when we stop (frozen at last moving frame automatically)
            this._lastMovingDir = this.direction();
        }

        const now = performance.now();
        
        // Detect state changes
        const directionChanged = this._netD8 !== this._lastSentD8 && this._netD8 !== 0 && this._lastSentD8 !== 0;
        // FIX: >= instead of === so a stop blocked by cooldown retries next frame
        const stopped = this._stoppedFrames >= STOP_DEBOUNCE_FRAMES && this._lastSentD8 !== 0;
        const started = this._netD8 !== 0 && this._lastSentD8 === 0;
        const facingChanged = this.direction() !== this._lastSentDir && this._netD8 === 0;
        
        // Heartbeat: periodic position sync while moving (safety net)
        const needsHeartbeat = this._netD8 !== 0 && (now - this._lastHeartbeat) >= HEARTBEAT_INTERVAL;

        // Safety net: if remotes think we're moving (_lastSentD8 !== 0) but
        // we haven't sent anything for STOP_SAFETY_TIMEOUT ms, force a stop.
        // Catches edge cases where debounce flicker (diagonal wall collision)
        // keeps resetting _stoppedFrames indefinitely.
        const safetyStop = this._lastSentD8 !== 0 && this._netD8 === 0
            && (now - this._lastSendTime) >= STOP_SAFETY_TIMEOUT;
        
        // Minimum 50ms between any sends — but stops always go through
        const cooldownOk = (now - this._lastSendTime) >= 50;
        const wantStop = stopped || safetyStop;
        
        const shouldSend = (wantStop || (cooldownOk && (started || directionChanged || facingChanged || needsHeartbeat)));

        if (shouldSend) {
            // For stop, update lastSentD8 to 0; otherwise use current netD8
            this._lastSentD8 = wantStop ? 0 : this._netD8;
            this._lastSentDir = this.direction();
            this._lastSendTime = now;
            if (needsHeartbeat || started || directionChanged) {
                this._lastHeartbeat = now;
            }

            if (this.publishMoves) this.publishMoves();
            
            // Only save position on stop
            if (wantStop && this.savePosition) this.savePosition();
        }
    };

    // ========================================================================
    // 2. RECEIVER: Pure Velocity-Based Movement
    // ========================================================================

    // Helper: Calculate d8 direction from position delta
    function positionToDir8(dx, dy) {
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return 0;
        const angle = Math.atan2(dy, dx);
        const deg = ((angle * 180 / Math.PI) + 360) % 360;
        
        // Convert angle to d8 (right=0°, down=90°, left=180°, up=270°)
        if (deg < 22.5 || deg >= 337.5) return 6;  // right
        if (deg < 67.5)  return 3;  // down-right
        if (deg < 112.5) return 2;  // down
        if (deg < 157.5) return 1;  // down-left
        if (deg < 202.5) return 4;  // left
        if (deg < 247.5) return 7;  // up-left
        if (deg < 292.5) return 8;  // up
        return 9;  // up-right
    }
    
    const _Game_CharacterBase_setChar = Game_CharacterBase.prototype.setChar;
    Game_CharacterBase.prototype.setChar = function(char) {
        const result = _Game_CharacterBase_setChar.call(this, char);
        if (!result) return false;

        const { x, y, d, s, d8 } = char;

        // Check if this specific character is frozen due to combat
        if (this._combatFrozen === true) {
            if (d && this !== $gamePlayer) this.setDirection(d);
            this._remoteD8 = 0;
            return true;
        }

        // Store remote velocity state
        this._remoteD8 = d8 || 0;
        this._remoteSpeed = s || this.realMoveSpeed();

        // Only use position for stop (final sync) or heartbeat correction
        if (this._remoteD8 === 0) {
            // Stopped — snap directly to final position and cancel movement.
            // Do NOT store as _remoteStopX/Y and walk toward it, because
            // dotMoveByDirection() changes facing direction as a side-effect.
            this._realX = x;
            this._realY = y;
            this._x = Math.round(x);
            this._y = Math.round(y);
            this.mover().cancelMove();
            this._remoteStopX = null;
            this._remoteStopY = null;
            // Re-apply direction AFTER snap so nothing overwrites it
            if (d && this !== $gamePlayer) this.setDirection(d);
        } else {
            // Moving — set direction normally, clear stop target
            if (d && this !== $gamePlayer) this.setDirection(d);
            this._remoteStopX = null;
            this._remoteStopY = null;
            
            // Heartbeat correction: if we're way off, teleport closer
            const dx = x - this._realX;
            const dy = y - this._realY;
            const drift = Math.sqrt(dx * dx + dy * dy);
            if (drift > 3.0) {
                // Major desync - snap to within 1 tile of server position
                this._realX = x - (dx / drift) * 0.5;
                this._realY = y - (dy / drift) * 0.5;
            }
        }

        return true;
    };

    // Drive the remote character's movement based on velocity
    const _Game_CharacterBase_update = Game_CharacterBase.prototype.update;
    Game_CharacterBase.prototype.update = function() {
        _Game_CharacterBase_update.call(this);

        // Skip if this is the local player
        if (this === $gamePlayer) return;

        // Check the explicit frozen flag
        if (this._combatFrozen === true) {
            this._remoteD8 = 0;
            return;
        }

        if (this._remoteD8 > 0) {
            // MOVING: Just run in the received direction - no corrections
            this.mover().dotMoveByDirection(this._remoteD8);
        }
        // d8 === 0: character is stopped. Position was snapped in setChar,
        // nothing to do here — just let them stand still.
    };

    // ========================================================================
    // 3. INTERACTION FIX: Manual Hitbox Check
    // ========================================================================
    
    const _Game_Player_startMapEventFront = Game_Player.prototype.startMapEventFront;
    Game_Player.prototype.startMapEventFront = function(x, y, d, triggers, normal, isTouch) {
        _Game_Player_startMapEventFront.call(this, x, y, d, triggers, normal, isTouch);
        if ($gameMap.isEventRunning()) return;

        if (triggers.includes(0) && $gameMap.remotes) {
            const interaction = window._interaction;
            if (!interaction || interaction.size < 1) return;

            for (const [user, remoteEvent] of $gameMap.remotes()) {
                const result = this.mover().checkCharacterStepDir(x, y, d, remoteEvent);
                
                if (result) {
                    if ($gameMessage.isBusy()) return;
                    
                    // Build up to 4 visible interaction choices.
                    // Supports Map values as either:
                    //   - function(userId, characterName)
                    //   - { visible?: (userId, characterName) => boolean, callback: function(userId, characterName) }
                    const names = [];
                    for (const [label, entry] of interaction.entries()) {
                        if (names.length >= 4) break;

                        let visible = true;
                        let cb = entry;

                        // function entry: allow optional .visible(userId, characterName)
                        if (typeof entry === 'function' && typeof entry.visible === 'function') {
                            try { visible = !!entry.visible(user, remoteEvent.name); } catch (_) { visible = true; }
                        }

                        // object entry: { callback, visible? }
                        if (entry && typeof entry === 'object' && typeof entry !== 'function') {
                            cb = entry.callback;
                            if (typeof entry.visible === 'function') {
                                try { visible = !!entry.visible(user, remoteEvent.name); } catch (_) { visible = true; }
                            }
                        }

                        if (!visible) continue;
                        if (typeof cb !== 'function') continue;

                        names.push(label);
                    }

                    if (names.length === 0) return;

                    $gameMessage.setFaceImage(remoteEvent.faceName, remoteEvent.faceIndex);
                    const acct = lookupAccountUsername(user);
                    const speakerName = acct ? `${remoteEvent.name} (${acct})` : remoteEvent.name;
                    $gameMessage.setSpeakerName(speakerName);
                    $gameMessage.add(`${TextManager.level} ${remoteEvent.level}`);
                    $gameMessage.add(remoteEvent.className);
                    $gameMessage.add(remoteEvent.profile);
                    $gameMessage.setChoices(names, 0, -2);
                    $gameMessage.setChoiceCallback(index => {
                        const label = names[index];
                        const entry = interaction.get(label);
                        const cb = (entry && typeof entry === 'object') ? entry.callback : entry;
                        if (typeof cb === 'function') cb(user, remoteEvent.name);
                    });
                    return;
                }
            }
        }
    };

})();
