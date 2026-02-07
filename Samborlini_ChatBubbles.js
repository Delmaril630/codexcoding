/*:
 * @target MZ
 * @plugindesc [Version 1.4.1] Display chat bubbles above characters in multiplayer! Requires the MMORPG_Chat plugin ordered before it!
 * @author Samborlini (Big thanks to Geckwiz and rmalizia44!) | Maintenance edits by Nate/ChatGPT
 * @base MMORPG_Client
 * @orderAfter MMORPG_Chat
 *
 * @param Debug Mode
 * @type boolean
 * @default false
 * @desc Enables debug logs (warnings + basic info). For deep troubleshooting, enable Verbose Debug.
 *
 * @param Verbose Debug
 * @type boolean
 * @default false
 * @desc Enables very chatty logging (may be noisy). Leave OFF for production.
 *
 * @param Bubble Duration
 * @type number
 * @min 1
 * @default 240
 * @desc Duration in frames that a chat bubble remains on screen.
 *
 * @param Bubble X Offset
 * @type number
 * @default 0
 * @desc Horizontal offset in pixels from the character's center on the map.
 *
 * @param Bubble Y Offset
 * @type number
 * @default 48
 * @desc Vertical offset in pixels above the character's head to place the chat bubble on the map.
 *
 * @param Battle Bubble X Offset
 * @type number
 * @default 0
 * @desc Horizontal offset in pixels from the battler's center in battle.
 *
 * @param Battle Bubble Y Offset
 * @type number
 * @default 64
 * @desc Vertical offset in pixels above the battler sprite to place the chat bubble in battle.
 *
 * @param Enable Battle Bubbles
 * @type boolean
 * @default true
 * @desc Whether to display chat bubbles above characters in battle or not.
 *
 * @help
 * Adds chat bubbles over characters based on chat messages.
 *
 * Maintenance changes in v1.4.1:
 * - Fixes console spam / lag from repeated "retrying..." logs.
 * - Removes infinite retry loop for client.on(*) (MMORPG_Client does not expose .on()).
 * - Makes heavy logs opt-in via "Verbose Debug".
 */

