/*:
 * @target MZ
 * @plugindesc MMORPG Social (Friends + Blocked + Guild) - UI behavior fixes + friend options menu.
 * @author Nate
 *
 * @command openSocial
 * @text Open Social
 * @desc Opens the Social menu (Friends / Blocked / Guild).
 */

(() => {
  'use strict';

  const pluginName = 'MMORPG_Social';

  // ---------------------------------------------------------------------------
  // Compatibility shims
  // ---------------------------------------------------------------------------
  if (typeof Window_Base !== 'undefined') {
    if (typeof Window_Base.prototype.canvasToLocalX !== 'function') {
      Window_Base.prototype.canvasToLocalX = function(x) { return x - (this.x || 0); };
    }
    if (typeof Window_Base.prototype.canvasToLocalY !== 'function') {
      Window_Base.prototype.canvasToLocalY = function(y) { return y - (this.y || 0); };
    }
  }

  // Some plugin stacks strip this off of Window_Selectable / Window.
  if (typeof Window !== 'undefined' && typeof Window.prototype.isTouchedInsideFrame !== 'function') {
    Window.prototype.isTouchedInsideFrame = function() {
      const x = TouchInput.x;
      const y = TouchInput.y;
      return x >= this.x && y >= this.y && x < this.x + this.width && y < this.y + this.height;
    };
  }
  if (typeof Window_Base !== 'undefined' && typeof Window_Base.prototype.isTouchedInsideFrame !== 'function') {
    Window_Base.prototype.isTouchedInsideFrame = function() {
      const x = TouchInput.x;
      const y = TouchInput.y;
      return x >= this.x && y >= this.y && x < this.x + this.width && y < this.y + this.height;
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function getMMO() {
    return window.client;
  }

  function chatSystem(text) {
    if (text == null) return;

    let msg = text;

    // Normalize common structured payloads into a readable message.
    if (typeof msg === 'object') {
      const extracted = msg.error ?? msg.message ?? msg.text ?? msg.msg;
      if (typeof extracted === 'string') {
        msg = extracted;
      } else {
        try {
          msg = JSON.stringify(msg);
        } catch (_) {
          msg = String(msg);
        }
      }
    }

    msg = String(msg ?? '');
    if (!msg) return;

    if (window.chat && typeof window.chat.addMessage === 'function') {
      try {
        window.chat.addMessage('(System)', msg, '#B0C4DE');
      } catch (_) {
        try { window.chat.addMessage(msg); } catch (_) {}
      }
    } else {
      console.log('[Social]', msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Notification Badges (above chat)
  //   - Mail ✉  : new mail since last time Mail was opened
  //   - Social ●: new social request/invite since last time Social was opened
  // ---------------------------------------------------------------------------
  const MMO_Notify = window.MMO_Notify || (window.MMO_Notify = (() => {
    const state = { mail: false, social: false };
    let ui = null;
    let elMail = null;
    let elSocial = null;
    let retryTimer = null;

    function ensureUI() {
      if (ui) return ui;

      const chat = document.getElementById('chat-container');
      if (!chat) {
        // Chat may not be constructed yet (plugin order). Retry a bit later.
        if (!retryTimer) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            ensureUI();
            update();
          }, 500);
        }
        return null;
      }

      ui = document.createElement('div');
      ui.id = 'mmo-notify-badges';
      ui.style.position = 'fixed';
      ui.style.zIndex = '1002';
      ui.style.pointerEvents = 'none';
      ui.style.padding = '2px 6px';
      ui.style.background = 'rgba(0,0,0,0.4)';
      ui.style.border = '1px solid rgba(255,255,255,0.2)';
      ui.style.borderRadius = '4px';
      ui.style.color = 'white';
      ui.style.fontFamily = 'Arial, sans-serif';
      ui.style.fontSize = '14px';
      ui.style.whiteSpace = 'nowrap';
      ui.style.display = 'none';

      elSocial = document.createElement('span');
      elSocial.id = 'mmo-badge-social';
      elSocial.textContent = 'Social ●';
      elSocial.style.marginRight = '10px';

      elMail = document.createElement('span');
      elMail.id = 'mmo-badge-mail';
      elMail.textContent = 'Mail ✉';

      ui.appendChild(elSocial);
      ui.appendChild(elMail);
      document.body.appendChild(ui);

      // Keep the badge bar aligned above the chat window.
      const loop = () => {
        try {
          const c = document.getElementById('chat-container');
          if (!c || !ui) {
            requestAnimationFrame(loop);
            return;
          }
          const r = c.getBoundingClientRect();
          const h = ui.offsetHeight || 18;

          ui.style.left = `${Math.round(r.left)}px`;
          ui.style.top = `${Math.round(Math.max(0, r.top - h - 4))}px`;

          // Match chat opacity so it fades together.
          if (c.style && c.style.opacity != null) ui.style.opacity = String(c.style.opacity);
        } catch (_) {}
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);

      update();
      return ui;
    }

    function update() {
      ensureUI();
      if (!ui) return;

      const showSocial = !!state.social;
      const showMail = !!state.mail;

      if (elSocial) elSocial.style.display = showSocial ? 'inline' : 'none';
      if (elMail) elMail.style.display = showMail ? 'inline' : 'none';

      ui.style.display = (showSocial || showMail) ? 'block' : 'none';
    }

    function setMail(on) { state.mail = !!on; update(); }
    function setSocial(on) { state.social = !!on; update(); }
    function clearMail() { setMail(false); }
    function clearSocial() { setSocial(false); }

    function handleMailNew(summary) {
      // Some server builds may omit "type" on the mail/new summary, so fall back to subject sniffing.
      let t = summary?.type;
      const subj = String(summary?.subject || '');
      if (!t && /friend\s+request/i.test(subj)) t = 'friend_request';

      const type = String(t || 'mail');
      if (type === 'friend_request') {
        setSocial(true);
      } else {
        setMail(true);
      }
    }

    return { setMail, setSocial, clearMail, clearSocial, handleMailNew };
  })());


  function safeBroadcast(code, args) {
    const mmo = getMMO();
    if (!mmo || typeof mmo.broadcast !== 'function') return false;
    try {
      mmo.broadcast(false, code, ...(args || []));
      return true;
    } catch (e) {
      console.warn('[Social] broadcast failed', e);
      return false;
    }
  }

  function safeReact(group, code, cb) {
    const mmo = getMMO();
    if (!mmo) return false;

    // Prefer react/unsafeReact: it passes the scene instance.
    if (typeof mmo.unsafeReact === 'function') {
      mmo.unsafeReact(Scene_Base, group, code, (scene, from, ...args) => cb(args[0], from, scene));
      return true;
    }
    if (typeof mmo.react === 'function') {
      mmo.react(Scene_Base, group, code, (scene, from, ...args) => cb(args[0], from, scene));
      return true;
    }
    if (typeof mmo.onRecv === 'function') {
      mmo.onRecv(group, code, (from, args) => cb(args && args[0], from, SceneManager._scene));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // User Directory: userId -> account username
  // ---------------------------------------------------------------------------
  const MMO_UserDirectory = window.MMO_UserDirectory || (window.MMO_UserDirectory = (() => {
    const idToUsername = new Map();
    function set(userId, username) {
      const k = String(userId ?? '').trim();
      const u = String(username ?? '').trim();
      if (!k || !u) return;
      idToUsername.set(k, u);
    }
    function get(userId) {
      const k = String(userId ?? '').trim();
      if (!k) return null;
      return idToUsername.get(k) || null;
    }
    return { set, get };
  })());

  function resolveAccountUsername(userIdOrUsername) {
    const raw = String(userIdOrUsername ?? '').trim();
    if (!raw) return '';
    const mapped = MMO_UserDirectory.get(raw);
    return mapped || raw;
  }

  // Populate directory from join/player list packets (best-effort; safe no-op if unsupported).
  for (const grp of ['map', 'party', 'guild']) {
    safeReact(grp, '+', (username, from) => {
      if (username) MMO_UserDirectory.set(from, username);
    });
    safeReact(grp, '@/players', (list) => {
      if (!Array.isArray(list)) return;
      for (const p of list) {
        if (p && p.id != null && p.name) MMO_UserDirectory.set(p.id, p.name);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Social Manager (client-side cache)
  // ---------------------------------------------------------------------------
  class SocialManager {
    constructor() {
      this._friends = [];
      this._blocks = [];
      this._loaded = false;
      this._listeners = { updated: [] };
      this._requestedOnce = false;
      this._setupNetwork();
    }

    _setupNetwork() {
      safeReact('social', 's/list/res', (data) => this._applyList(data));
      safeReact('social', 'social/update', (data) => this._applyList(data));

      const simpleNotice = (label) => (data) => {
        if (data && data.success === false) {
          chatSystem(data.error || `${label} failed.`);
        } else if (data && data.message) {
          chatSystem(data.message);
        }
        this.requestList();
      };

      safeReact('social', 'f/request/res', simpleNotice('Friend request'));
      safeReact('social', 'f/remove/res', simpleNotice('Remove friend'));
      safeReact('social', 'b/block/res', simpleNotice('Block'));
      safeReact('social', 'b/unblock/res', simpleNotice('Unblock'));
      safeReact('social', 'f/accept/res', simpleNotice('Accept'));
      safeReact('social', 'f/decline/res', simpleNotice('Decline'));
    }

    _applyList(data) {
      if (!data || data.success === false) {
        chatSystem(data?.error || 'Social list failed to load.');
        return;
      }
      this._friends = Array.isArray(data.friends) ? data.friends : [];
      this._blocks = Array.isArray(data.blocks) ? data.blocks : [];
      this._loaded = true;
      this._emit('updated');
    }

    on(evt, cb) {
      if (!this._listeners[evt]) this._listeners[evt] = [];
      this._listeners[evt].push(cb);
    }

    _emit(evt) {
      const list = this._listeners[evt] || [];
      for (const fn of list) {
        try { fn(); } catch (e) { console.warn('[Social] listener error', e); }
      }
    }

    ensureInit() {
      if (this._requestedOnce) return;
      const mmo = getMMO();
      if (!mmo || !mmo.connected || !mmo.connected()) return;
      this._requestedOnce = true;
      this.requestList();
    }

    requestList() { return safeBroadcast('s/list', []); }

    getFriends() { return this._friends.slice(); }
    getBlocks() { return this._blocks.slice(); }
    isLoaded() { return this._loaded; }

    isFriend(username) {
      if (!this._loaded) return false;
      const u = String(username ?? '').toLowerCase();
      return this._friends.some((f) => String(f.username ?? '').toLowerCase() === u);
    }

    isBlocked(username) {
      if (!this._loaded) return false;
      const u = String(username ?? '').toLowerCase();
      return this._blocks.some((b) => String(b.username ?? '').toLowerCase() === u);
    }

    requestFriend(username) {
      const target = String(username ?? '').trim();
      if (!target) return false;
      return safeBroadcast('f/request', [target]);
    }

    removeFriend(username) {
      const target = String(username ?? '').trim();
      if (!target) return false;
      return safeBroadcast('f/remove', [target]);
    }

    block(username) {
      const target = String(username ?? '').trim();
      if (!target) return false;
      return safeBroadcast('b/block', [target]);
    }

    unblock(username) {
      const target = String(username ?? '').trim();
      if (!target) return false;
      return safeBroadcast('b/unblock', [target]);
    }
  }

  const Social = new SocialManager();
  window.Social = Social;

  

  // ---------------------------------------------------------------------------
  // Party Invites (tracks incoming partyAsk requests so we can show them in Social UI)
  // ---------------------------------------------------------------------------
  const MMO_PartyInvites = window.MMO_PartyInvites || (window.MMO_PartyInvites = (() => {
    const invites = []; // { userId, username, guid, timestamp }

    function upsertInvite(userId, username, guid) {
      const id = String(userId ?? '').trim();
      if (!id) return;
      const name = String(username ?? '').trim() || id;
      const g = String(guid ?? '');
      const existing = invites.find((x) => String(x.userId) === id);
      if (existing) {
        existing.username = name;
        existing.guid = g;
        existing.timestamp = Date.now();
      } else {
        invites.push({ userId: id, username: name, guid: g, timestamp: Date.now() });
      }
      try { if (MMO_Notify && typeof MMO_Notify.setSocial === 'function') MMO_Notify.setSocial(true); } catch (_) {}
    }

    function removeInvite(userId) {
      const id = String(userId ?? '').trim();
      const idx = invites.findIndex((x) => String(x.userId) === id);
      if (idx >= 0) invites.splice(idx, 1);
    }

    function list() {
      // newest first
      return invites.slice().sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    }

    function accept(inv) {
      const id = String(inv?.userId ?? '').trim();
      if (!id || !window.client) return false;
      if (!$gameParty || typeof $gameParty.canAddRemote !== 'function' || !$gameParty.canAddRemote()) return false;

      // Mirror the Party plugin's own ask flow: add to asks(), then send partyAsk back. fileciteturn6file4
      try {
        if (typeof $gameParty.asks === 'function') {
          const s = $gameParty.asks();
          if (s && typeof s.add === 'function') s.add(id);
        }
      } catch (_) {}

      try {
        const guid = String(inv?.guid ?? '');
        const myName = (typeof $gameParty.leaderName === 'function') ? $gameParty.leaderName() : '';
        window.client.sendto(id, 'partyAsk', guid, myName);
      } catch (_) {
        return false;
      }

      removeInvite(id);
      return true;
    }

    function decline(inv) {
      const id = String(inv?.userId ?? '').trim();
      if (!id) return false;
      removeInvite(id);
      return true;
    }

    // Listen for incoming partyAsk requests and store them for the Social menu.
    // The Party plugin shows the chat line but does NOT persist the invite. fileciteturn6file0
    safeReact('@', 'partyAsk', (_args, from) => {
      // _args is [guid, name] in MMORPG_Client's .react wrapper conventions.
      // Our safeReact passes args[0] as first parameter, but in this packet the payload is positional.
      // So we also sniff SceneManager._scene raw args via window.client callbacks isn't available here.
      // Best-effort: accept either array payload or object payload.
    });

    // We can't rely on safeReact's wrapper for positional args here, so hook directly if possible.
    try {
      const mmo = getMMO();
      if (mmo && typeof mmo.react === 'function') {
        mmo.react(Scene_Base, '@', 'partyAsk', (scene, from, guid, name) => {
          // Only treat it as an invite if we haven't already asked them.
          try {
            const asked = ($gameParty && typeof $gameParty.asks === 'function') ? $gameParty.asks() : null;
            if (asked && typeof asked.has === 'function' && asked.has(from)) return;
          } catch (_) {}
          upsertInvite(from, name, guid);
          if (name) MMO_UserDirectory.set(from, name);
        });
      } else if (mmo && typeof mmo.unsafeReact === 'function') {
        mmo.unsafeReact(Scene_Base, '@', 'partyAsk', (scene, from, guid, name) => {
          try {
            const asked = ($gameParty && typeof $gameParty.asks === 'function') ? $gameParty.asks() : null;
            if (asked && typeof asked.has === 'function' && asked.has(from)) return;
          } catch (_) {}
          upsertInvite(from, name, guid);
          if (name) MMO_UserDirectory.set(from, name);
        });
      }
    } catch (_) {}

    return { list, accept, decline };
  })());

// Request initial data once the MMO client is ready.
  let _mmoMailListRequested = false;

  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() {
    _Scene_Map_update.call(this);
    Social.ensureInit();

    // Ensure Mail has at least one list fetch so Social -> Requests can populate after login.
    if (!_mmoMailListRequested) {
      const mmo = getMMO();
      if (mmo && typeof mmo.connected === 'function' && mmo.connected()) {
        const Mail = window.MMO_Mail;
        if (Mail && typeof Mail.requestList === 'function') {
          _mmoMailListRequested = true;
          Mail.requestList();
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Prompt windows (username input)
  // ---------------------------------------------------------------------------
  class Window_SocialTextInput extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._text = '';
      this._maxLength = 20;
      this._placeholder = '';
      this.deactivate();
      this.refresh();
    }

    setConfig({ maxLength = 20, placeholder = '' } = {}) {
      this._maxLength = Number(maxLength) || 20;
      this._placeholder = String(placeholder ?? '');
      this._text = '';
      this.refresh();
    }

    text() { return this._text; }

    setText(t) {
      this._text = String(t ?? '').slice(0, this._maxLength);
      this.refresh();
    }

    activate() {
      super.activate();
      // If any previous scene leaked the shared input guard/buffer, clear it.
      try {
        if (window.MMO_TextBuffer && typeof window.MMO_TextBuffer._depth === 'function') {
          while (window.MMO_TextBuffer._depth() > 0) window.MMO_TextBuffer.end();
        }
        if (window.MMO_InputGuard && typeof window.MMO_InputGuard.depth === 'function') {
          while (window.MMO_InputGuard.depth() > 0) window.MMO_InputGuard.pop();
        }
      } catch (_) {}

      if (window.MMO_InputGuard && typeof window.MMO_InputGuard.push === 'function') window.MMO_InputGuard.push();
      if (window.MMO_TextBuffer) {
        if (typeof window.MMO_TextBuffer.begin === 'function') window.MMO_TextBuffer.begin();
        else if (typeof window.MMO_TextBuffer.push === 'function') window.MMO_TextBuffer.push();
      }
    }

    deactivate() {
      super.deactivate();
      if (window.MMO_TextBuffer) {
        if (typeof window.MMO_TextBuffer.end === 'function') window.MMO_TextBuffer.end();
        else if (typeof window.MMO_TextBuffer.pop === 'function') window.MMO_TextBuffer.pop();
      }
      if (window.MMO_InputGuard && typeof window.MMO_InputGuard.pop === 'function') window.MMO_InputGuard.pop();
    }

    update() {
      super.update();
      if (this.active) this.processKeyboardInput();
    }

    processKeyboardInput() {
      if (!window.MMO_TextBuffer || typeof window.MMO_TextBuffer.consume !== 'function') return;
      const key = window.MMO_TextBuffer.consume();
      if (!key) return;

      // Enter is handled by OK action.
      if (key === 'Enter') return;

      if (key === 'Backspace') {
        this._text = this._text.slice(0, -1);
        SoundManager.playCursor();
        this.refresh();
        return;
      }

      if (key === 'Delete') {
        this._text = '';
        SoundManager.playCursor();
        this.refresh();
        return;
      }

      if (key && key.length === 1) {
        if (this._text.length >= this._maxLength) {
          SoundManager.playBuzzer();
          return;
        }
        this._text += key;
        SoundManager.playCursor();
        this.refresh();
      }
    }

    maxItems() { return 1; }

    drawItem(index) {
      const rect = this.itemRect(index);
      this.resetTextColor();
      this.drawText(this._placeholder, rect.x, rect.y, 160);
      const shown = this._text ? this._text : '';
      this.drawText(shown, rect.x + 160, rect.y, rect.width - 160);
    }
  }

  class Window_SocialPromptCommand extends Window_HorzCommand {
    makeCommandList() {
      this.addCommand('OK', 'ok');
      this.addCommand('Cancel', 'cancel');
    }
    maxCols() { return 2; }
  }

  class Scene_SocialPrompt extends Scene_MenuBase {
    static prepare(options) {
      Scene_SocialPrompt._nextOptions = options || null;
    }

    create() {
      super.create();

      // Opening Social clears the "new social" badge until another new request/invite arrives.
      try {
        if (MMO_Notify && typeof MMO_Notify.clearSocial === 'function') MMO_Notify.clearSocial();
      } catch (_) {}
      this._options = Scene_SocialPrompt._nextOptions || {};
      Scene_SocialPrompt._nextOptions = null;

      if (Input && typeof Input.clear === 'function') Input.clear();
      if (TouchInput && typeof TouchInput.clear === 'function') TouchInput.clear();

      const margin = 12;
      const helpH = this.calcWindowHeight(1, true);
      const inputH = this.calcWindowHeight(1, true);
      const cmdH = this.calcWindowHeight(1, true);

      const helpRect = new Rectangle(margin, margin, Graphics.boxWidth - margin * 2, helpH);
      const inputRect = new Rectangle(margin, margin + helpH + margin, Graphics.boxWidth - margin * 2, inputH);
      const cmdRect = new Rectangle(margin, margin + helpH + margin + inputH + margin, Graphics.boxWidth - margin * 2, cmdH);

      this._helpWindow = new Window_Help(helpRect);
      this._helpWindow.setText(String(this._options.helpText || 'Enter username:'));
      this.addWindow(this._helpWindow);

      this._inputWindow = new Window_SocialTextInput(inputRect);
      this._inputWindow.setHandler('ok', this.onOk.bind(this));
      this._inputWindow.setHandler('cancel', this.popScene.bind(this));
      this._inputWindow.setConfig({
        maxLength: this._options.maxLength ?? 20,
        placeholder: this._options.placeholder ?? 'Username:'
      });
      this.addWindow(this._inputWindow);

      this._cmdWindow = new Window_SocialPromptCommand(cmdRect);
      this._cmdWindow.setHandler('ok', this.onOk.bind(this));
      this._cmdWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._cmdWindow);

      this._inputWindow.select(0);
      this._inputWindow.activate();
      this._cmdWindow.deactivate();
    }

    onOk() {
      const name = this._inputWindow.text().trim();
      if (!name) {
        SoundManager.playBuzzer();
        return;
      }
      SoundManager.playOk();
      try {
        if (typeof this._options.onSubmit === 'function') this._options.onSubmit(name);
      } catch (e) {
        console.warn('[SocialPrompt] submit failed', e);
      }

      // Important: make sure the shared input guard / text buffer are released.
      try { this._inputWindow.deactivate(); } catch (_) {}
      try { this._cmdWindow.deactivate(); } catch (_) {}

      this.popScene();
    }

    terminate() {
      // Also clean up when leaving via Cancel.
      try { this._inputWindow?.deactivate(); } catch (_) {}
      try { this._cmdWindow?.deactivate(); } catch (_) {}

      try {
        if (window.MMO_TextBuffer && typeof window.MMO_TextBuffer._depth === 'function') {
          while (window.MMO_TextBuffer._depth() > 0) window.MMO_TextBuffer.end();
        }
        if (window.MMO_InputGuard && typeof window.MMO_InputGuard.depth === 'function') {
          while (window.MMO_InputGuard.depth() > 0) window.MMO_InputGuard.pop();
        }
      } catch (_) {}

      super.terminate();
    }
  }

  // ---------------------------------------------------------------------------
  // Social UI
  // ---------------------------------------------------------------------------
  class Window_SocialTabs extends Window_HorzCommand {
    makeCommandList() {
      this.addCommand('Party', 'party');
      this.addCommand('Requests', 'requests');
      this.addCommand('Friends', 'friends');
      this.addCommand('Guild', 'guild');
      this.addCommand('Blocked', 'blocked');
    }

maxCols() { return 5; }

    // Slightly shrink the highlight/button rect so it doesn't overlap the window border.
    itemRect(index) {
      const rect = super.itemRect(index);
      rect.x += 2;
      rect.y += 3;
      rect.width = Math.max(0, rect.width - 4);
      rect.height = Math.max(0, rect.height - 6);
      return rect;
    }


    processOk() {
      // Window_Command deactivates before calling handlers.
      // We set a flag so the Scene can tell this was a keyboard/gamepad OK.
      this._okTriggered = true;
      try {
        super.processOk();
      } finally {
        this._okTriggered = false;
      }
    }

    cursorUp() {
      // Top-most row: buzzer instead of "activating" anything.
      SoundManager.playBuzzer();
    }

    cursorDown(wrap) {
      if (this.isHandled('focusList')) {
        SoundManager.playCursor();
        this.callHandler('focusList');
        return;
      }
      super.cursorDown(wrap);
    }

    update() {
      super.update();
      this._processInactiveClick();
    }

    _processInactiveClick() {
      if (this.active) return;
      if (!this.isOpen() || !this.visible) return;
      if (!TouchInput.isTriggered()) return;
      if (!this.isTouchedInsideFrame()) return;

      const x = this.canvasToLocalX(TouchInput.x);
      const y = this.canvasToLocalY(TouchInput.y);
      const hit = this.hitTest(x, y);
      if (hit >= 0) {
        this.select(hit);
        const sym = this.commandSymbol(hit);
        if (sym && this.isHandled(sym)) {
          SoundManager.playOk();
          this.callHandler(sym);
        }
      }
    }
  }

  class Window_SocialList extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._mode = 'friends';
      this._guildView = 'roster'; // 'roster' | 'invites'
      this._data = [];
      this.refresh();
    }

    setMode(mode) {
      if (mode === 'requests') this._mode = 'requests';
      else if (mode === 'blocked') this._mode = 'blocked';
      else if (mode === 'guild') this._mode = 'guild';
      else if (mode === 'party') this._mode = 'party';
      else this._mode = 'friends';

      this.refresh();
      const max = this.maxItems();
      if (max <= 0) this.select(-1);
      else if (this.index() < 0 || this.index() >= max) this.select(-1);
    }

    setGuildView(view) {
      this._guildView = (view === 'invites') ? 'invites' : 'roster';
      if (this._mode === 'guild') {
        this.refresh();
        const max = this.maxItems();
        if (max <= 0) this.select(-1);
        else if (this.index() < 0 || this.index() >= max) this.select(-1);
      }
    }

    guildView() { return this._guildView; }

    maxItems() { return this._data.length; }
    item() { return this._data[this.index()]; }

    makeItemList() {
      if (this._mode === 'blocked') {
        this._data = Social.getBlocks();
        return;
      }
      if (this._mode === 'friends') {
        this._data = Social.getFriends();
        return;
      }
      if (this._mode === 'requests') {
        const Mail = window.MMO_Mail;
        const inbox = (Mail && Array.isArray(Mail.inbox)) ? Mail.inbox : [];
        this._data = inbox
          .filter((m) => String(m.type || '') === 'friend_request')
          .slice()
          .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        return;
      }
      if (this._mode === 'party') {
        const P = window.MMO_PartyInvites;
        this._data = (P && typeof P.list === 'function') ? P.list() : [];
        return;
      }

      const G = window.Guild;
      if (!G) { this._data = []; return; }

      if (this._guildView === 'invites') this._data = Array.isArray(G.invites) ? G.invites : [];
      else this._data = Array.isArray(G.roster) ? G.roster : [];
    }

    refresh() {
      this.makeItemList();
      super.refresh();

      if (this._data.length === 0) {
        this.contents.clear();
        this.resetTextColor();

        let msg = '';
        if (this._mode === 'blocked') msg = 'No blocked players.';
        else if (this._mode === 'requests') msg = 'No friend requests.';
        else if (this._mode === 'guild') msg = (this._guildView === 'invites') ? 'No guild requests.' : 'No guild roster.';
        else if (this._mode === 'party') msg = 'No party invites.';
        else msg = 'No friends.';

        this.drawText(msg, 0, 0, this.innerWidth, 'center');
      }
    }

        drawItem(index) {
      const rect = this.itemLineRect(index);
      const item = this._data[index];
      if (!item) return;

      this.resetTextColor();

      if (this._mode === 'guild') {
        if (this._guildView === 'invites') {
          const tag = item.guildTag ? `[${item.guildTag}] ` : '';
          const name = String(item.guildName || 'Guild');
          const left = `${tag}${name}`;
          const right = item.inviterName ? `From: ${item.inviterName}` : '';
          this.drawText(left, rect.x, rect.y, rect.width - 160);
          if (right) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(right, rect.x + rect.width - 160, rect.y, 160, 'right');
            this.resetTextColor();
          }
        } else {
          const username = String(item.username ?? item.name ?? '');
          const rank = String(item.rankName ?? item.rankId ?? '');
          this.drawText(username, rect.x, rect.y, rect.width - 140);
          if (rank) {
            this.changeTextColor(ColorManager.systemColor());
            this.drawText(rank, rect.x + rect.width - 140, rect.y, 140, 'right');
            this.resetTextColor();
          }
        }
        return;
      }

      if (this._mode === 'party') {
        const username = String(item.username ?? item.name ?? item.userId ?? '');
        this.drawText(username, rect.x, rect.y, rect.width);
        return;
      }

      if (this._mode === 'requests') {
        const fromName = String(item.fromUsername ?? '').trim();
        const fallback = resolveAccountUsername(item.fromId ?? item.from ?? item.userId ?? item.id ?? '');
        const name = fromName || String(fallback ?? '').trim();
        const label = name ? `From: ${name}` : 'Friend request';
        this.drawText(label, rect.x, rect.y, rect.width);
        return;
      }

      const username = String(item.username ?? '');
      const online = !!item.online;

      if (this._mode === 'friends') {
        const status = online ? 'Online' : 'Offline';
        this.drawText(username, rect.x, rect.y, rect.width - 120);
        this.changeTextColor(ColorManager.systemColor());
        this.drawText(status, rect.x + rect.width - 120, rect.y, 120, 'right');
        this.resetTextColor();
      } else {
        this.drawText(username, rect.x, rect.y, rect.width);
      }
    }


    cursorUp(wrap) {
      // If we're at the top (or the list is empty), UP goes back to tabs.
      if (this.isHandled('focusTabs') && (this.maxItems() <= 0 || this.index() <= 0)) {
        SoundManager.playCursor();
        this.callHandler('focusTabs');
        return;
      }
      super.cursorUp(wrap);
    }

    cursorDown(wrap) {
      // If list is focused but nothing selected yet, DOWN selects the first entry.
      if (this.index() < 0 && this.maxItems() > 0) {
        SoundManager.playCursor();
        this.select(0);
        return;
      }

      // If we're at the bottom (or the list is empty), DOWN goes to bottom commands.
      const max = this.maxItems();
      if (this.isHandled('focusCmd') && (max <= 0 || this.index() >= max - 1)) {
        SoundManager.playCursor();
        this.callHandler('focusCmd');
        return;
      }
      super.cursorDown(wrap);
    }

    processOk() {
      // Two-step selection:
      // - If list is focused (border highlight) but no item is selected (index < 0),
      //   first OK selects the first entry.
      // - Subsequent OK triggers the normal handler.
      if (this.index() < 0 && this.maxItems() > 0) {
        this.select(0);
        SoundManager.playCursor();
        return;
      }
      super.processOk();
    }

    updateCursor() {
      // When focused but nothing selected, highlight the whole list window.
      if (this.active && this.index() < 0) {
        this.setCursorRect(0, 0, this.innerWidth, this.innerHeight);
        return;
      }
      super.updateCursor();
    }


    update() {
      super.update();
      this._processInactiveClick();
    }

    _processInactiveClick() {
      if (this.active) return;
      if (!this.isOpen() || !this.visible) return;
      if (!TouchInput.isTriggered()) return;
      if (!this.isTouchedInsideFrame()) return;

      const x = this.canvasToLocalX(TouchInput.x);
      const y = this.canvasToLocalY(TouchInput.y);
      const hit = this.hitTest(x, y);
      if (hit >= 0) {
        this.select(hit);
        if (this.isHandled('ok')) {
          SoundManager.playOk();
          this.callHandler('ok');
        }
      }
    }
  }

  class Window_SocialCommands extends Window_HorzCommand {
    initialize(rect) {
      this._mode = 'friends';
      super.initialize(rect);
    }

    setMode(mode) {
      if (mode === 'requests') this._mode = 'requests';
      else if (mode === 'blocked') this._mode = 'blocked';
      else if (mode === 'guild') this._mode = 'guild';
      else if (mode === 'party') this._mode = 'party';
      else this._mode = 'friends';
      this.refresh();
      // Cursor stays on first command for each mode.
      if (typeof this.select === 'function') this.select(0);
    }

    makeCommandList() {
      if (this._mode === 'requests') {
        this.addCommand('Refresh', 'refresh');
        this.addCommand('Close', 'cancel');
        return;
      }

      if (this._mode === 'blocked') {
        this.addCommand('Unblock', 'unblock');
        this.addCommand('Refresh', 'refresh');
        this.addCommand('Close', 'cancel');
        return;
      }

      if (this._mode === 'guild') {
        const G = window.Guild;
        const hasGuild = !!G;
        const inGuild = !!(G && G.inGuild);
        const canInvite = !!(inGuild && typeof G.canInvite === 'function' ? G.canInvite() : false);
        const isLeader = !!(inGuild && typeof G.isLeader === 'function' ? G.isLeader() : false);

        this.addCommand('Invite', 'g_invite', hasGuild && inGuild && canInvite);
        this.addCommand('Requests', 'g_invites', hasGuild && !inGuild);
        this.addCommand('Roster', 'g_roster', hasGuild && inGuild);
        this.addCommand('Leave', 'g_leave', hasGuild && inGuild && !isLeader);
        this.addCommand('Refresh', 'refresh', true);
        this.addCommand('Close', 'cancel', true);
        return;
      }

      // Friends

      if (this._mode === 'party') {
        this.addCommand('Refresh', 'refresh');
        this.addCommand('Close', 'cancel');
        return;
      }

      // Friends
      this.addCommand('Add', 'add');
      this.addCommand('Refresh', 'refresh');
      this.addCommand('Close', 'cancel');
    }

    maxCols() {
      if (this._mode === 'guild') return 6;
      if (this._mode === 'party') return 2;
      if (this._mode === 'requests') return 2;
      return 3;
    }

    // Slightly shrink the highlight/button rect so it doesn't overlap the window border.
    itemRect(index) {
      const rect = super.itemRect(index);
      rect.x += 2;
      rect.y += 3;
      rect.width = Math.max(0, rect.width - 4);
      rect.height = Math.max(0, rect.height - 6);
      return rect;
    }

    cursorUp(wrap) {
      if (this.isHandled('focusList')) {
        SoundManager.playCursor();
        this.callHandler('focusList');
        return;
      }
      if (this.isHandled('focusTabs')) {
        SoundManager.playCursor();
        this.callHandler('focusTabs');
        return;
      }
      super.cursorUp(wrap);
    }

    cursorDown() {
      // Bottom-most row: buzzer instead of wrapping.
      SoundManager.playBuzzer();
    }

    update() {
      super.update();
      this._processInactiveClick();
    }

    _processInactiveClick() {
      if (this.active) return;
      if (!this.isOpen() || !this.visible) return;
      if (!TouchInput.isTriggered()) return;
      if (!this.isTouchedInsideFrame()) return;

      const x = this.canvasToLocalX(TouchInput.x);
      const y = this.canvasToLocalY(TouchInput.y);
      const hit = this.hitTest(x, y);
      if (hit >= 0) {
        this.select(hit);
        const sym = this.commandSymbol(hit);
        if (sym && this.isHandled(sym)) {
          SoundManager.playOk();
          this.callHandler(sym);
        }
      }
    }
  }

  class Window_SocialContext extends Window_Command {
    initialize(rect) {
      super.initialize(rect);
      this.openness = 0;
      this.hide();
      this.deactivate();
      this._mode = 'friends';
      this._item = null;
    }

    setContext(mode, item) {
      this._mode = mode || 'friends';
      this._item = item || null;
      this.refresh();
    }

    targetUsername() {
      const u = this._item?.username ?? this._item?.name ?? this._item?.fromUsername ?? this._item?.from ?? '';
      return String(u || '').trim();
    }

    makeCommandList() {
      const mode = this._mode;
      const username = this.targetUsername();

      if (mode === 'friends') {
        const G = window.Guild;
        const canInvite = !!(G && G.inGuild && typeof G.canInvite === 'function' ? G.canInvite() : false);
        const hasMailUI = !!(window.MMO_MailUI && typeof window.MMO_MailUI.openComposeTo === 'function');
        this.addCommand('Invite to Guild', 'inviteGuild', !!username && canInvite);
        this.addCommand('Send Mail', 'sendMail', !!username && hasMailUI);
        this.addCommand('Remove Friend', 'removeFriend', !!username);
        this.addCommand('Block', 'block', !!username);
        this.addCommand('Cancel', 'cancel', true);
        return;
      }

      if (mode === 'blocked') {
        this.addCommand('Unblock', 'unblock', !!username);
        this.addCommand('Cancel', 'cancel', true);
        return;
      }

      if (mode === 'requests') {
        this.addCommand('Accept', 'f_accept', !!this._item?.id);
        this.addCommand('Decline', 'f_decline', !!this._item?.id);
        this.addCommand('Cancel', 'cancel', true);
        return;
      }

      if (mode === 'guild') {
        const G = window.Guild;
        const inGuild = !!(G && G.inGuild);
        const canAccept = !!(G && !inGuild && typeof G.acceptInvite === 'function' && this._item?.guildId);
        const canDecline = !!(G && !inGuild && typeof G.declineInvite === 'function' && this._item?.guildId);
        this.addCommand('Accept', 'g_accept', canAccept);
        this.addCommand('Decline', 'g_decline', canDecline);
        this.addCommand('Cancel', 'cancel', true);
      }

      if (mode === 'party') {
        this.addCommand('Accept', 'p_accept', !!this._item?.userId);
        this.addCommand('Decline', 'p_decline', !!this._item?.userId);
        this.addCommand('Cancel', 'cancel', true);
        return;
      }
    }

    update() {
      super.update();
      this._processOutsideCancel();
    }

    _processOutsideCancel() {
      if (!this.active) return;
      if (!this.isOpen() || !this.visible) return;
      if (!TouchInput.isTriggered()) return;
      if (this.isTouchedInsideFrame()) return;
      if (this.isHandled('cancel')) {
        SoundManager.playCancel();
        this.callHandler('cancel');
      }
    }
  }

  class Window_SocialConfirm extends Window_Command {
    initialize(rect) {
      super.initialize(rect);
      this._message = 'Are you sure?';
      this.openness = 0;
      this.hide();
    }

    setMessage(text) {
      this._message = String(text || 'Are you sure?');
      this.refresh();
    }

    makeCommandList() {
      this.addCommand(this._message, 'msg', false);
      this.addCommand('Yes', 'yes', true);
      this.addCommand('No', 'no', true);
    }

    maxCols() { return 1; }
  }

  // ---------------------------------------------------------------------------
  // Main Social Scene
  // ---------------------------------------------------------------------------
  class Scene_Social extends Scene_MenuBase {
    create() {
      super.create();

      const margin = 12;
      const tabH = this.calcWindowHeight(1, true);
      const cmdH = this.calcWindowHeight(1, true);

      const tabRect = new Rectangle(margin, margin, Graphics.boxWidth - margin * 2, tabH);
      const listRect = new Rectangle(
        margin,
        margin + tabH + margin,
        Graphics.boxWidth - margin * 2,
        Graphics.boxHeight - margin * 4 - tabH - cmdH
      );
      const cmdRect = new Rectangle(margin, Graphics.boxHeight - margin - cmdH, Graphics.boxWidth - margin * 2, cmdH);

      this._tabsWindow = new Window_SocialTabs(tabRect);
      this._tabsWindow.setHandler('friends', () => this.onTabSelected('friends'));
      this._tabsWindow.setHandler('requests', () => this.onTabSelected('requests'));
      this._tabsWindow.setHandler('blocked', () => this.onTabSelected('blocked'));
      this._tabsWindow.setHandler('guild', () => this.onTabSelected('guild'));
      this._tabsWindow.setHandler('party', () => this.onTabSelected('party'));
      this._tabsWindow.setHandler('focusList', this.onTabsDown.bind(this));
      this._tabsWindow.setHandler('cancel', this.activateCmd.bind(this));
      this.addWindow(this._tabsWindow);

      this._listWindow = new Window_SocialList(listRect);
      this._listWindow.setHandler('ok', this.onListOk.bind(this));
      this._listWindow.setHandler('focusTabs', this.activateTabs.bind(this));
      this._listWindow.setHandler('focusCmd', this.activateCmd.bind(this));
      this._listWindow.setHandler('cancel', this.activateTabs.bind(this));
      this.addWindow(this._listWindow);

      this._cmdWindow = new Window_SocialCommands(cmdRect);
      this._cmdWindow.setHandler('add', this.onAddFriend.bind(this));
      this._cmdWindow.setHandler('unblock', this.onUnblockCommand.bind(this));
      this._cmdWindow.setHandler('refresh', this.onRefresh.bind(this));
      this._cmdWindow.setHandler('g_invite', this.onGuildInvite.bind(this));
      this._cmdWindow.setHandler('g_invites', this.onGuildInvites.bind(this));
      this._cmdWindow.setHandler('g_roster', this.onGuildRoster.bind(this));
      this._cmdWindow.setHandler('g_leave', this.onGuildLeave.bind(this));
            this._cmdWindow.setHandler('focusList', this.onCmdUp.bind(this));
this._cmdWindow.setHandler('focusTabs', this.activateTabs.bind(this));
      this._cmdWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._cmdWindow);

      const ctxW = Math.min(420, Graphics.boxWidth - margin * 4);
      const ctxH = this.calcWindowHeight(5, true);
      const ctxX = Math.floor((Graphics.boxWidth - ctxW) / 2);
      const ctxY = Math.floor(Graphics.boxHeight - margin - cmdH - margin - ctxH);
      this._contextWindow = new Window_SocialContext(new Rectangle(ctxX, ctxY, ctxW, ctxH));
      this._contextWindow.setHandler('inviteGuild', this.onCtxInviteGuild.bind(this));
      this._contextWindow.setHandler('sendMail', this.onCtxSendMail.bind(this));
      this._contextWindow.setHandler('removeFriend', this.onCtxRemoveFriend.bind(this));
      this._contextWindow.setHandler('block', this.onCtxBlock.bind(this));
      this._contextWindow.setHandler('unblock', this.onCtxUnblock.bind(this));
      this._contextWindow.setHandler('f_accept', this.onCtxFriendAccept.bind(this));
      this._contextWindow.setHandler('f_decline', this.onCtxFriendDecline.bind(this));
      this._contextWindow.setHandler('g_accept', this.onCtxGuildAccept.bind(this));
      this._contextWindow.setHandler('g_decline', this.onCtxGuildDecline.bind(this));
            this._contextWindow.setHandler('p_accept', this.onCtxPartyAccept.bind(this));
      this._contextWindow.setHandler('p_decline', this.onCtxPartyDecline.bind(this));
this._contextWindow.setHandler('cancel', this.closeContext.bind(this));
      this.addWindow(this._contextWindow);

      const confirmW = Math.min(420, Graphics.boxWidth - margin * 4);
      const confirmH = this.calcWindowHeight(3, true);
      const confirmX = Math.floor((Graphics.boxWidth - confirmW) / 2);
      const confirmY = Math.floor((Graphics.boxHeight - confirmH) / 2);
      this._confirmWindow = new Window_SocialConfirm(new Rectangle(confirmX, confirmY, confirmW, confirmH));
      this._confirmWindow.setHandler('yes', this.onConfirmLeaveYes.bind(this));
      this._confirmWindow.setHandler('no', this.onConfirmLeaveNo.bind(this));
      this._confirmWindow.setHandler('cancel', this.onConfirmLeaveNo.bind(this));
      this.addWindow(this._confirmWindow);

      // Live updates
      Social.on('updated', () => {
        if (SceneManager._scene !== this) return;
        this._listWindow.refresh();
      });

      // Mail list updates (used for Friend Requests tab)
      try {
        const Mail = window.MMO_Mail;
        if (Mail && typeof Mail.on === 'function') {
          Mail.on('updated', () => {
            if (SceneManager._scene !== this) return;
            if (this._mode === 'requests') this._listWindow.refresh();
          });
        }
      } catch (_) {}

      // Guild live updates (roster/invites/state)
      this._guildHandlers = [];
      const G = window.Guild;
      if (G && typeof G.on === 'function') {
        const refreshGuildUi = () => {
          if (SceneManager._scene !== this) return;
          if (this._mode === 'guild') this._listWindow.refresh();
          this._cmdWindow.refresh();
        };

        for (const ev of ['joined', 'left', 'rosterUpdated', 'invitesUpdated', 'infoUpdated']) {
          G.on(ev, refreshGuildUi);
          this._guildHandlers.push([ev, refreshGuildUi]);
        }

        const onErr = (msg) => {
          if (SceneManager._scene !== this) return;
          if (!msg) return;

          // Guild emits structured errors: { command, error }
          if (typeof msg === 'object') {
            const err = msg.error ?? msg.message ?? msg.text;
            const cmd = msg.command;

            if (cmd === 'invite') {
              const target = (typeof G._lastInviteTarget === 'string') ? G._lastInviteTarget.trim() : '';
              if (target && typeof err === 'string' && err.trim()) {
                chatSystem(`Could not invite ${target}: ${err}`);
              } else if (typeof err === 'string' && err.trim()) {
                chatSystem(err);
              } else {
                chatSystem(msg);
              }
              // Avoid stale target leaking into future messages.
              try { G._lastInviteTarget = null; } catch (_) {}
              return;
            }

            if (typeof err === 'string' && err.trim()) {
              chatSystem(err);
              return;
            }
          }

          chatSystem(msg);
        };
        G.on('error', onErr);
        this._guildHandlers.push(['error', onErr]);
      }

      // Initial state
      this._mode = 'party';
      this.setMode('party');
      this.onRefresh();

      // Focus: start on command bar (blinking cursor)
      this._tabsWindow.deactivate();
      this._listWindow.deactivate();
      this._contextWindow.deactivate();
      this._confirmWindow.deactivate();
      this._cmdWindow.activate();
      this._cmdWindow.select(0);
    }

    terminate() {
      super.terminate();
      const G = window.Guild;
      if (G && typeof G.off === 'function' && Array.isArray(this._guildHandlers)) {
        for (const [ev, fn] of this._guildHandlers) {
          try { G.off(ev, fn); } catch (_) {}
        }
      }
      this._guildHandlers = [];
    }

    // ---------------- Focus helpers ----------------

    activateCmd() {
      this.closeContext();
      if (this._confirmWindow) {
        this._confirmWindow.deactivate();
        this._confirmWindow.hide();
      }

      this._tabsWindow.deactivate();
      this._listWindow.deactivate();
      this._listWindow.select(-1);

      this._cmdWindow.activate();
      if (this._cmdWindow.index() < 0) this._cmdWindow.select(0);
    }

    selectTabBySymbol(sym) {
      const w = this._tabsWindow;
      if (!w) return;
      const s = String(sym || '').trim();
      if (!s) return;

      // MZ Window_Command usually has selectSymbol; prefer it when available.
      if (typeof w.selectSymbol === 'function') {
        w.selectSymbol(s);
        return;
      }

      const list = w._list || [];
      const idx = list.findIndex(c => c && c.symbol === s);
      if (idx >= 0) w.select(idx);
    }

    activateTabs() {
      this.closeContext();
      if (this._confirmWindow) {
        this._confirmWindow.deactivate();
        this._confirmWindow.hide();
      }

      // Remove "stuck highlight" from command bar when not focused.
      if (this._cmdWindow && typeof this._cmdWindow.deselect === 'function') this._cmdWindow.deselect();
      this._cmdWindow.deactivate();
      this._listWindow.deactivate();

      this._tabsWindow.activate();
      this.selectTabBySymbol(this._mode);
      // When returning to tabs, list should be in focus-only state.
      this._listWindow.select(-1);
    }

    activateList() {
      this.closeContext();
      if (this._confirmWindow) {
        this._confirmWindow.deactivate();
        this._confirmWindow.hide();
      }

      if (this._cmdWindow && typeof this._cmdWindow.deselect === 'function') this._cmdWindow.deselect();
      this._cmdWindow.deactivate();
      this._tabsWindow.deactivate();

      this._listWindow.activate();
      // Enter list in "focus" state (border highlight), not selecting an item yet.
      this._listWindow.select(-1);

    }

    openContext(mode, item) {
      this._contextWindow.setContext(mode, item);
      this._contextWindow.refresh();
      this._contextWindow.show();
      this._contextWindow.open();
      this._contextWindow.activate();
      this._contextWindow.select(0);

      this._tabsWindow.deactivate();
      this._listWindow.deactivate();
      this._cmdWindow.deactivate();
    }

    closeContext() {
      if (!this._contextWindow) return;
      this._contextWindow.deactivate();
      this._contextWindow.close();
      this._contextWindow.hide();
      // Return focus to the list by default (user selected an item).
      if (this._listWindow) this._listWindow.activate();
    }

    // ---------------- Mode switching ----------------

    onTabSelected(mode) {
      // NOTE: Window_Command.processOk() deactivates the window BEFORE calling the handler.
      // So we can't use this._tabsWindow.active to detect an OK press.
      const fromTabsOk = !!(this._tabsWindow && this._tabsWindow._okTriggered);
      this.setMode(mode);

      // Keyboard flow: Tabs OK -> bottom command bar
      if (fromTabsOk) {
        this.activateCmd();

        // Select the first enabled command for the new tab.
        const list = this._cmdWindow?._list || [];
        let idx = 0;
        for (let i = 0; i < list.length; i++) {
          if (list[i] && list[i].enabled !== false) { idx = i; break; }
        }
        this._cmdWindow.select(idx);
      }
    }

    onTabsDown() {
      // DOWN from tabs:
      // - If the center list has items, go to the list
      // - If empty, skip list and go straight to bottom commands
      const max = this._listWindow ? this._listWindow.maxItems() : 0;
      if (max > 0) this.activateList();
      else this.activateCmd();
    }


    onCmdUp() {
      // UP from bottom commands:
      // - If list has items, go to list (border highlight)
      // - If empty, go to tabs
      const max = this._listWindow ? this._listWindow.maxItems() : 0;
      if (max > 0) this.activateList();
      else this.activateTabs();
    }

    setMode(mode) {
      const m = (mode === 'requests') ? 'requests' : ((mode === 'blocked') ? 'blocked' : (mode === 'guild' ? 'guild' : (mode === 'party' ? 'party' : 'friends')));
      this._mode = m;

      this._listWindow.setMode(m);
      this._cmdWindow.setMode(m);

      if (m === 'requests') {
        const Mail = window.MMO_Mail;
        if (Mail && typeof Mail.requestList === 'function') Mail.requestList();
      }

      // Default guild subview based on state
      if (m === 'guild') {
        const G = window.Guild;
        if (G && G.inGuild) {
          this._listWindow.setGuildView('roster');
          if (typeof G.getRoster === 'function') G.getRoster();
        } else {
          this._listWindow.setGuildView('invites');
          if (G && typeof G.getInvites === 'function') G.getInvites();
        }
      }

      // Reset command selection so it never "carries" highlights across tabs.
      if (this._cmdWindow) {
        this._cmdWindow.refresh();
        if (this._cmdWindow.active) this._cmdWindow.select(0);
        else if (typeof this._cmdWindow.deselect === 'function') this._cmdWindow.deselect();
      }

      // Keep tabs aligned visually (symbol-based so tab order can change safely)
      if (this._tabsWindow) this.selectTabBySymbol(m);
    }

    // ---------------- Commands ----------------

    onRefresh() {
      const prevFocus =
        this._contextWindow.active ? 'context' :
        this._tabsWindow.active ? 'tabs' :
        this._listWindow.active ? 'list' : 'cmd';

      if (this._mode === 'guild') {
        const G = window.Guild;
        if (!G) {
          chatSystem('Guild system is not loaded.');
        } else if (G.inGuild) {
          if (typeof G.getRoster === 'function') G.getRoster();
        } else {
          if (typeof G.getInvites === 'function') G.getInvites();
        }
        this._listWindow.refresh();
        this._cmdWindow.refresh();
      } else if (this._mode === 'requests') {
        const Mail = window.MMO_Mail;
        if (!Mail || typeof Mail.requestList !== 'function') {
          chatSystem('Mail system is not loaded.');
        } else {
          Mail.requestList();
        }
        this._listWindow.refresh();
        this._cmdWindow.refresh();
      } else {
        Social.requestList();
        this._listWindow.refresh();
      }

      // Restore focus (prevents "freeze" / dead input)
      if (prevFocus === 'tabs') this.activateTabs();
      else if (prevFocus === 'list') this.activateList();
      else if (prevFocus === 'context') this._contextWindow.activate();
      else this.activateCmd();
    }

    onAddFriend() {
      Scene_SocialPrompt.prepare({
        helpText: 'Enter a username to send a friend request (shows in Social → Requests):',
        placeholder: 'Username:',
        maxLength: 20,
        onSubmit: (username) => {
          Social.requestFriend(username);
          chatSystem(`Friend request sent to ${username}.`);
        }
      });
      SceneManager.push(Scene_SocialPrompt);
      this.activateCmd();
    }

    onUnblockCommand() {
      // Prefer list selection; if none, just buzz.
      const item = this._listWindow.item();
      if (!item || !item.username) {
        SoundManager.playBuzzer();
        this.activateCmd();
        return;
      }
      this.openContext('blocked', item);
    }

    // ---------------- List OK ----------------

    onListOk() {
      // If list is focused but no item selected yet, first OK should only select the first entry.
      if (this._listWindow.index() < 0 && this._listWindow.maxItems() > 0) {
        SoundManager.playCursor();
        this._listWindow.select(0);
        this._listWindow.activate();
        return;
      }

      const item = this._listWindow.item();

      if (this._mode === 'party') {
        if (!item || !item.userId) {
          SoundManager.playBuzzer();
          this.activateList();
          return;
        }
        this.openContext('party', item);
        return;
      }

if (this._mode === 'friends') {
        if (!item || !item.username) {
          SoundManager.playBuzzer();
          this.activateList();
          return;
        }
        this.openContext('friends', item);
        return;
      }

      if (this._mode === 'blocked') {
        if (!item || !item.username) {
          SoundManager.playBuzzer();
          this.activateList();
          return;
        }
        this.openContext('blocked', item);
        return;
      }

      if (this._mode === 'requests') {
        if (!item || !item.id) {
          SoundManager.playBuzzer();
          this.activateList();
          return;
        }
        this.openContext('requests', item);
        return;
      }

      // Guild
      const G = window.Guild;
      if (!G) {
        SoundManager.playBuzzer();
        this.activateList();
        return;
      }

      // Only act on invites list when NOT in a guild.
      if (G.inGuild || this._listWindow.guildView() !== 'invites') {
        SoundManager.playBuzzer();
        this.activateList();
        return;
      }

      if (!item || !item.guildId) {
        SoundManager.playBuzzer();
        this.activateList();
        return;
      }

      this.openContext('guild', item);
    }

    // ---------------- Context actions ----------------

    onCtxInviteGuild() {
      const username = this._contextWindow.targetUsername();
      const G = window.Guild;

      if (!username || !G || typeof G.inviteByUsername !== 'function') {
        SoundManager.playBuzzer();
        return;
      }

      if (!G.inGuild) {
        SoundManager.playBuzzer();
        chatSystem('You are not in a guild.');
        return;
      }

      if (typeof G.canInvite === 'function' && !G.canInvite()) {
        SoundManager.playBuzzer();
        chatSystem('You do not have permission to invite.');
        return;
      }

      G.inviteByUsername(username);
this.closeContext();
    }

    onCtxSendMail() {
      const username = this._contextWindow.targetUsername();
      if (!username) { SoundManager.playBuzzer(); return; }

      const ui = window.MMO_MailUI;
      if (!ui || typeof ui.openComposeTo !== 'function') {
        SoundManager.playBuzzer();
        chatSystem('Mail UI not available.');
        return;
      }

      this.closeContext();
      ui.openComposeTo(username);
    }

    onCtxRemoveFriend() {
      const username = this._contextWindow.targetUsername();
      if (!username) { SoundManager.playBuzzer(); return; }
      Social.removeFriend(username);
      chatSystem(`Removed friend: ${username}`);
      this.closeContext();
    }

    onCtxBlock() {
      const username = this._contextWindow.targetUsername();
      if (!username) { SoundManager.playBuzzer(); return; }
      Social.block(username);
      chatSystem(`Blocked: ${username}`);
      this.closeContext();
    }

    onCtxUnblock() {
      const username = this._contextWindow.targetUsername();
      if (!username) { SoundManager.playBuzzer(); return; }
      Social.unblock(username);
      chatSystem(`Unblocked: ${username}`);
      this.closeContext();
    }

    onCtxFriendAccept() {
      const req = this._contextWindow._item;
      const mailId = req?.id;
      const fromUser = this._contextWindow.targetUsername();
      if (!mailId) { SoundManager.playBuzzer(); return; }
      safeBroadcast('f/accept', [mailId]);
      if (fromUser) chatSystem(`Accepted friend request from ${fromUser}.`);
      try {
        const Mail = window.MMO_Mail;
        if (Mail && typeof Mail.requestList === 'function') Mail.requestList();
      } catch (_) {}
      this.closeContext();
    }

    onCtxFriendDecline() {
      const req = this._contextWindow._item;
      const mailId = req?.id;
      const fromUser = this._contextWindow.targetUsername();
      if (!mailId) { SoundManager.playBuzzer(); return; }
      safeBroadcast('f/decline', [mailId]);
      if (fromUser) chatSystem(`Declined friend request from ${fromUser}.`);
      try {
        const Mail = window.MMO_Mail;
        if (Mail && typeof Mail.requestList === 'function') Mail.requestList();
      } catch (_) {}
      this.closeContext();
    }

    onCtxGuildAccept() {
      const G = window.Guild;
      const inv = this._contextWindow._item;
      if (!G || G.inGuild || !inv?.guildId) { SoundManager.playBuzzer(); return; }
      if (typeof G.acceptInvite === 'function') {
        G.acceptInvite(inv.guildId);
        chatSystem(`Accepted invite to ${inv.guildName || 'guild'}.`);
      }
      this.closeContext();
    }

    onCtxGuildDecline() {
      const G = window.Guild;
      const inv = this._contextWindow._item;
      if (!G || G.inGuild || !inv?.guildId) { SoundManager.playBuzzer(); return; }

      if (typeof G.declineInvite === 'function') {
        G.declineInvite(inv.guildId);
        chatSystem(`Declined invite to ${inv.guildName || 'guild'}.`);
      }
      this.closeContext();
      this.activateCmd();
    }

    onCtxPartyAccept() {
      const inv = this._contextWindow._item;
      if (!inv || !inv.userId) { SoundManager.playBuzzer(); return this.closeContext(); }
      const P = window.MMO_PartyInvites;
      if (P && typeof P.accept === 'function') {
        const ok = P.accept(inv);
        if (!ok) SoundManager.playBuzzer();
      }
      this._listWindow.refresh();
      this.closeContext();
      this.activateCmd();
    }

    onCtxPartyDecline() {
      const inv = this._contextWindow._item;
      const P = window.MMO_PartyInvites;
      if (P && typeof P.decline === 'function') P.decline(inv);
      this._listWindow.refresh();
      this.closeContext();
      this.activateCmd();
    }

    // ---------------- Guild tab commands ----------------

    onGuildInvites() {
      const G = window.Guild;
      if (!G) { SoundManager.playBuzzer(); chatSystem('Guild system is not loaded.'); return; }

      this._listWindow.setGuildView('invites');
      if (typeof G.getInvites === 'function') G.getInvites();

      this._listWindow.refresh();
      this._cmdWindow.refresh();
      this.activateList();
    }

    onGuildRoster() {
      const G = window.Guild;
      if (!G || !G.inGuild) {
        SoundManager.playBuzzer();
        chatSystem('You are not in a guild.');
        return;
      }

      this._listWindow.setGuildView('roster');
      if (typeof G.getRoster === 'function') G.getRoster();

      this._listWindow.refresh();
      this._cmdWindow.refresh();
      this.activateList();
    }

    onGuildInvite() {
      const G = window.Guild;
      if (!G || !G.inGuild) {
        SoundManager.playBuzzer();
        chatSystem('You are not in a guild.');
        return;
      }

      if (typeof G.canInvite === 'function' && !G.canInvite()) {
        SoundManager.playBuzzer();
        chatSystem('You do not have permission to invite.');
        return;
      }

      Scene_SocialPrompt.prepare({
        helpText: 'Enter a username to invite to the guild:',
        placeholder: 'Username:',
        maxLength: 20,
        onSubmit: (username) => {
          if (typeof G.inviteByUsername === 'function') {
            G.inviteByUsername(username);
}
        }
      });
      SceneManager.push(Scene_SocialPrompt);
      this.activateCmd();
    }

    onGuildLeave() {
      const G = window.Guild;
      if (!G || !G.inGuild) { SoundManager.playBuzzer(); return; }

      if (typeof G.isLeader === 'function' && G.isLeader()) {
        SoundManager.playBuzzer();
        chatSystem('Guild leader cannot leave (transfer leadership first).');
        return;
      }

      this._confirmWindow.setMessage('Leave guild?');
      this._confirmWindow.show();
      this._confirmWindow.open();
      this._confirmWindow.activate();
      this._confirmWindow.select(1); // Yes

      this._cmdWindow.deactivate();
      this._listWindow.deactivate();
      this._tabsWindow.deactivate();
      this._contextWindow.deactivate();
    }

    onConfirmLeaveYes() {
      const G = window.Guild;
      if (G && typeof G.leave === 'function') {
        G.leave();
        chatSystem('Leaving guild...');
      }
      this.onConfirmLeaveNo();
    }

    onConfirmLeaveNo() {
      this._confirmWindow.deactivate();
      this._confirmWindow.close();
      this._confirmWindow.hide();
      this._cmdWindow.refresh();
      this._listWindow.refresh();
      this.activateCmd();
    }
  }

  window.Scene_Social = Scene_Social;

  // ---------------------------------------------------------------------------
  // Add Social to the in-game character menu (Scene_Menu)
  // ---------------------------------------------------------------------------
  if (typeof Window_MenuCommand !== 'undefined') {
    const _Window_MenuCommand_addOriginalCommands = Window_MenuCommand.prototype.addOriginalCommands;
    Window_MenuCommand.prototype.addOriginalCommands = function() {
      _Window_MenuCommand_addOriginalCommands.call(this);
      try {
        if (!this._list || !this._list.some(c => c && c.symbol === 'social')) {
          this.addCommand('Social', 'social', true);
        }
      } catch (_) {
        this.addCommand('Social', 'social', true);
      }
    };
  }

  if (typeof Scene_Menu !== 'undefined') {
    const _Scene_Menu_createCommandWindow = Scene_Menu.prototype.createCommandWindow;
    Scene_Menu.prototype.createCommandWindow = function() {
      _Scene_Menu_createCommandWindow.call(this);
      if (this._commandWindow && typeof this._commandWindow.setHandler === 'function') {
        this._commandWindow.setHandler('social', this.commandSocial.bind(this));
      }
    };

    if (typeof Scene_Menu.prototype.commandSocial !== 'function') {
      Scene_Menu.prototype.commandSocial = function() {
        if (window.Scene_Social) SceneManager.push(window.Scene_Social);
        else SoundManager.playBuzzer();
      };
    }
  }

  // Plugin command
  PluginManager.registerCommand(pluginName, 'openSocial', () => {
    SceneManager.push(Scene_Social);
  });

  // ---------------------------------------------------------------------------
  // Player interaction menu: Add Friend + Block
  // ---------------------------------------------------------------------------
  if (!window._interaction) window._interaction = new Map();

  function interactionSupportsObjectEntries() {
    try {
      const fn = Game_Player && Game_Player.prototype && Game_Player.prototype.startMapEventFront;
      if (!fn) return false;
      const src = Function.prototype.toString.call(fn);
      return src.includes("typeof entry === 'object'") ||
             src.includes('typeof entry === "object"') ||
             src.includes('entry?.callback') ||
             src.includes('.enabled') ||
             src.includes('.callback');
    } catch (_) {
      return false;
    }
  }

  const addFriendEnabled = (userIdOrUsername) => {
    const uname = resolveAccountUsername(userIdOrUsername);
    if (!uname) return false;
    if (!Social.isLoaded()) return true;
    if (Social.isBlocked(uname)) return false;
    return !Social.isFriend(uname);
  };

  const addFriendCallback = (userIdOrUsername) => {
    const uname = resolveAccountUsername(userIdOrUsername);
    if (!uname) return;

    if (Social.isLoaded()) {
      if (Social.isBlocked(uname)) {
        SoundManager.playBuzzer();
        chatSystem(`You have ${uname} blocked.`);
        return;
      }
      if (Social.isFriend(uname)) {
        SoundManager.playBuzzer();
        chatSystem(`${uname} is already your friend.`);
        return;
      }
    }

    Social.requestFriend(uname);
    chatSystem(`Friend request sent to ${uname}.`);
  };

  const blockEnabled = (userIdOrUsername) => {
    const uname = resolveAccountUsername(userIdOrUsername);
    if (!uname) return false;
    if (!Social.isLoaded()) return true;
    return !Social.isBlocked(uname);
  };

  const blockCallback = (userIdOrUsername) => {
    const uname = resolveAccountUsername(userIdOrUsername);
    if (!uname) return;
    Social.block(uname);
    chatSystem(`Blocked: ${uname}`);
  };

  if (interactionSupportsObjectEntries()) {
    window._interaction.set('Add Friend', {
      enabled: (user, _name) => addFriendEnabled(user),
      callback: (user, _name) => addFriendCallback(user)
    });
    window._interaction.set('Block', {
      enabled: (user, _name) => blockEnabled(user),
      callback: (user, _name) => blockCallback(user)
    });
  } else {
    window._interaction.set('Add Friend', (user, _name) => addFriendCallback(user));
    window._interaction.set('Block', (user, _name) => blockCallback(user));
  }
})();