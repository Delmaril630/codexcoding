/*!
 * /*:
 * @target MZ
 * @plugindesc Emote system for multiplayer (Ctrl+1 to Ctrl+9)
 * @author GeckWiz
 * @url
 * @help
 *
 * ⚔️ Geck_Emotes Plugin for MMORPG Maker
 *
 * This plugin adds emote functionality to the multiplayer system.
 * Press Ctrl+1 through Ctrl+9 to display emote balloons above your character
 * that are visible to other players on the same map.
 *
 * Features:
 * - Ctrl+1 through Ctrl+9 keyboard shortcuts for 9 different emotes
 * - Emotes are visible to all players on the same map
 * - Uses RPG Maker MZ's built-in balloon system
 * - Customizable balloon IDs for each emote shortcut
 * - Works independently of chat system
 *
 * Controls:
 * - Ctrl+1: Show emote 1 (default: Exclamation)
 * - Ctrl+2: Show emote 2 (default: Question)
 * - Ctrl+3: Show emote 3 (default: Music Note)
 * - Ctrl+4: Show emote 4 (default: Heart)
 * - Ctrl+5: Show emote 5 (default: Anger)
 * - Ctrl+6: Show emote 6 (default: Sweat)
 * - Ctrl+7: Show emote 7 (default: Cobweb)
 * - Ctrl+8: Show emote 8 (default: Silence)
 * - Ctrl+9: Show emote 9 (default: Light Bulb)
 *
 * Requirements:
 * - MMORPG_Client.js
 *
 * @base MMORPG_Client
 * @orderAfter MMORPG_Client
 *
 * @param emote1BalloonId
 * @text Emote 1 Balloon ID (Ctrl+1)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+1 shortcut (1=Exclamation, 2=Question, etc.)
 * @default 1
 *
 * @param emote2BalloonId
 * @text Emote 2 Balloon ID (Ctrl+2)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+2 shortcut
 * @default 2
 *
 * @param emote3BalloonId
 * @text Emote 3 Balloon ID (Ctrl+3)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+3 shortcut
 * @default 3
 *
 * @param emote4BalloonId
 * @text Emote 4 Balloon ID (Ctrl+4)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+4 shortcut
 * @default 4
 *
 * @param emote5BalloonId
 * @text Emote 5 Balloon ID (Ctrl+5)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+5 shortcut
 * @default 5
 *
 * @param emote6BalloonId
 * @text Emote 6 Balloon ID (Ctrl+6)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+6 shortcut
 * @default 6
 *
 * @param emote7BalloonId
 * @text Emote 7 Balloon ID (Ctrl+7)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+7 shortcut
 * @default 7
 *
 * @param emote8BalloonId
 * @text Emote 8 Balloon ID (Ctrl+8)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+8 shortcut
 * @default 8
 *
 * @param emote9BalloonId
 * @text Emote 9 Balloon ID (Ctrl+9)
 * @type number
 * @min 1
 * @max 15
 * @desc Balloon ID for Ctrl+9 shortcut
 * @default 9
 *
 * @param emoteDuration
 * @text Emote Duration
 * @type number
 * @min 30
 * @max 300
 * @desc Duration of emote balloon in frames (60 frames = 1 second)
 * @default 120
 *
 * @param enableDebug
 * @text Enable Debug
 * @type boolean
 * @desc Enable debug logging for emote system
 * @default true
 *
 */

