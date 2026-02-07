/*:
 * @target MZ
 * @plugindesc [v2.5] Show combat status icon above players in battle with DotMove support
 * @author GeckWiz (Modified by Claude)
 * @url 
 * @help
 * 
 * This plugin shows a combat status icon above players' characters when they 
 * are in a battle scene. Works with DotMoveSystem and MMORPG_ plugins.
 * 
 * == Features ==
 * 
 * 1. Combat Icon: Shows crossed swords when player is in battle
 * 2. Victory Icon: Shows a star for 3 seconds after winning a battle
 * 3. Defeat Icon: Shows a tombstone for 3 seconds after losing a battle
 * 4. Battle Ghost: Player's character remains on map while in battle
 * 5. Movement Lock: Prevents player MAP movement during battle (not battle menus)
 * 6. DotMove Compatible: Works seamlessly with DotMoveSystem
 * 7. ATB Compatible: Does not interfere with Active Time Battle input
 * 8. Seamless Freeze: Instantly freezes position on battle start (no snap-back)
 * 
 * v2.5 Changes:
 * - Victory/Defeat timer starts immediately when result is determined
 * - Icon clears promptly instead of waiting for battle scene to close
 * 
 * @base MMORPG_Characters
 * @orderAfter MMORPG_Characters
 * @orderAfter DotMoveSystem
 * 
 * @param iconIndex
 * @text Combat Icon Index
 * @type number
 * @min 0
 * @desc Icon index to display when player is in combat (from IconSet.png)
 * @default 131
 * 
 * @param victoryIconIndex
 * @text Victory Icon Index
 * @type number
 * @min 0
 * @desc Icon index to display after winning a battle (from IconSet.png)
 * @default 87
 * 
 * @param defeatIconIndex
 * @text Defeat Icon Index
 * @type number
 * @min 0
 * @desc Icon index to display after losing a battle (from IconSet.png)
 * @default 1
 * 
 * @param resultDuration
 * @text Result Icon Duration
 * @type number
 * @min 60
 * @max 600
 * @desc How long to show victory/defeat icons in frames (60 = 1 second)
 * @default 180
 * 
 * @param iconSize
 * @text Icon Size
 * @type number
 * @min 8
 * @max 96
 * @desc Size of the icon in pixels
 * @default 24
 * 
 * @param iconYOffset
 * @text Icon Y Offset
 * @type number
 * @min -100
 * @max 100
 * @desc Y position offset for the icon display
 * @default -48
 * 
 * @param blinkSpeed
 * @text Blink Speed
 * @type number
 * @decimals 2
 * @min 0
 * @max 10
 * @desc Speed of blinking animation (0 for no blinking)
 * @default 0.05
 * 
 * @param debugMode
 * @text Debug Mode
 * @type boolean
 * @desc Enable detailed debug logging
 * @default false
 */