(() => {
  'use strict';

  const PLUGIN_NAME = "Samborlini_ChatBubbles";
  const params = PluginManager.parameters(PLUGIN_NAME);

  const DEBUG = params["Debug Mode"] === "true";
  const VERBOSE = params["Verbose Debug"] === "true";

  const BUBBLE_DURATION = Number(params["Bubble Duration"] || 240);
  const BUBBLE_Y_OFFSET = Number(params["Bubble Y Offset"] || 48);
  const BUBBLE_X_OFFSET = Number(params["Bubble X Offset"] || 0);
  const BATTLE_BUBBLE_Y_OFFSET = Number(params["Battle Bubble Y Offset"] || 64);
  const BATTLE_BUBBLE_X_OFFSET = Number(params["Battle Bubble X Offset"] || 0);
  const ENABLE_BATTLE_BUBBLES = params["Enable Battle Bubbles"] === "true";

  // ---- logging helpers (no spam) ----
  const _warnOnce = new Set();
  const _infoOnce = new Set();

  function logDebug(...args) {
    if (DEBUG && VERBOSE) console.log(...args);
  }
  function logInfoOnce(key, ...args) {
    if (!DEBUG) return;
    if (_infoOnce.has(key)) return;
    _infoOnce.add(key);
    console.log(...args);
  }
  function logWarnOnce(key, ...args) {
    if (!DEBUG) return;
    if (_warnOnce.has(key)) return;
    _warnOnce.add(key);
    console.warn(...args);
  }
  function logWarn(...args) {
    if (DEBUG) console.warn(...args);
  }

  // Always resolve the client dynamically (avoid capturing undefined at boot)
  function getClient() {
    return window.client;
  }

  class Sprite_ChatBubble extends Sprite {
    constructor(text) {
      super(new Bitmap(240, 64));
      this._text = text;
      this._duration = BUBBLE_DURATION;
      this.anchor.x = 0.5;
      this.anchor.y = 1;
      this.refresh();
    }

    refresh() {
      const padding = 8;
      const maxWidth = 240;
      const fontSize = 18;
      const lineHeight = 24;
      const maxLines = 3;

      const tempBitmap = new Bitmap(1, 1);
      tempBitmap.fontSize = fontSize;
      const context = tempBitmap._context;
      context.font = tempBitmap._makeFontNameText();

      let lines = this.wrapText(this._text, maxWidth - padding * 2, context);
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        lines[maxLines - 1] += '...';
      }

      const maxLineWidth = Math.max(...lines.map(l => context.measureText(l).width));
      const bubbleWidth = Math.min(Math.max(maxLineWidth + padding * 2, 60), maxWidth);
      const bubbleHeight = lines.length * lineHeight + padding * 2;

      const newBitmap = new Bitmap(bubbleWidth, bubbleHeight);
      newBitmap.fontSize = fontSize;
      newBitmap.textColor = "#ffffff";
      newBitmap.outlineColor = "#000000";
      newBitmap.outlineWidth = 3;

      this.drawRoundedRect(newBitmap, 0, 0, bubbleWidth, bubbleHeight, 10, "rgba(0,0,0,0.6)");

      const verticalOffset = (bubbleHeight - lines.length * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        newBitmap.drawText(
          lines[i],
          0,
          verticalOffset + i * lineHeight,
          bubbleWidth,
          lineHeight,
          "center"
        );
      }

      if (this.bitmap) this.bitmap.destroy();
      this.bitmap = newBitmap;
      this.width = bubbleWidth;
      this.height = bubbleHeight;

      logDebug("[ChatBubble] Refreshed bubble:", lines);
    }

    drawRoundedRect(bitmap, x, y, w, h, radius, color) {
      const ctx = bitmap._context;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      ctx.fill();
      bitmap._baseTexture.update();
    }

    wrapText(text, maxWidth, context) {
      const words = text.split(" ");
      const lines = [];
      let line = "";

      for (const word of words) {
        const testLine = line + word + " ";
        if (context.measureText(testLine).width > maxWidth && line) {
          lines.push(line.trim());
          line = word + " ";
        } else {
          line = testLine;
        }
      }

      if (line) lines.push(line.trim());
      return lines;
    }

    update() {
      super.update();
      if (--this._duration <= 0 && this.parent) {
        logDebug("[ChatBubble] Removing expired bubble");
        this.parent.removeChild(this);
      }
      // Only update position if attached to a map character (battle bubbles follow their parent sprite automatically)
      if (this._charRef && this.parent && !this.parent.isSpriteBattler) {
        this.x = this._charRef.screenX() + BUBBLE_X_OFFSET;
        this.y = this._charRef.screenY() - BUBBLE_Y_OFFSET;
      }
    }
  }

  const _Spriteset_Map_update = Spriteset_Map.prototype.update;
  Spriteset_Map.prototype.update = function () {
    _Spriteset_Map_update.call(this);
    if (!this._tilemap) return;
    for (const child of this._tilemap.children) {
      if (child instanceof Sprite_ChatBubble && child._charRef) {
        child.x = child._charRef.screenX() + BUBBLE_X_OFFSET;
        child.y = child._charRef.screenY() - BUBBLE_Y_OFFSET;
      }
    }
  };

  function findCharacterByLoginId(loginId) {
    const client = getClient();
    if (!client || !$gameMap) return null;

    if ($gameParty.inBattle()) {
      const members = $gameParty.battleMembers();
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        if (i === 0 && loginId === client.user?.()) {
          logDebug("[ChatBubble] findCharacterByLoginId: Found player as $gamePlayer (self)");
          return $gamePlayer;
        }
        if (member && member._remote === loginId) {
          // In battle, we don't have eventId, so just return the Game_Actor instance
          logDebug(`[ChatBubble] findCharacterByLoginId: Found battle member for loginId ${loginId}`);
          return member;
        }
      }
      logDebug(`[ChatBubble] findCharacterByLoginId: No battle member found matching loginId ${loginId}`);
      return null;
    }

    // non-battle case stays same
    if (loginId === client.user?.()) {
      logDebug("[ChatBubble] findCharacterByLoginId: Found player as $gamePlayer (self, map)");
      return $gamePlayer;
    }
    const remote = $gameMap.remotes()?.get(loginId);
    if (!remote || (remote._x === 0 && remote._y === 0)) {
      // This can happen briefly during map load / subscribe; do not spam warnings.
      logDebug(`[ChatBubble] findCharacterByLoginId: Remote not found or at (0,0) for loginId ${loginId}`);
      return null;
    }
    logDebug(`[ChatBubble] findCharacterByLoginId: Found remote on map for loginId ${loginId}`);
    return remote;
  }

  function showChatBubbleForCharacter(char, text) {
    const client = getClient();
    const scene = SceneManager._scene;
    if (!char || !scene || !client) {
      logDebug("[ChatBubble] showChatBubbleForCharacter: Invalid char/scene/client");
      return;
    }

    const loginId = char._remote || client.user();

    if ($gameParty.inBattle() && scene instanceof Scene_Battle) {
      if (!ENABLE_BATTLE_BUBBLES) {
        logDebug("[ChatBubble] Battle bubbles disabled, ignoring bubble for:", loginId);
        return;
      }

      const spriteSet = scene._spriteset;
      const sprites = spriteSet?._actorSprites || [];

      logDebug(`[ChatBubble] Attempting to find sprite for loginId: ${loginId}`);

      let targetSprite = null;
      for (const sprite of sprites) {
        const actor = sprite._actor;
        if (!actor) continue;
        const isSelf = loginId === client.user();
        const match = isSelf ? actor === $gameParty.leader() : actor._remote === loginId;
        if (match) {
          targetSprite = sprite;
          break;
        }
      }
      if (!targetSprite) {
        logDebug(`[ChatBubble] No target sprite found in battle for: ${loginId === client.user() ? "you" : loginId}`);
        return;
      }

      if (targetSprite._chatBubble) {
        targetSprite.removeChild(targetSprite._chatBubble);
      }

      const bubble = new Sprite_ChatBubble(text);
      bubble.x = BATTLE_BUBBLE_X_OFFSET;
      bubble.y = -targetSprite.height - BATTLE_BUBBLE_Y_OFFSET;
      targetSprite.addChild(bubble);
      targetSprite._chatBubble = bubble;

      logDebug(`[ChatBubble] Shown bubble in battle for: ${loginId === client.user() ? "you" : loginId}`);
      return;
    }

    if (scene._spriteset && scene._spriteset._tilemap?.children) {
      const spriteset = scene._spriteset;
      const existing = spriteset._tilemap.children.find(
        s => s._charRef === char && s instanceof Sprite_ChatBubble
      );
      if (existing) {
        spriteset._tilemap.removeChild(existing);
      }

      const bubble = new Sprite_ChatBubble(text);
      bubble._charRef = char;
      spriteset._tilemap.addChild(bubble);

      logDebug(`[ChatBubble] Shown map bubble for ${char._remote || "you"}: ${text}`);
    }
  }

  function onChatMessage(from, name, text) {
    logDebug("[ChatBubble] onChatMessage", { from, name, text });
    const char = findCharacterByLoginId(from);
    if (char) {
      showChatBubbleForCharacter(char, text);
    } else {
      logDebug("[ChatBubble] Character not found for loginID:", from);
    }
  }

  function setupReactListeners() {
    const client = getClient();
    if (!client || typeof client.react !== "function") {
      // React is required, but don't spam logs while waiting.
      logWarnOnce("react-missing", "[ChatBubble] client.react not available yet; waiting...");
      setTimeout(setupReactListeners, 200);
      return;
    }

    // Map scene listeners
    client.react(Scene_Map, "map", "chat", (_, from, name, text) => {
      logDebug("[ChatBubble] react map chat:", { from, name, text });
      onChatMessage(from, name, text);
    });

    client.react(Scene_Map, "party", "chat", (_, from, name, text) => {
      logDebug("[ChatBubble] react party chat:", { from, name, text });
      onChatMessage(from, name, text);
    });

    // Battle scene listeners
    client.react(Scene_Battle, "map", "chat", (_, from, name, text) => {
      logDebug("[ChatBubble] react battle map chat:", { from, name, text });
      onChatMessage(from, name, text);
    });

    client.react(Scene_Battle, "party", "chat", (_, from, name, text) => {
      logDebug("[ChatBubble] react battle party chat:", { from, name, text });
      onChatMessage(from, name, text);
    });

    logInfoOnce("react-attached", "[ChatBubble] React listeners attached");
  }

  function hookPublish() {
    const client = getClient();
    if (!client || typeof client.publish !== "function") {
      // Publish hook is optional, but helps self-bubbles when no loopback.
      logWarnOnce("publish-missing", "[ChatBubble] client.publish not available yet; waiting...");
      setTimeout(hookPublish, 200);
      return;
    }
    if (client.publish && client.publish._chatBubbleHooked) return;

    const originalPublish = client.publish;
    client.publish = function (loopback, group, ...args) {
      // DO NOT log publish calls (publish is used for movement and will flood).
      // Only mirror local chat to a bubble if needed.
      if ((group === "map" || group === "party") && args.length >= 3) {
        const [messageType, name, text] = args;
        if (messageType === "chat" && typeof text === "string") {
          try {
            onChatMessage(client.user?.(), name, text);
          } catch (e) {
            if (DEBUG && VERBOSE) console.warn("[ChatBubble] publish hook error", e);
          }
        }
      }
      return originalPublish.call(this, loopback, group, ...args);
    };
    client.publish._chatBubbleHooked = true;

    logInfoOnce("publish-hooked", "[ChatBubble] Hooked into client.publish (no spam)");
  }

  // NOTE: MMORPG_Client does not expose client.on("*") in the builds you've shared.
  // This is debug-only anyway. We skip it entirely to prevent infinite retries / spam.
  function setupGlobalListener() {
    const client = getClient();
    if (!DEBUG) return;
    if (!client || typeof client.on !== "function") {
      logInfoOnce("global-skip", "[ChatBubble] client.on not available; skipping global event listener");
      return;
    }

    client.on("*", (eventName, ...args) => {
      // This can still be noisy; only print in verbose mode.
      logDebug("[ChatBubble] client event:", eventName, args);
    });

    logInfoOnce("global-attached", "[ChatBubble] Global client event listener attached");
  }

  // Debug hotkey bubble
  if (DEBUG) {
    document.addEventListener("keydown", (e) => {
      if (e.code === "Tab") {
        e.preventDefault();
        showChatBubbleForCharacter($gamePlayer, "Test Bubble");
      }
    });
  }

  setupReactListeners();
  hookPublish();
  setupGlobalListener();
})();