(() => {
    'use strict';
    
    // Plugin parameters
    const parameters = PluginManager.parameters('Emotes_by_Geck');
    const enableDebug = parameters.enableDebug === 'true';
    const emoteDuration = Number(parameters.emoteDuration) || 120;
    
    // Create emote balloon mapping (1-9)
    const emoteBalloonMap = {};
    for (let i = 1; i <= 9; i++) {
        emoteBalloonMap[i] = Number(parameters[`emote${i}BalloonId`]) || i;
    }
    
    // Debug logging function
    function debugLog(...args) {
        if (enableDebug) {
            console.log('[Geck_Emotes]', ...args);
        }
    }
    
    // Check if required plugins are loaded
    if (!window.client) {
        throw new Error('Geck_Emotes requires MMORPG_Client.js to be loaded first');
    }
    
    //=========================================================================
    // Keyboard Input Handling
    //=========================================================================
    
    // Track pressed keys to detect Ctrl+Number combinations
    const pressedKeys = new Set();

    // --- Anti-spam / crash-safety ---
    // Local cooldown prevents key-repeat / macro spam from flooding other clients.
    // Keep this small so emotes still feel responsive.
    const LOCAL_EMOTE_COOLDOWN_MS = 350;
    let _lastLocalEmoteAt = 0;

    // Per-sender cooldown to protect clients from remote spam.
    const REMOTE_EMOTE_COOLDOWN_MS = 200;
    const _lastRemoteEmoteAt = new Map();
    
    function handleKeyDown(event) {
        pressedKeys.add(event.code);
        
        // Check for Ctrl+Number combinations
        if (event.ctrlKey && !event.altKey && !event.shiftKey) {
            const digitMatch = event.code.match(/^(Digit|Numpad)([1-9])$/);
            if (digitMatch) {
                const emoteNumber = parseInt(digitMatch[2], 10);
                
                // Check if emote number is valid (1-9)
                if (emoteNumber >= 1 && emoteNumber <= 9) {
                    event.preventDefault();
                    event.stopPropagation();
                    
                    const balloonId = emoteBalloonMap[emoteNumber];
                    
                    debugLog(`Emote shortcut detected: Ctrl+${emoteNumber}, balloon ID: ${balloonId}`);
                    
                    // Simple local cooldown to reduce spam/accidental key repeat
                    const now = Date.now();
                    if (now - _lastLocalEmoteAt < LOCAL_EMOTE_COOLDOWN_MS) {
                        debugLog('Emote blocked by local cooldown');
                        return;
                    }
                    _lastLocalEmoteAt = now;

                    // Show emote locally and broadcast to others
                    showEmote(balloonId);
                }
            }
        }
    }
    
    function handleKeyUp(event) {
        pressedKeys.delete(event.code);
    }
    
    // Initialize keyboard listeners
    function initializeKeyboardListeners() {
        // Add global keyboard event listeners
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);
        
        debugLog('Keyboard listeners initialized for Ctrl+1 through Ctrl+9 emote shortcuts');
    }
    
    //=========================================================================
    // Emote Display Functions
    //=========================================================================
    
    function showEmote(balloonId) {
        // NOTE: Cooldown is already enforced by handleKeyDown before calling this.
        // Do NOT duplicate the cooldown check here — handleKeyDown sets
        // _lastLocalEmoteAt = Date.now() immediately before calling showEmote(),
        // so a second check would always see 0ms elapsed and block every emote.

        // Only show emotes when on the map scene and player exists
        if (!$gamePlayer || !SceneManager._scene || !(SceneManager._scene instanceof Scene_Map)) {
            debugLog('Cannot show emote: not on map scene or player not available');
            return;
        }
        
        // Show emote on local player
        debugLog(`Showing balloon ${balloonId} on local player`);
        $gameTemp.requestBalloon($gamePlayer, balloonId);
        
        // Broadcast emote to other players on the same map
        if (window.client && window.client.publish) {
            const mapId = $gameMap ? $gameMap.mapId() : 0;
            debugLog(`Broadcasting emote to map ${mapId}`);
            
            window.client.publish(false, "map", "emote", balloonId, mapId);
        }
    }
    
    function showRemoteEmote(senderId, balloonId) {
        debugLog(`Showing remote emote from ${senderId}, balloon ${balloonId}`);

        // Remote cooldown (client-side)
        const now = Date.now();
        const last = _lastRemoteEmoteAt.get(senderId) || 0;
        if (now - last < REMOTE_EMOTE_COOLDOWN_MS) {
            return;
        }
        _lastRemoteEmoteAt.set(senderId, now);
        
        // Find the remote character
        if ($gameMap && $gameMap.hasRemote && $gameMap.hasRemote(senderId)) {
            const remoteChar = $gameMap.getRemote(senderId);
            if (remoteChar) {
                debugLog(`Found remote character for ${senderId}, requesting balloon`);
                $gameTemp.requestBalloon(remoteChar, balloonId);
            } else {
                debugLog(`Remote character not found for ${senderId}`);
            }
        } else {
            debugLog(`Remote ${senderId} not found on current map`);
        }
    }
    
    //=========================================================================
    // Network Message Handling
    //=========================================================================
    
    // React to emote messages from other players
    if (window.client && window.client.react) {
        window.client.react(Scene_Map, "map", "emote", (scene, senderId, balloonId, mapId) => {
            // Skip if this is our own message
            if (window.client.user && window.client.user() === senderId) {
                debugLog('Skipping own emote message');
                return;
            }
            
            // Skip if mapId doesn't match current map
            if ($gameMap && $gameMap.mapId() !== mapId) {
                debugLog(`Map ID mismatch: current ${$gameMap.mapId()}, received ${mapId}`);
                return;
            }
            
            debugLog(`Received emote from ${senderId}: balloon ${balloonId} on map ${mapId}`);
            
            // Show the emote on the remote character
            showRemoteEmote(senderId, balloonId);
        });
        
        debugLog('Emote network reaction registered');
    }
    
    //=========================================================================
    // Initialization
    //=========================================================================
    
    // Initialize when the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeKeyboardListeners);
    } else {
        initializeKeyboardListeners();
    }
    
    debugLog('Geck_Emotes plugin initialized with keyboard shortcuts (Ctrl+1 to Ctrl+9)');

    // Crash-safety: balloon sprites can outlive their target sprite when a remote player
    // disconnects during heavy emote spam. Guard updatePosition so it doesn't throw.
    const _Sprite_Balloon_updatePosition = Sprite_Balloon.prototype.updatePosition;
    Sprite_Balloon.prototype.updatePosition = function() {
        try {
            // If the target sprite was destroyed (remote disconnect), bail out safely.
            const ts = this._target;
            if (!ts || ts._destroyed || ts.parent === null) {
                // Make sure we don't keep updating a balloon with no target.
                this.visible = false;
                return;
            }
            _Sprite_Balloon_updatePosition.call(this);
            // Optional visual offset: move balloon higher.
            this.y -= 15;
        } catch (e) {
            // Never allow a balloon positioning exception to crash the game.
            this.visible = false;
        }
    };
    
})();