(() => {
    "use strict";
    
    const pluginName = "CombatStatus_by_Geck";
    const params = PluginManager.parameters(pluginName);
    
    // Icon indices
    const ICON_INDEX = Number(params.iconIndex || 76);
    const VICTORY_ICON_INDEX = Number(params.victoryIconIndex || 87);
    const DEFEAT_ICON_INDEX = Number(params.defeatIconIndex || 1);
    
    // Timing and display
    const RESULT_DURATION = Number(params.resultDuration || 240);
    const ICON_SIZE = Number(params.iconSize || 24);
    const ICON_Y_OFFSET = Number(params.iconYOffset || -12);
    const BLINK_SPEED = Number(params.blinkSpeed || 0.01);
    const DEBUG_MODE = params.debugMode === "true";

    // Combat status types - exposed globally for other plugins
    const STATUS = {
        NONE: 0,
        COMBAT: 1,
        VICTORY: 2,
        DEFEAT: 3
    };
    
    // Expose globally for other plugins (like DotMove Bridge)
    window.CombatStatusType = STATUS;

    console.log("Geck_CombatStatus v2.5 loaded - Immediate Result Timer");
    
    function debugLog(...args) {
        if (DEBUG_MODE) {
            console.log("[Geck_CombatStatus]", ...args);
        }
    }
    
    //=========================================================================
    // Global player status check - TEST FUNCTION
    //=========================================================================
    
    window.checkPlayerCombatStatus = function(playerName) {
        if (!$gameMap || !$gameMap._combatPlayers) {
            return "No game map available";
        }
        
        if (!playerName) {
            return {
                playersInCombat: Array.from($gameMap._combatPlayers.entries()),
                remotePlayers: Array.from($gameMap.remotes().keys())
            };
        }
        
        return {
            status: $gameMap._combatPlayers.get(playerName),
            isRemotePlayerPresent: $gameMap.remotes().has(playerName)
        };
    };
    
    //=========================================================================
    // Game_Map - Track players in combat with status types
    //=========================================================================
    
    Game_Map.prototype.initCombatStatus = function() {
        if (!this._combatPlayers) {
            this._combatPlayers = new Map();
        }
    };
    
    Game_Map.prototype.setPlayerCombatStatus = function(playerId, status, resultTimer = 0) {
        this.initCombatStatus();
        
        const currentData = this._combatPlayers.get(playerId);
        const wasStatus = currentData ? currentData.status : STATUS.NONE;
        
        if (wasStatus === status && status !== STATUS.VICTORY && status !== STATUS.DEFEAT) {
            return;
        }
        
        debugLog(`Setting player ${playerId} combat status to ${status}`);
        
        if (status === STATUS.NONE) {
            this._combatPlayers.delete(playerId);
        } else {
            this._combatPlayers.set(playerId, {
                status: status,
                timestamp: Date.now(),
                resultTimer: resultTimer
            });
        }
        
        if (DEBUG_MODE) {
            debugLog("Players in combat:", Array.from(this._combatPlayers.entries()));
        }
    };
    
    Game_Map.prototype.getPlayerCombatStatus = function(playerId) {
        this.initCombatStatus();
        const data = this._combatPlayers.get(playerId);
        return data ? data.status : STATUS.NONE;
    };
    
    Game_Map.prototype.isPlayerInCombat = function(playerId) {
        return this.getPlayerCombatStatus(playerId) !== STATUS.NONE;
    };
    
    Game_Map.prototype.isPlayerInActiveCombat = function(playerId) {
        return this.getPlayerCombatStatus(playerId) === STATUS.COMBAT;
    };
    
    Game_Map.prototype.getPlayerCombatTimestamp = function(playerId) {
        this.initCombatStatus();
        const data = this._combatPlayers.get(playerId);
        return data ? data.timestamp : 0;
    };
    
    Game_Map.prototype.updateCombatTimers = function() {
        this.initCombatStatus();
        
        for (const [playerId, data] of this._combatPlayers.entries()) {
            if (data.status === STATUS.VICTORY || data.status === STATUS.DEFEAT) {
                data.resultTimer--;
                if (data.resultTimer <= 0) {
                    debugLog(`Result timer expired for ${playerId}`);
                    this._combatPlayers.delete(playerId);
                }
            }
        }
    };
    
    const _Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function(sceneActive) {
        _Game_Map_update.call(this, sceneActive);
        this.updateCombatTimers();
    };
    
    //=========================================================================
    // Game_Player - Battle status and movement lock
    //=========================================================================
    
    const _Game_Player_initialize = Game_Player.prototype.initialize;
    Game_Player.prototype.initialize = function() {
        _Game_Player_initialize.call(this);
        this._combatStatus = STATUS.NONE;
        this._lastBroadcastStatus = STATUS.NONE;
        this._broadcastPending = false;
        this._forcedStatus = null;
        
        // Battle ghost position
        this._battleGhostX = 0;
        this._battleGhostY = 0;
        this._battleGhostDir = 2;
        
        // Combat start timestamp (for packet filtering)
        this._combatStartTime = 0;
    };
    
    Game_Player.prototype.getCombatStatus = function() {
        if (this._forcedStatus !== null) {
            return this._forcedStatus;
        }
        return this._combatStatus;
    };
    
    // Only returns true for active COMBAT, not victory/defeat
    Game_Player.prototype.isInActiveCombat = function() {
        return this.getCombatStatus() === STATUS.COMBAT;
    };
    
    Game_Player.prototype.isInBattle = function() {
        return this.isInActiveCombat();
    };
    
    Game_Player.prototype.getCombatStartTime = function() {
        return this._combatStartTime;
    };
    
    Game_Player.prototype.setCombatStatus = function(status) {
        if (this._combatStatus !== status) {
            debugLog(`Local player combat status changed to: ${status}`);
            this._combatStatus = status;
            this._broadcastPending = true;
            
            // Record timestamp when entering combat
            if (status === STATUS.COMBAT) {
                this._combatStartTime = Date.now();
            }
            
            if (window.client && window.client.user) {
                const userId = window.client.user();
                if (userId) {
                    const timer = (status === STATUS.VICTORY || status === STATUS.DEFEAT) 
                        ? RESULT_DURATION : 0;
                    $gameMap.setPlayerCombatStatus(userId, status, timer);
                }
            }
        }
    };
    
    Game_Player.prototype.forceCombatStatus = function(status) {
        this._forcedStatus = status;
        this.setCombatStatus(status);
        debugLog(`Forced combat status set to: ${status}`);
        this.requestBroadcastCombatStatus();
    };
    
    Game_Player.prototype.clearForcedStatus = function() {
        this._forcedStatus = null;
    };
    
    // Save AND snap position immediately
    Game_Player.prototype.freezeForBattle = function() {
        // Save current tile position
        this._battleGhostX = Math.round(this._realX * 2) / 2;
        this._battleGhostY = Math.round(this._realY * 2) / 2;
        this._battleGhostDir = this.direction();
        
        debugLog(`Freezing at: ${this._battleGhostX}, ${this._battleGhostY}, dir: ${this._battleGhostDir}`);
        
        // IMMEDIATELY snap position so no more visual drift
        this._realX = this._battleGhostX;
        this._realY = this._battleGhostY;
        this._x = Math.round(this._battleGhostX);
        this._y = Math.round(this._battleGhostY);
        
        // Clear network movement state
        if (this._netD8 !== undefined) {
            this._netD8 = 0;
            this._lastSentD8 = 0;
        }
        
        // Cancel any ongoing DotMove movement
        if (this.mover && typeof this.mover === 'function') {
            try {
                this.mover().cancelMove();
            } catch (e) {}
        }
        
        // Force publish the stopped state immediately
        if (this.publishMoves) {
            this.publishMoves();
        }
        if (this.savePosition) {
            this.savePosition();
        }
    };
    
    Game_Player.prototype.getBattleGhostPosition = function() {
        return {
            x: this._battleGhostX,
            y: this._battleGhostY,
            d: this._battleGhostDir
        };
    };
    
    //=========================================================================
    // Movement Lock - ONLY during active COMBAT, not victory/defeat
    //=========================================================================
    
    const _Game_Player_canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if (SceneManager._scene instanceof Scene_Map) {
            // Only block during active combat, NOT during victory/defeat
            if (this.isInActiveCombat()) {
                return false;
            }
        }
        return _Game_Player_canMove.call(this);
    };
    
    const _Game_Player_moveByInput = Game_Player.prototype.moveByInput;
    Game_Player.prototype.moveByInput = function() {
        // Only block during active combat
        if (this.isInActiveCombat()) {
            return;
        }
        _Game_Player_moveByInput.call(this);
    };
    
    //=========================================================================
    // Update and Broadcasting
    //=========================================================================
    
    Game_Player.prototype.updateCombatStatus = function() {
        if (this._broadcastPending) {
            this.requestBroadcastCombatStatus();
            this._broadcastPending = false;
        }
        
        // Only re-broadcast periodically during active combat
        if (this._combatStatus === STATUS.COMBAT && Graphics.frameCount % 300 === 0) {
            this.requestBroadcastCombatStatus();
        }
        
        if (Graphics.frameCount % 1800 === 0) {
            this.requestBroadcastCombatStatus();
        }
    };
    
    Game_Player.prototype.requestBroadcastCombatStatus = function() {
        if (!window.client || !window.client.broadcast) return;
        
        const status = this.getCombatStatus();
        const ghostPos = this.getBattleGhostPosition();
        
        if (status !== this._lastBroadcastStatus || this._forcedStatus !== null) {
            debugLog("Broadcasting combat status:", status);
        }
        
        this._lastBroadcastStatus = status;
        
        const payload = {
            status: status,
            x: ghostPos.x,
            y: ghostPos.y,
            d: ghostPos.d,
            timestamp: this._combatStartTime,
            timer: (status === STATUS.VICTORY || status === STATUS.DEFEAT) ? RESULT_DURATION : 0
        };
        
        window.client.broadcast(false, 'combatStatus', payload);
        
        if (window.client.publish && $gameMap) {
            try {
                const mapId = $gameMap.mapId();
                window.client.publish(false, "map", "combatStatus", mapId, payload);
            } catch (e) {
                console.error("Error publishing to map channel:", e);
            }
        }
        
        if (window.client.sendto && $gameMap && $gameMap.remotes) {
            try {
                const remotes = Array.from($gameMap.remotes().keys());
                for (const playerId of remotes) {
                    window.client.sendto(playerId, "directCombatStatus", payload);
                }
            } catch (e) {
                console.error("Error sending direct combat status:", e);
            }
        }
    };
    
    const _Game_Player_update = Game_Player.prototype.update;
    Game_Player.prototype.update = function(sceneActive) {
        _Game_Player_update.call(this, sceneActive);
        this.updateCombatStatus();
    };
    
    //=========================================================================
    // Combat Icon Sprite - ONLY VISIBLE ON MAP
    //=========================================================================
    
    const _Sprite_Character_initialize = Sprite_Character.prototype.initialize;
    Sprite_Character.prototype.initialize = function(character) {
        _Sprite_Character_initialize.call(this, character);
        this.createCombatIconSprite();
    };
    
    Sprite_Character.prototype.createCombatIconSprite = function() {
        this._combatIconSprite = new Sprite();
        this._combatIconSprite.bitmap = ImageManager.loadSystem("IconSet");
        this._combatIconSprite.anchor.x = 0.5;
        this._combatIconSprite.anchor.y = 0.5;
        this._combatIconSprite.visible = false;
        
        this.setCombatIconIndex(ICON_INDEX);
        
        this._combatIconSprite.scale.x = ICON_SIZE / 32;
        this._combatIconSprite.scale.y = ICON_SIZE / 32;
        this._combatIconSprite.z = 10;
        
        this.addChild(this._combatIconSprite);
    };
    
    Sprite_Character.prototype.setCombatIconIndex = function(iconIndex) {
        if (!this._combatIconSprite) return;
        
        const sx = (iconIndex % 16) * 32;
        const sy = Math.floor(iconIndex / 16) * 32;
        this._combatIconSprite.setFrame(sx, sy, 32, 32);
        this._currentIconIndex = iconIndex;
    };
    
    function getRemotePlayerId(character) {
        if (!character) return null;
        
        if (character.remote && typeof character.remote === 'function') {
            const remoteId = character.remote();
            if (remoteId && typeof remoteId === 'string' && remoteId !== '') {
                return remoteId;
            }
        }
        
        if (character._remote && typeof character._remote === 'string' && character._remote !== '') {
            return character._remote;
        }
        
        if (character.name && typeof character.name === 'string' && 
            $gameMap && $gameMap.remotes && $gameMap.remotes().has(character.name)) {
            return character.name;
        }
        
        return null;
    }
    
    function getIconForStatus(status) {
        switch (status) {
            case STATUS.COMBAT: return ICON_INDEX;
            case STATUS.VICTORY: return VICTORY_ICON_INDEX;
            case STATUS.DEFEAT: return DEFEAT_ICON_INDEX;
            default: return ICON_INDEX;
        }
    }
    
    const _Sprite_Character_update = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        _Sprite_Character_update.call(this);
        this.updateCombatIcon();
    };
    
    Sprite_Character.prototype.updateCombatIcon = function() {
        if (!this._combatIconSprite) return;
        
        // ONLY show icons on the map scene - never in battle
        if (!(SceneManager._scene instanceof Scene_Map)) {
            this._combatIconSprite.visible = false;
            return;
        }
        
        const character = this._character;
        
        if (!character) {
            this._combatIconSprite.visible = false;
            return;
        }
        
        let status = STATUS.NONE;
        
        if (character === $gamePlayer) {
            status = character.getCombatStatus();
        } else {
            const remoteId = getRemotePlayerId(character);
            
            if (remoteId) {
                status = $gameMap.getPlayerCombatStatus(remoteId);
                
                if (DEBUG_MODE && Graphics.frameCount % 120 === 0) {
                    debugLog(`Remote player ${remoteId}: combat status = ${status}`);
                }
            }
        }
        
        const shouldShow = status !== STATUS.NONE;
        
        if (this._combatIconSprite.visible !== shouldShow) {
            debugLog(`Setting icon visibility to ${shouldShow} for status ${status}`);
            this._combatIconSprite.visible = shouldShow;
        }
        
        if (shouldShow) {
            const targetIcon = getIconForStatus(status);
            if (this._currentIconIndex !== targetIcon) {
                this.setCombatIconIndex(targetIcon);
            }
            
            this._combatIconSprite.y = -this.patternHeight() + ICON_Y_OFFSET;
            
            if (status === STATUS.COMBAT && BLINK_SPEED > 0) {
                this._combatIconSprite.opacity = 128 + Math.sin(Graphics.frameCount * BLINK_SPEED) * 127;
            } else {
                this._combatIconSprite.opacity = 255;
            }
        }
    };
    
    //=========================================================================
    // Scene_Battle Integration - IMMEDIATE FREEZE ON SETUP
    //=========================================================================
    
    const _BattleManager_setup = BattleManager.setup;
    BattleManager.setup = function(troopId, canEscape, canLose) {
        if ($gamePlayer) {
            $gamePlayer.freezeForBattle();
            $gamePlayer.setCombatStatus(STATUS.COMBAT);
            $gamePlayer.requestBroadcastCombatStatus();
        }
        
        _BattleManager_setup.call(this, troopId, canEscape, canLose);
    };
    
    // Hook into processVictory - set victory status and start timer IMMEDIATELY
    const _BattleManager_processVictory = BattleManager.processVictory;
    BattleManager.processVictory = function() {
        if ($gamePlayer) {
            debugLog("Victory determined - setting status");
            $gamePlayer.setCombatStatus(STATUS.VICTORY);
            $gamePlayer.requestBroadcastCombatStatus();
            
            // Start clear timer IMMEDIATELY when victory is determined
            setTimeout(() => {
                if ($gamePlayer && $gamePlayer.getCombatStatus() === STATUS.VICTORY) {
                    $gamePlayer.setCombatStatus(STATUS.NONE);
                    $gamePlayer.requestBroadcastCombatStatus();
                }
            }, (RESULT_DURATION / 60) * 1000);
        }
        
        _BattleManager_processVictory.call(this);
    };
    
    // Hook into processDefeat - set defeat status and start timer IMMEDIATELY
    const _BattleManager_processDefeat = BattleManager.processDefeat;
    BattleManager.processDefeat = function() {
        if ($gamePlayer) {
            debugLog("Defeat determined - setting status");
            $gamePlayer.setCombatStatus(STATUS.DEFEAT);
            $gamePlayer.requestBroadcastCombatStatus();
            
            // Start clear timer IMMEDIATELY when defeat is determined
            setTimeout(() => {
                if ($gamePlayer && $gamePlayer.getCombatStatus() === STATUS.DEFEAT) {
                    $gamePlayer.setCombatStatus(STATUS.NONE);
                    $gamePlayer.requestBroadcastCombatStatus();
                }
            }, (RESULT_DURATION / 60) * 1000);
        }
        
        _BattleManager_processDefeat.call(this);
    };
    
    // Hook into processAbort (for escape)
    const _BattleManager_processAbort = BattleManager.processAbort;
    BattleManager.processAbort = function() {
        if ($gamePlayer) {
            debugLog("Battle aborted/escaped - clearing status");
            $gamePlayer.setCombatStatus(STATUS.NONE);
            $gamePlayer.requestBroadcastCombatStatus();
        }
        
        _BattleManager_processAbort.call(this);
    };
    
    const _Scene_Battle_start = Scene_Battle.prototype.start;
    Scene_Battle.prototype.start = function() {
        _Scene_Battle_start.call(this);
        
        if ($gamePlayer) {
            $gamePlayer.requestBroadcastCombatStatus();
        }
        
        setTimeout(() => {
            if ($gamePlayer) {
                debugLog("Delayed battle start broadcast");
                $gamePlayer.requestBroadcastCombatStatus();
            }
        }, 500);
    };
    
    const _Scene_Battle_terminate = Scene_Battle.prototype.terminate;
    Scene_Battle.prototype.terminate = function() {
        _Scene_Battle_terminate.call(this);
        
        // Delayed broadcast to ensure final state is sent
        setTimeout(() => {
            if ($gamePlayer) {
                debugLog("Delayed battle end broadcast");
                $gamePlayer.requestBroadcastCombatStatus();
            }
        }, 500);
    };
    
    //=========================================================================
    // Map Loading - Sync combat statuses
    //=========================================================================
    
    const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function() {
        _Scene_Map_onMapLoaded.call(this);
        
        if (window.client && window.client.broadcast) {
            debugLog("Map loaded - asking for combat status updates");
            window.client.broadcast(false, 'requestCombatStatus', true);
            
            $gamePlayer.requestBroadcastCombatStatus();
            
            setTimeout(() => {
                if (window.client && window.client.broadcast) {
                    debugLog("Sending delayed combat status request");
                    window.client.broadcast(false, 'requestCombatStatus', true);
                    $gamePlayer.requestBroadcastCombatStatus();
                }
            }, 2000);
        }
    };
    
    //=========================================================================
    // Network Message Handlers
    //=========================================================================
    
    function handleCombatStatusPayload(senderId, payload) {
        if (!payload || typeof payload !== 'object') {
            console.error("Invalid combat status payload received");
            return;
        }
        
        const { status, x, y, d, timestamp, timer } = payload;
        
        if (typeof status !== 'number') {
            console.error("Invalid combat status received");
            return;
        }
        
        debugLog(`Received combat status from ${senderId}: status=${status}, pos=(${x},${y}), dir=${d}`);
        
        // Update combat status with timestamp
        $gameMap.setPlayerCombatStatus(senderId, status, timer || 0);
        
        // Get the remote character
        const remote = $gameMap.getRemote(senderId);
        
        if (remote) {
            // ONLY freeze during active COMBAT (status 1)
            // Victory (2), Defeat (3), and None (0) should NOT freeze
            if (status === STATUS.COMBAT) {
                // Entering combat - freeze and snap position
                remote._remoteInput = 0;
                remote._combatFrozen = true;
                remote._combatFreezeTime = timestamp || Date.now();
                
                if (remote.mover && typeof remote.mover === 'function') {
                    try {
                        remote.mover().cancelMove();
                    } catch (e) {}
                }
                
                // Snap to exact position
                if (typeof x === 'number' && typeof y === 'number') {
                    remote._realX = x;
                    remote._realY = y;
                    remote._x = Math.round(x);
                    remote._y = Math.round(y);
                    remote.locate(x, y);
                }
                
                if (typeof d === 'number' && d > 0) {
                    remote.setDirection(d);
                }
                
                debugLog(`Froze ${senderId} at (${x}, ${y})`);
            } else {
                // Victory, Defeat, or None - UNFREEZE so they can move
                remote._combatFrozen = false;
                debugLog(`Unfroze ${senderId} (status: ${status})`);
            }
        }
        
        if (status !== STATUS.NONE && !$gameMap.remotes().has(senderId)) {
            debugLog(`Remote player ${senderId} is in combat but not in our remotes list. Requesting info.`);
            if (window.client.sendto) {
                window.client.sendto(senderId, "whois");
            }
        }
    }
    
    if (window.client) {
        window.client.react(Scene_Map, "map", "combatStatus", (scene, senderId, mapId, payload) => {
            if (window.client.user && window.client.user() === senderId) return;
            if ($gameMap && $gameMap.mapId() !== mapId) return;
            handleCombatStatusPayload(senderId, payload);
        });
        
        window.client.react(Scene_Map, "directCombatStatus", (scene, senderId, payload) => {
            handleCombatStatusPayload(senderId, payload);
        });
        
        window.client.react(Scene_Map, "map", "requestCombatStatus", (scene, senderId, request) => {
            if (typeof request !== 'boolean' || !request) return;
            
            debugLog(`${senderId} requested combat status update`);
            
            if (window.client.sendto && $gamePlayer) {
                const status = $gamePlayer.getCombatStatus();
                const ghostPos = $gamePlayer.getBattleGhostPosition();
                const payload = {
                    status: status,
                    x: ghostPos.x,
                    y: ghostPos.y,
                    d: ghostPos.d,
                    timestamp: $gamePlayer.getCombatStartTime(),
                    timer: (status === STATUS.VICTORY || status === STATUS.DEFEAT) ? RESULT_DURATION : 0
                };
                window.client.sendto(senderId, "directCombatStatus", payload);
                debugLog(`Sent direct combat status to ${senderId}`);
            }
        });
        
        window.client.react(Scene_Base, "map", "combatStatus", (scene, senderId, mapId, payload) => {
            if (window.client.user && window.client.user() === senderId) return;
            if ($gameMap && $gameMap.mapId() !== mapId) return;
            handleCombatStatusPayload(senderId, payload);
        });
    }
    
    //=========================================================================
    // Debug Commands
    //=========================================================================
    
    window.forceCombatStatus = function(value) {
        if ($gamePlayer) {
            if (value === true) {
                $gamePlayer.freezeForBattle();
                $gamePlayer.forceCombatStatus(STATUS.COMBAT);
            } else if (value === false) {
                $gamePlayer.forceCombatStatus(STATUS.NONE);
            } else if (typeof value === 'number') {
                if (value === STATUS.COMBAT) {
                    $gamePlayer.freezeForBattle();
                }
                $gamePlayer.forceCombatStatus(value);
            }
            return "Combat status forced to: " + value;
        }
        return "No game player available";
    };
    
    window.forceRemoteCombatStatus = function(playerName, status) {
        if (!$gameMap) return "No game map available";
        if (!playerName || typeof playerName !== 'string') return "Invalid player name";
        
        const statusValue = status === true ? STATUS.COMBAT : 
                           status === false ? STATUS.NONE : 
                           (typeof status === 'number' ? status : STATUS.NONE);
        
        $gameMap.setPlayerCombatStatus(playerName, statusValue, RESULT_DURATION);
        return `Force set ${playerName} combat status to ${statusValue}`;
    };
    
    window.combatSystemDiagnostics = function() {
        const diagnostics = {
            STATUS_CONSTANTS: STATUS,
            playersInCombat: $gameMap && $gameMap._combatPlayers ? 
                Array.from($gameMap._combatPlayers.entries()).map(([id, data]) => ({
                    id,
                    data
                })) : [],
            remotePlayers: $gameMap && $gameMap.remotes ? 
                Array.from($gameMap.remotes().keys()) : [],
            remotesFrozenState: $gameMap && $gameMap.remotes ?
                Array.from($gameMap.remotes().entries()).map(([id, char]) => ({
                    id,
                    frozen: char._combatFrozen || false,
                    remoteInput: char._remoteInput || 0
                })) : [],
            localPlayerStatus: {
                combatStatus: $gamePlayer ? $gamePlayer._combatStatus : null,
                forcedStatus: $gamePlayer ? $gamePlayer._forcedStatus : null,
                lastBroadcast: $gamePlayer ? $gamePlayer._lastBroadcastStatus : null,
                pendingBroadcast: $gamePlayer ? $gamePlayer._broadcastPending : null,
                battleGhostPos: $gamePlayer ? $gamePlayer.getBattleGhostPosition() : null,
                combatStartTime: $gamePlayer ? $gamePlayer._combatStartTime : null
            },
            currentScene: SceneManager._scene ? SceneManager._scene.constructor.name : null,
            partyInBattle: $gameParty ? $gameParty.inBattle() : null,
            userId: window.client && window.client.user ? window.client.user() : null,
            dotMoveEnabled: typeof DotMoveSystem !== "undefined"
        };
        
        console.log(JSON.stringify(diagnostics, null, 2));
        return diagnostics;
    };
    
    //=========================================================================
    // Debug Helper
    //=========================================================================
    
    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        
        if (DEBUG_MODE && Graphics.frameCount % 600 === 0) {
            if ($gameMap._combatPlayers && $gameMap._combatPlayers.size > 0) {
                debugLog("Current players in combat:", Array.from($gameMap._combatPlayers.entries()));
                debugLog("Current remotes on map:", Array.from($gameMap.remotes().keys()));
            }
        }
    };
})();