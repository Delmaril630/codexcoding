/*:
 * @target MZ
 * @plugindesc v1.0.3 Player Mail + Online Players List (UI fixes) Player Mail + Online Players List (server-backed)
 * @author Nate
 *
 * @command openMailbox
 * @text Open Mailbox
 * @desc Opens the player mailbox (inbox/sent/compose)
 *
 * @command openOnline
 * @text Open Online Players
 * @desc Shows a list of currently online players
 *
 * @param mmoGlobalName
 * @text MMO Global Name
 * @type string
 * @default client
 * @desc Name of the global MMO client object (e.g., client, MMO, MMORPG)
 *
 * @help
 * ============================================================================
 * SERVER REQUIREMENTS
 * ============================================================================
 * Requires server-side routing for:
 * - m/send, m/list, m/read, m/delete (group "mail")
 * - u/online (group "users")
 *
 * See included server files:
 * - mail.js
 * - presence.js
 * and handler.js routing updates.
 * ============================================================================
 */

(() => {
  'use strict';

  // ------------------------------------------------------------------------
  // Compatibility: Some builds/plugins can strip canvasToLocalX/Y off Window_Base.
  // Window_Selectable hit testing relies on these for mouse clicks.
  // ------------------------------------------------------------------------
  if (typeof Window_Base !== 'undefined') {
    if (typeof Window_Base.prototype.canvasToLocalX !== 'function') {
      Window_Base.prototype.canvasToLocalX = function(x) {
        return x - (this.x || 0);
      };
    }
    if (typeof Window_Base.prototype.canvasToLocalY !== 'function') {
      Window_Base.prototype.canvasToLocalY = function(y) {
        return y - (this.y || 0);
      };
    }
  }

  // ------------------------------------------------------------------------
  // Compatibility: Some builds/plugins can strip isTouchedInsideFrame off Window/Window_Selectable.
  // We polyfill it so mouse/touch handlers won't crash.
  // ------------------------------------------------------------------------
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


  const pluginName = 'MMORPG_Mail';
  const parameters = PluginManager.parameters(pluginName);
  const mmoGlobalName = parameters['mmoGlobalName'] || 'client';

  // --------------------------------------------------------------------------
  // Shared Input Guard + Text Buffer (create if missing)
  // --------------------------------------------------------------------------
  const MMO_InputGuard = window.MMO_InputGuard || (window.MMO_InputGuard = (() => {
    const saved = {};
    let depth = 0;

    function disableKeyCode(keyCode) {
      if (!(keyCode in saved)) saved[keyCode] = Input.keyMapper[keyCode];
      Input.keyMapper[keyCode] = null;
    }

    function restoreKeyCode(keyCode) {
      if (keyCode in saved) {
        Input.keyMapper[keyCode] = saved[keyCode];
        delete saved[keyCode];
      }
    }

    return {
      push() {
        depth++;
        if (depth === 1) {
          disableKeyCode(90); // Z -> ok
          disableKeyCode(32); // Space -> ok
          disableKeyCode(88); // X -> escape/cancel
        }
      },
      pop() {
        if (depth <= 0) return;
        depth--;
        if (depth === 0) {
          restoreKeyCode(90);
          restoreKeyCode(32);
          restoreKeyCode(88);
        }
      },
      depth() { return depth; }
    };
  })());

  const MMO_TextBuffer = window.MMO_TextBuffer || (window.MMO_TextBuffer = (() => {
    const state = { depth: 0, queue: [] };

    if (!window.__mmoTextBufferInstalled) {
      window.__mmoTextBufferInstalled = true;

      document.addEventListener('keydown', (e) => {
        if (!window.MMO_TextBuffer || window.MMO_TextBuffer._depth() <= 0) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        const k = e.key;


        if (k === 'Tab') {
          state.queue.push(e.shiftKey ? 'ShiftTab' : 'Tab');
          e.preventDefault();
          return;
        }
        if (k === 'Backspace' || k === 'Delete' || k === 'Enter') {
          state.queue.push(k);
          e.preventDefault();
          return;
        }

        if (k && k.length === 1) {
          state.queue.push(k);
        }
      });
    }

    return {
      begin() {
        if (state.depth === 0) state.queue.length = 0;
        state.depth++;
      },
      end() {
        if (state.depth > 0) state.depth--;
        if (state.depth === 0) state.queue.length = 0;
      },
      consume() { return state.queue.shift() || null; },
      _depth() { return state.depth; }
    };
  })());

  // --------------------------------------------------------------------------
  // MMO Helpers
  // --------------------------------------------------------------------------
  function getMMO() {
    return window[mmoGlobalName] || null;
  }

  function safeBroadcast(command, args) {
    const mmo = getMMO();
    if (!mmo) return false;

    try {
      // broadcast(loopback, code, ...args)
      if (typeof mmo.broadcast === 'function') {
        mmo.broadcast(false, command, ...(args || []));
        return true;
      }
      if (mmo.net && typeof mmo.net.broadcast === 'function') {
        mmo.net.broadcast(false, command, ...(args || []));
        return true;
      }

      // publish(loopback, group, code, ...args)
      if (typeof mmo.publish === 'function') {
        // group not required for server routing; still works if client expects it
        mmo.publish(false, 'mail', command, ...(args || []));
        return true;
      }
      if (mmo.net && typeof mmo.net.publish === 'function') {
        mmo.net.publish(false, 'mail', command, ...(args || []));
        return true;
      }
    } catch (err) {
      console.error(`[Mail] safeBroadcast failed: ${err.message}`);
      return false;
    }

    return false;
  }

  function getReactFn() {
    const mmo = getMMO();
    if (!mmo) return null;

    // Match patterns used across your other plugins
    if (mmo.net?.react) {
      return (group, event, cb) => mmo.net.react(group, event, cb);
    } else if (mmo.unsafeReact) {
      return (group, event, cb) => mmo.unsafeReact(Scene_Base, group, event, (scene, from, ...args) => cb([args[0]], from));
    } else if (mmo.react) {
      return (group, event, cb) => mmo.react(Scene_Base, group, event, (scene, from, ...args) => cb([args[0]], from));
    } else if (mmo.net?.on) {
      return (group, event, cb) => mmo.net.on(event, cb);
    } else if (mmo.on) {
      return (group, event, cb) => mmo.on(event, cb);
    }
    return null;
  }

  function chatSystem(text) {
    const chat = window.chat;
    if (!chat || typeof chat.addMessage !== 'function') return;
    chat.addMessage('[Mail]', text, 'white');
  }

  // --------------------------------------------------------------------------
  // Notification Badges (above chat)
  //   - Mail ✉  : new mail since last time Mail was opened
  //   - Social ●: new social request/invite since last time Social was opened
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Mail Manager
  // --------------------------------------------------------------------------
  class MailManager {
    constructor() {
      this.inbox = [];
      this.sent = [];
      this._full = new Map(); // key: `${box}:${id}` => message
      this._pendingReadBox = new Map(); // key: `${id}` => 'inbox'|'sent'
      this._handlers = {};
      this._setupNetworkHandlers();
    }

    on(event, cb) {
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(cb);
    }

    _emit(event, payload) {
      const list = this._handlers[event];
      if (!list) return;
      for (const cb of list) {
        try { cb(payload); } catch (_) {}
      }
    }

    _setupNetworkHandlers() {
      const reactFn = getReactFn();
      if (!reactFn) {
        setTimeout(() => this._setupNetworkHandlers(), 1000);
        return;
      }

      reactFn('mail', 'm/list/res', (args) => this._onList(args[0]));
      reactFn('mail', 'm/send/res', (args) => this._onSend(args[0]));
      reactFn('mail', 'm/read/res', (args) => this._onRead(args[0]));
      reactFn('mail', 'm/delete/res', (args) => this._onDelete(args[0]));
      reactFn('mail', 'm/clear/res', (args) => this._onClear(args[0]));
      reactFn('mail', 'mail/new', (args) => this._onNew(args[0]));
    }

    requestList() {
      safeBroadcast('m/list', []);
    }

    send(toUsername, subject, body) {
      safeBroadcast('m/send', [toUsername, subject, body]);
    }

    read(box, id) {
      const b = (box === 'sent') ? 'sent' : 'inbox';
      this._pendingReadBox.set(String(id), b);
      safeBroadcast('m/read', [b, id]);
    }

    delete(box, id) {
      safeBroadcast('m/delete', [box, id]);
    }

    clear(mode = 'mail') {
      safeBroadcast('m/clear', [mode]);
    }

    getFull(box, id) {
      return this._full.get(`${box}:${id}`) || null;
    }

    _onList(data) {
      if (!data) return;
      this.inbox = Array.isArray(data.inbox) ? data.inbox : [];
      this.sent = Array.isArray(data.sent) ? data.sent : [];
      this._emit('updated');
    }

    _onSend(data) {
      this._emit('sendResult', data);
      // Refresh lists on success
      if (data && data.success) this.requestList();
    }

    _onRead(data) {
      if (!data || !data.success || !data.message) return;
      const msg = data.message;

      const msgIdKey = String(msg.id);
      const requestedBox = this._pendingReadBox.get(msgIdKey);
      if (requestedBox) this._pendingReadBox.delete(msgIdKey);

      // Determine which box to cache under (prefer the box used in the request)
      let box = requestedBox || 'inbox';
      if (!requestedBox) {
        // fallback: infer by searching sent list (handle number/string IDs)
        const isSent = (this.sent || []).some(m => Number(m.id) === Number(msg.id));
        if (isSent) box = 'sent';
      }

      const key = `${box}:${msg.id}`;
      this._full.set(key, msg);

      // Mark read in inbox summary (requests live in inbox storage too)
      const summary = (this.inbox || []).find(m => Number(m.id) === Number(msg.id));
      if (summary) summary.read = true;

      this._emit('message', { box, message: msg });
      this._emit('updated');
    }

    _onDelete(data) {
      this._emit('deleteResult', data);
      if (data && data.success) this.requestList();
    }

    _onClear(data) {
      this._emit('clearResult', data);
      if (data && data.success) this.requestList();
    }

    _onNew(summary) {
      if (!summary) return;

      // Set the appropriate "new" badge (Mail vs Social).
      try {
        if (MMO_Notify && typeof MMO_Notify.handleMailNew === 'function') {
          MMO_Notify.handleMailNew(summary);
        }
      } catch (_) {}

      // Push into inbox list (client-side), but also request list for consistency.
      const from = summary.fromUsername || summary.from || summary.fromName || 'Unknown';
      const subj = summary.subject || '(No Subject)';
      let t = summary.type;
      const subjGuess = String(summary.subject || '');
      if (!t && /friend\s+request/i.test(subjGuess)) t = 'friend_request';
      const type = String(t || 'mail');

      if (type === 'friend_request') {
        chatSystem(`Friend request from ${from}`);
      } else {
        chatSystem(`New mail from ${from}: ${subj}`);
      }

      this.requestList();
      this._emit('new', summary);
    }
  }

  const Mail = window.MMO_Mail || (window.MMO_Mail = new MailManager());

  // --------------------------------------------------------------------------
  // Presence Manager
  // --------------------------------------------------------------------------
  class PresenceManager {
    constructor() {
      this.users = [];
      this.count = 0;
      this._handlers = {};
      this._setupNetworkHandlers();
    }

    on(event, cb) {
      if (!this._handlers[event]) this._handlers[event] = [];
      this._handlers[event].push(cb);
    }

    _emit(event, payload) {
      const list = this._handlers[event];
      if (!list) return;
      for (const cb of list) {
        try { cb(payload); } catch (_) {}
      }
    }

    _setupNetworkHandlers() {
      const reactFn = getReactFn();
      if (!reactFn) {
        setTimeout(() => this._setupNetworkHandlers(), 1000);
        return;
      }

      reactFn('users', 'u/online/res', (args) => this._onOnline(args[0]));
    }

    requestOnline() {
      safeBroadcast('u/online', []);
    }

    _onOnline(data) {
      this.users = Array.isArray(data?.users) ? data.users : [];
      this.count = Number(data?.count || this.users.length);
      this._emit('updated');
    }
  }

  const Presence = window.MMO_Presence || (window.MMO_Presence = new PresenceManager());

  // --------------------------------------------------------------------------
  // Plugin Commands
  // --------------------------------------------------------------------------
  PluginManager.registerCommand(pluginName, 'openMailbox', () => {
    SceneManager.push(Scene_Mailbox);
  });

  PluginManager.registerCommand(pluginName, 'openOnline', () => {
    SceneManager.push(Scene_OnlinePlayers);
  });

  // --------------------------------------------------------------------------
  // Utility: wrap text in a Window_Base
  // --------------------------------------------------------------------------
  function drawTextWrapped(win, text, x, y, width, maxLines = 99) {
    const lh = win.lineHeight();
    const words = String(text || '').replace(/\r/g, '').split(/\n/);
    let lineY = y;
    let lines = 0;

    for (const paragraph of words) {
      const tokens = paragraph.split(/(\s+)/);
      let line = '';

      for (const t of tokens) {
        const test = line + t;
        if (win.textWidth(test) > width && line !== '') {
          win.drawText(line, x, lineY, width);
          lineY += lh;
          lines++;
          if (lines >= maxLines) return;
          line = t.trimStart();
        } else {
          line = test;
        }
      }

      if (line !== '') {
        win.drawText(line, x, lineY, width);
        lineY += lh;
        lines++;
        if (lines >= maxLines) return;
      }
    }
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return String(ts || '');
    }
  }

  
  // Request types are shown in the "Requests" tab (not in Inbox)
  function isRequestType(type) {
    const t = String(type || 'mail');
    return (t === 'friend_request' || t === 'guild_invite');
  }

// --------------------------------------------------------------------------
  // Window: Mail List
  // --------------------------------------------------------------------------
  class Window_MailList extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._box = 'inbox';
      this._data = [];
      this.refresh();
    }

    setBox(box) {
      this._box = (box === 'sent') ? 'sent' : ((box === 'requests') ? 'requests' : 'inbox');
      this.refresh();
    }

    data() { return this._data; }
    box() { return this._box; }

    maxItems() {
      return this._data.length;
    }

    item() {
      return this._data[this.index()];
    }

    update() {
      super.update();
      this._processInactiveClick();
    }

    _processInactiveClick() {
      // Allow mouse/touch click-to-open even when the list isn't the active input window.
      // This keeps the "tab bar" focus model intact while still being usable with a mouse.
      if (this.active) return;
      if (!this.isOpen() || !this.visible) return;
      if (!TouchInput.isTriggered()) return;
      if (!this.isTouchedInsideFrame()) return;

      const x = this.canvasToLocalX(TouchInput.x);
      const y = this.canvasToLocalY(TouchInput.y);
      const hit = this.hitTest(x, y);
      if (hit >= 0) {
        this.select(hit);
        SoundManager.playOk();
        if (this.isHandled('ok')) this.callHandler('ok');
      }
    }

    refresh() {
      const inboxAll = Mail.inbox || [];
      if (this._box === 'sent') {
        this._data = Mail.sent || [];
      } else if (this._box === 'requests') {
        this._data = inboxAll.filter(m => isRequestType(m.type));
      } else {
        // inbox (non-requests)
        this._data = inboxAll.filter(m => !isRequestType(m.type));
      }
      this.createContents();
      this.contents.clear();
      this.drawAllItems();

      // Empty-state text for a better JRPG-style menu feel.
      if (this._data.length === 0) {
        const msg = (this._box === 'sent')
          ? 'No sent messages'
          : (this._box === 'requests')
            ? 'No requests'
            : 'No messages';

        this.changeTextColor(ColorManager.textColor(8));
        this.drawText(msg, 0, 0, this.innerWidth, 'center');
        this.resetTextColor();
      }
    }

    drawItem(index) {
      const item = this._data[index];
      if (!item) return;
      const rect = this.itemLineRect(index);

      const unread = (this._box !== 'sent') && !item.read;
      const mark = unread ? '*' : ' ';
      const fromOrTo = (this._box === 'sent') ? `To: ${item.toUsername}` : `From: ${item.fromUsername}`;
      const type = item.type || 'mail';
      const prefix = type === 'friend_request' ? '[Friend] ' : (type === 'guild_invite' ? '[Guild] ' : '');
      const subjRaw = item.subject || '(No Subject)';
      const subj = (prefix + subjRaw).slice(0, 32);

      this.resetTextColor();
      this.drawText(mark, rect.x, rect.y, 20);

      this.drawText(fromOrTo, rect.x + 20, rect.y, rect.width - 20);

      // Subject in the next line
      const y2 = rect.y + this.lineHeight();
      this.changeTextColor(ColorManager.textColor(1));
      this.drawText(subj, rect.x + 20, y2, rect.width - 20);

      this.resetTextColor();
    }

    itemHeight() {
      // two lines per item
      return this.lineHeight() * 2;
    }
  }

  // --------------------------------------------------------------------------
  // Window: Mail View
  // --------------------------------------------------------------------------
  class Window_MailView extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this._box = 'inbox';
      this._summary = null;
      this._message = null;
      this._clickHandler = null;
      this.refresh();
    }

    setClickHandler(fn) {
      this._clickHandler = (typeof fn === 'function') ? fn : null;
    }

    update() {
      super.update();
      this._processClick();
    }

    _processClick() {
      if (!this._clickHandler) return;
      if (!this.isOpen() || !this.visible) return;
      if (!TouchInput.isTriggered()) return;
      if (!this.isTouchedInsideFrame()) return;
      this._clickHandler();
    }


    setSelection(box, summary) {
      this._box = (box === 'sent') ? 'sent' : ((box === 'requests') ? 'requests' : 'inbox');
      this._summary = summary || null;
      this._message = null;

      if (summary) {
        const storeBox = (this._box === 'sent') ? 'sent' : 'inbox';
        const full = Mail.getFull(storeBox, summary.id);
        if (full) this._message = full;
      }

      this.refresh();
    }

    setMessage(box, message) {
      this._box = (box === 'sent') ? 'sent' : ((box === 'requests') ? 'requests' : 'inbox');
      this._message = message || null;
      this.refresh();
    }

    refresh() {
      this.contents.clear();
      const rect = this.innerRect;

      if (!this._summary) {
        // Box-specific empty state (instead of a generic prompt).
        let count = 0;
        if (this._box === 'sent') {
          count = (Mail.sent || []).length;
        } else if (this._box === 'requests') {
          count = (Mail.inbox || []).filter(m => isRequestType(m.type)).length;
        } else {
          count = (Mail.inbox || []).filter(m => !isRequestType(m.type)).length;
        }

        const msg = (count <= 0)
          ? ((this._box === 'sent') ? 'No sent messages' : (this._box === 'requests') ? 'No requests' : 'No messages')
          : ((this._box === 'requests') ? 'Select a request' : 'Select a message');

        this.changeTextColor(ColorManager.textColor(8));
        this.drawText(msg, rect.x, rect.y, rect.width, 'center');
        this.resetTextColor();
        return;
      }

      const summary = this._summary;
      const from = summary.fromUsername || '';
      const to = summary.toUsername || '';
      const subj = summary.subject || '(No Subject)';
      const time = formatTime(summary.timestamp);

      let y = rect.y;

      this.changeTextColor(ColorManager.systemColor());
      this.drawText('Subject:', rect.x, y, 120);
      this.resetTextColor();
      this.drawText(subj, rect.x + 120, y, rect.width - 120);
      y += this.lineHeight();

      const type = summary.type || 'mail';
      if (type && type !== 'mail') {
        const typeLabel = type === 'friend_request' ? 'Friend Request' : (type === 'guild_invite' ? 'Guild Invite' : type);
        this.changeTextColor(ColorManager.systemColor());
        this.drawText('Type:', rect.x, y, 120);
        this.resetTextColor();
        this.drawText(typeLabel, rect.x + 120, y, rect.width - 120);
        y += this.lineHeight();
      }

      this.changeTextColor(ColorManager.systemColor());
      this.drawText('From:', rect.x, y, 120);
      this.resetTextColor();
      this.drawText(from, rect.x + 120, y, rect.width - 120);
      y += this.lineHeight();

      this.changeTextColor(ColorManager.systemColor());
      this.drawText('To:', rect.x, y, 120);
      this.resetTextColor();
      this.drawText(to, rect.x + 120, y, rect.width - 120);
      y += this.lineHeight();

      this.changeTextColor(ColorManager.systemColor());
      this.drawText('Time:', rect.x, y, 120);
      this.resetTextColor();
      this.drawText(time, rect.x + 120, y, rect.width - 120);
      y += this.lineHeight();

      y += 8;

      const body = this._message ? this._message.body : null;
      if (!body) {
        this.changeTextColor(ColorManager.textColor(8));
        this.drawText('Press OK to load message body', rect.x, y, rect.width, 'center');
        this.resetTextColor();
        return;
      }

      drawTextWrapped(this, body, rect.x, y, rect.width, 99);
    }
  }

  // --------------------------------------------------------------------------
  // Window: Mail Command (horizontal)
  // --------------------------------------------------------------------------
  class Window_MailCommand extends Window_HorzCommand {
    initialize(rect) {
      this._box = 'inbox';
      this._summary = null;
      super.initialize(rect);
    }

    setContext(box, summary) {
      // Preserve current cursor position; refresh() can reset selection in some builds.
      const prevSymbol = (typeof this.currentSymbol === 'function') ? this.currentSymbol() : null;

      this._box = (box === 'sent') ? 'sent' : ((box === 'requests') ? 'requests' : 'inbox');
      this._summary = summary || null;

      this.refresh();

      if (prevSymbol && typeof this.selectSymbol === 'function') {
        this.selectSymbol(prevSymbol);
      }
    }

    _isActionable() {
      const s = this._summary;
      if (!s) return false;
      if (this._box !== 'inbox') return false;
      const t = s.type || 'mail';
      return (t === 'friend_request' || t === 'guild_invite');
    }

    makeCommandList() {
      this.addCommand('Inbox', 'inbox');
      this.addCommand('Sent', 'sent');
      this.addCommand('Compose', 'compose');
      this.addCommand('Refresh', 'refresh');
      this.addCommand('Close', 'close');
    }

    maxCols() {
      return 5;
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
}

  
  // --------------------------------------------------------------------------
  // Window: Request Actions (Accept / Decline)
  // --------------------------------------------------------------------------
  class Window_RequestActions extends Window_Command {
    initialize(rect) {
      this._summary = null;
      super.initialize(rect);
    }

    setSummary(summary) {
      this._summary = summary || null;
      this.refresh();
    }

    makeCommandList() {
      const enabled = !!this._summary;
      this.addCommand('Accept', 'accept', enabled);
      this.addCommand('Decline', 'decline', enabled);
      this.addCommand('Back', 'back', true);
    }

    maxCols() { return 1; }
  }

// --------------------------------------------------------------------------
// Window: Actions submenu (Reply / Delete / Delete All Emails)
// --------------------------------------------------------------------------
class Window_MailActions extends Window_Command {
  initialize(rect) {
    this._box = 'inbox';
    this._summary = null;
    super.initialize(rect);
  }

  setContext(box, summary) {
    this._box = (box === 'sent') ? 'sent' : ((box === 'requests') ? 'requests' : 'inbox');
    this._summary = summary || null;
    this.refresh();
  }

  makeCommandList() {
    const s = this._summary;
    const box = this._box;
    const type = s ? (s.type || 'mail') : 'mail';
    const isReq = (type === 'friend_request' || type === 'guild_invite');

    const isServer = !!s && String(s.fromUsername || '').toLowerCase() === 'server';

    const canReply = !!s && box === 'inbox' && type === 'mail' && !isServer;
    const canDelete = !!s && (box === 'inbox' || box === 'sent') && !isReq;

    this.addCommand('Reply', 'reply', canReply);
    this.addCommand('Delete', 'delete', canDelete);
    this.addCommand('Delete All Emails', 'deleteAll', true);
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
    SoundManager.playCancel();
    if (this.isHandled('cancel')) this.callHandler('cancel');
  }
}

// --------------------------------------------------------------------------
// Window: Confirmation (Yes/No) with header text
// --------------------------------------------------------------------------
class Window_MailConfirm extends Window_Command {
  initialize(rect) {
    this._text = 'Are you sure?';
    super.initialize(rect);
  }

  setText(text) {
    this._text = String(text || 'Are you sure?');
    this.refresh();
  }

  makeCommandList() {
    this.addCommand('No', 'no');
    this.addCommand('Yes', 'yes');
  }

  // Leave one line at the top for the prompt text
  itemRect(index) {
    const r = super.itemRect(index);
    r.y += this.lineHeight();
    return r;
  }

  drawAllItems() {
    this.contents.clear();
    this.changeTextColor(ColorManager.systemColor());
    this.drawText(this._text, 0, 0, this.innerWidth, 'center');
    this.resetTextColor();
    for (let i = 0; i < this.maxItems(); i++) this.drawItem(i);
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
    SoundManager.playCancel();
    if (this.isHandled('cancel')) this.callHandler('cancel');
  }
}

// --------------------------------------------------------------------------
  // Scene: Mailbox
  // --------------------------------------------------------------------------
  class Scene_Mailbox extends Scene_MenuBase {
    create() {
      super.create();

      // Opening Mail clears the "new mail" badge until another new message arrives.
      try {
        const N = window.MMO_Notify;
        if (N && typeof N.clearMail === 'function') N.clearMail();
      } catch (_) {}

      const cmdH = this.calcWindowHeight(1, true);
      const margin = 12;
      const listW = 320;

      const listRect = new Rectangle(margin, margin, listW, Graphics.boxHeight - cmdH - margin * 3);
      const viewRect = new Rectangle(margin + listW + margin, margin, Graphics.boxWidth - (listW + margin * 3), Graphics.boxHeight - cmdH - margin * 3);
      const cmdRect = new Rectangle(margin, Graphics.boxHeight - cmdH - margin, Graphics.boxWidth - margin * 2, cmdH);

      this._listWindow = new Window_MailList(listRect);
      this._listWindow.setHandler('ok', this.onListOk.bind(this));
      this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
      // Start on the tab bar; list is preview-only until a tab is "pressed" with OK.
      this._listWindow.select(-1);
      this._listWindow.deactivate();
      this.addWindow(this._listWindow);

      this._viewWindow = new Window_MailView(viewRect);
      this._viewWindow.setClickHandler(this.onViewClicked.bind(this));
      this._viewWindow.deactivate();
      this.addWindow(this._viewWindow);

      this._cmdWindow = new Window_MailCommand(cmdRect);
      // Tabs (OK = enter that box / activate list)
      this._cmdWindow.setHandler('inbox', () => this.tryEnterBox('inbox'));
      this._cmdWindow.setHandler('sent', () => this.tryEnterBox('sent'));

      this._cmdWindow.setHandler('compose', this.onCompose.bind(this));
      this._cmdWindow.setHandler('refresh', this.onRefresh.bind(this));
      this._cmdWindow.setHandler('close', this.popScene.bind(this));
      // Base cancel backs out of the mailbox (classic JRPG behavior)
      this._cmdWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._cmdWindow);

      // Requests popup (Accept/Decline)
      const reqW = 240;
      const reqH = this.calcWindowHeight(3, true);
      const reqX = Math.floor((Graphics.boxWidth - reqW) / 2);
      const reqY = Math.floor((Graphics.boxHeight - reqH) / 2);
      const reqRect = new Rectangle(reqX, reqY, reqW, reqH);
      this._requestWindow = new Window_RequestActions(reqRect);
      this._requestWindow.setHandler('accept', this.onRequestAccept.bind(this));
      this._requestWindow.setHandler('decline', this.onRequestDecline.bind(this));
      this._requestWindow.setHandler('back', this.onRequestBack.bind(this));
      this._requestWindow.setHandler('cancel', this.onRequestBack.bind(this));
this._requestWindow.hide();
this._requestWindow.deactivate();
this.addWindow(this._requestWindow);

// Actions submenu (Reply / Delete / Delete All Emails)
const actW = 280;
const actH = this.calcWindowHeight(3, true);
const actX = Math.floor((Graphics.boxWidth - actW) / 2);
const actY = Math.floor(Graphics.boxHeight - cmdH - margin * 2 - actH);
const actRect = new Rectangle(actX, actY, actW, actH);
this._actionsWindow = new Window_MailActions(actRect);
this._actionsWindow.setHandler('reply', this.onActionReply.bind(this));
this._actionsWindow.setHandler('delete', this.onActionDelete.bind(this));
this._actionsWindow.setHandler('deleteAll', this.onActionDeleteAll.bind(this));
this._actionsWindow.setHandler('cancel', this.closeActions.bind(this));
this._actionsWindow.hide();
this._actionsWindow.deactivate();
this.addWindow(this._actionsWindow);

// Confirmation window (Yes/No)
const confW = 320;
const confH = this.calcWindowHeight(3, true);
const confX = Math.floor((Graphics.boxWidth - confW) / 2);
const confY = Math.floor((Graphics.boxHeight - confH) / 2);
const confRect = new Rectangle(confX, confY, confW, confH);
this._confirmWindow = new Window_MailConfirm(confRect);
this._confirmWindow.setHandler('yes', this.onConfirmYes.bind(this));
this._confirmWindow.setHandler('no', this.onConfirmNo.bind(this));
this._confirmWindow.setHandler('cancel', this.onConfirmNo.bind(this));
this._confirmWindow.hide();
this._confirmWindow.deactivate();
this.addWindow(this._confirmWindow);

this._confirmYesCb = null;
this._confirmNoCb = null;

// Remember last selected message per box (so switching tabs doesn't jump around)
this._savedIndexByBox = { inbox: -1, requests: -1, sent: -1 };

      // Initialize preview (Inbox) without entering the list yet.
      this._lastCmdSymbol = null;
      this._postReadKey = null; // enables "View -> Cancel -> Actions" flow
      this.setBox('inbox', false);

      // Put the blinking cursor on the tab bar (Inbox) but do not "enter" the list until OK is pressed.
      if (this._cmdWindow.selectSymbol) this._cmdWindow.selectSymbol('inbox');
      this._cmdWindow.activate();

      // Initialize command context based on the current selection
      this._cmdWindow.setContext(this._listWindow.box(), this._listWindow.item());

      Mail.on('updated', () => {
        if (!this._listWindow) return;

        const box = this._listWindow.box();
        const wasActive = this._listWindow.active;
        const prevIdx = this._listWindow.index();

        this._listWindow.refresh();

        // Clamp saved index for this box to the new list size
        if (this._savedIndexByBox) {
          const max = this._listWindow.maxItems();
          let saved = this._savedIndexByBox[box];
          if (saved >= max) saved = max - 1;
          if (saved < -1) saved = -1;
          this._savedIndexByBox[box] = saved;
        }

        if (wasActive) {
          // Keep current selection (or select first item if it was -1 and there are items)
          const max = this._listWindow.maxItems();
          let idx = prevIdx;
          if (idx < 0 && max > 0) idx = 0;
          if (idx >= max) idx = max - 1;
          this._listWindow.select(max > 0 ? idx : -1);
        }

        this.updateViewFromSelection();
      });

      Mail.on('message', ({ box, message }) => {
        if (!this._listWindow) return;

        const currentBox = this._listWindow.box();
        const logicalMatch = (currentBox === box) || (currentBox === 'requests' && box === 'inbox');

        if (logicalMatch && this._listWindow.item() && this._listWindow.item().id === message.id) {
          this._viewWindow.setMessage(currentBox, message);
        }
      });

      Mail.requestList();
    }

    start() {
      super.start();
      // Refresh mail lists on entry (safe even if already current)
      Mail.requestList();
    }

    update() {
      super.update();
      if (!this._listWindow || !this._cmdWindow) return;

      // Read mode: view window is active (Cancel returns to list; OK opens Actions)
      if (this._viewWindow && this._viewWindow.active) {
        const popupVisible =
          (this._requestWindow && this._requestWindow.visible) ||
          (this._actionsWindow && this._actionsWindow.visible) ||
          (this._confirmWindow && this._confirmWindow.visible);

        if (!popupVisible) {
          if (Input.isTriggered('cancel')) {
            this.exitReadMode();
            return;
          }
          if (Input.isTriggered('ok')) {
            const summary = this._listWindow.item();
            const box = this._listWindow.box();
            if (summary && !(box === 'requests' && isRequestType(summary.type))) {
              this._postReadKey = null;
              this.openActions();
              return;
            }
          }
        }
      }

      // While the tab bar is active, moving the cursor should PREVIEW the box
      // without "pressing" it (OK is what enters the list).
      if (this._cmdWindow.active) {
        const sym = (typeof this._cmdWindow.currentSymbol === 'function') ? this._cmdWindow.currentSymbol() : null;
        if (sym && sym !== this._lastCmdSymbol) {
          this._lastCmdSymbol = sym;
          if (sym === 'inbox' || sym === 'requests' || sym === 'sent') {
            this.setBox(sym, false);
          }
        }
      }

      const summary = this._listWindow.item();
      const box = this._listWindow.box();
      const key = summary ? `${box}:${summary.id}` : `${box}:none`;

      if (this._lastSelectionKey !== key) {
        this._lastSelectionKey = key;
        // Changing selection resets the "second OK opens Actions" latch.
        this._postReadKey = null;
        this.updateViewFromSelection();
        this._cmdWindow.setContext(box, summary);
      }
    }



    tryEnterBox(box) {
      // If the selected box is empty, play a buzzer and keep focus on the tab bar.
      this.setBox(box, false);

      const max = this._listWindow ? this._listWindow.maxItems() : 0;
      if (max <= 0) {
        SoundManager.playBuzzer();
        if (this._listWindow) this._listWindow.deactivate();
        if (this._cmdWindow) this._cmdWindow.activate();
        return;
      }

      this.setBox(box, true);
    }

    setBox(box, activateList = false) {
      if (!this._listWindow) return;

      // Save current list selection for the current box, but only when the list is the active input window.
      if (this._savedIndexByBox && this._listWindow.active) {
        const curBox = this._listWindow.box();
        this._savedIndexByBox[curBox] = this._listWindow.index();
      }

      this._listWindow.setBox(box);

      this._postReadKey = null;
      if (this._viewWindow) this._viewWindow.deactivate();

      const newBox = this._listWindow.box();
      const max = this._listWindow.maxItems();

      let restoreIdx = this._savedIndexByBox ? (this._savedIndexByBox[newBox] ?? -1) : -1;
      if (restoreIdx >= max) restoreIdx = max - 1;

      if (activateList) {
        // Enter the list: if nothing was selected yet, default to the first item.
        if (restoreIdx < 0 && max > 0) restoreIdx = 0;
        this._listWindow.select(max > 0 ? restoreIdx : -1);
        if (this._cmdWindow) this._cmdWindow.deactivate();
        this._listWindow.activate();
      } else {
        // Preview mode: show the list but do not take focus.
        this._listWindow.select((restoreIdx >= 0 && max > 0) ? restoreIdx : -1);
        this._listWindow.deactivate();
      }

      this.updateViewFromSelection();
    }

    updateViewFromSelection() {
      const summary = this._listWindow.item();
      this._viewWindow.setSelection(this._listWindow.box(), summary);
    }

    onViewClicked() {
      // Ignore clicks while a submenu is up
      if ((this._requestWindow && this._requestWindow.visible) ||
          (this._actionsWindow && this._actionsWindow.visible) ||
          (this._confirmWindow && this._confirmWindow.visible)) {
        return;
      }

      const summary = this._listWindow?.item?.();
      if (!summary) return;

      const box = this._listWindow.box();
      if (box === 'requests' && isRequestType(summary.type)) return;

      const storeBox = (box === 'sent') ? 'sent' : 'inbox';

      this._postReadKey = null;
      this.enterReadMode();
      Mail.read(storeBox, summary.id);
    }

    enterReadMode() {
      if (this._cmdWindow) this._cmdWindow.deactivate();
      if (this._listWindow) this._listWindow.deactivate();
      if (this._viewWindow) this._viewWindow.activate();
    }

    exitReadMode() {
      const summary = this._listWindow?.item?.();
      const box = this._listWindow?.box?.() || 'inbox';
      const storeBox = (box === 'sent') ? 'sent' : 'inbox';
      const key = summary ? `${storeBox}:${summary.id}` : null;

      if (this._viewWindow) this._viewWindow.deactivate();

      // After backing out of reading, a second OK on the same message opens Actions.
      this._postReadKey = key;

      if (this._listWindow) this._listWindow.activate();
    }

    onListOk() {
      const summary = this._listWindow.item();
      if (!summary) {
        SoundManager.playBuzzer();
        this._listWindow.activate();
        return;
      }

      const box = this._listWindow.box();
      const storeBox = (box === 'sent') ? 'sent' : 'inbox';

      // Requests: show Accept/Decline popup (no read mode)
      if (box === 'requests' && isRequestType(summary.type)) {
        Mail.read(storeBox, summary.id);
        this.openRequestActions(summary);
        return;
      }

      const key = `${storeBox}:${summary.id}`;
      const full = Mail.getFull(storeBox, summary.id);

      // If we just backed out of reading this exact mail, a second OK opens the actions menu.
      if (full && this._postReadKey === key) {
        Mail.read(storeBox, summary.id);
        this._postReadKey = null;
        this.openActions();
        return;
      }

      // Otherwise: enter "read mode" so the player can read first (Cancel returns to list).
      this._postReadKey = null;
      this.enterReadMode();
      Mail.read(storeBox, summary.id);
    }

    onListCancel() {
      // From list -> command menu
      if (this._requestWindow && this._requestWindow.visible) {
        this.closeRequestActions();
        return;
      }

      // Save selection for this box so it can be restored later
      if (this._savedIndexByBox) {
        this._savedIndexByBox[this._listWindow.box()] = this._listWindow.index();
      }

      this._postReadKey = null;
      if (this._viewWindow) this._viewWindow.deactivate();

      this._listWindow.deactivate();
      this._cmdWindow.activate();

      // Highlight the current box in the command bar
      if (this._cmdWindow.selectSymbol) {
        this._cmdWindow.selectSymbol(this._listWindow.box());
      }
    }

    openRequestActions(summary) {
      if (!this._requestWindow) return;
      this._requestSummary = summary;

      // Keep list selection but move input focus to popup
      this._listWindow.deactivate();

      this._requestWindow.setSummary(summary);
      this._requestWindow.show();
      this._requestWindow.activate();
      this._requestWindow.select(0);
    }

    closeRequestActions() {
      if (!this._requestWindow) return;
      this._requestSummary = null;
      this._requestWindow.deactivate();
      this._requestWindow.hide();
      this._listWindow.activate();
    }

    onRequestAccept() {
      const summary = this._requestSummary;
      if (!summary || !isRequestType(summary.type)) {
        SoundManager.playBuzzer();
        return;
      }

      if (summary.type === 'friend_request') {
        safeBroadcast('f/accept', [summary.id]);
      } else if (summary.type === 'guild_invite') {
        const charName = ($gameParty && $gameParty.leader && $gameParty.leader())
          ? $gameParty.leader().name()
          : (($gameActors && $gameActors.actor) ? $gameActors.actor(1).name() : '');
        safeBroadcast('g/acceptMail', [summary.id, String(charName || '')]);
      }

      this.closeRequestActions();
      setTimeout(() => Mail.requestList(), 150);
    }

    onRequestDecline() {
      const summary = this._requestSummary;
      if (!summary || !isRequestType(summary.type)) {
        SoundManager.playBuzzer();
        return;
      }

      if (summary.type === 'friend_request') {
        safeBroadcast('f/decline', [summary.id]);
      } else if (summary.type === 'guild_invite') {
        const charName = ($gameParty && $gameParty.leader && $gameParty.leader())
          ? $gameParty.leader().name()
          : (($gameActors && $gameActors.actor) ? $gameActors.actor(1).name() : '');
        safeBroadcast('g/declineMail', [summary.id, String(charName || '')]);
      }

      this.closeRequestActions();
      setTimeout(() => Mail.requestList(), 150);
    }

    onRequestBack() {
      this.closeRequestActions();
    }

openActions() {
  if (!this._actionsWindow) return;

  // If a request popup is up, close it first.
  if (this._requestWindow && this._requestWindow.visible) {
    this.closeRequestActions();
  }

  this._actionsWindow.setContext(this._listWindow.box(), this._listWindow.item());
  this._actionsWindow.show();
  this._actionsWindow.activate();
  this._actionsWindow.select(0);

  this._postReadKey = null;
  if (this._viewWindow) this._viewWindow.deactivate();

  if (this._cmdWindow) this._cmdWindow.deactivate();
  if (this._listWindow) this._listWindow.deactivate();
}

closeActions() {
  if (!this._actionsWindow) return;
  this._actionsWindow.deactivate();
  this._actionsWindow.hide();

  if (this._confirmWindow) {
    this._confirmWindow.deactivate();
    this._confirmWindow.hide();
  }

  // Return to the mail list (classic JRPG feel) after closing the context menu.
  if (this._listWindow) this._listWindow.activate();
  else if (this._cmdWindow) this._cmdWindow.activate();
}

_openConfirm(text, onYes = null, onNo = null) {
  if (!this._confirmWindow) return;

  this._confirmYesCb = (typeof onYes === 'function') ? onYes : null;
  this._confirmNoCb = (typeof onNo === 'function') ? onNo : null;

  this._confirmWindow.setText(text);
  this._confirmWindow.show();
  this._confirmWindow.activate();
  // Default to "No"
  this._confirmWindow.select(0);

  if (this._actionsWindow) this._actionsWindow.deactivate();
  this._postReadKey = null;
  if (this._viewWindow) this._viewWindow.deactivate();

  if (this._cmdWindow) this._cmdWindow.deactivate();
  if (this._listWindow) this._listWindow.deactivate();
}

_closeConfirm() {
  if (!this._confirmWindow) return;
  this._confirmWindow.deactivate();
  this._confirmWindow.hide();
  this._confirmYesCb = null;
  this._confirmNoCb = null;
}

onConfirmYes() {
  const cb = this._confirmYesCb;
  this._closeConfirm();
  if (typeof cb === 'function') cb();
  // After confirming an action, return to the command bar.
  this.closeActions();
}

onConfirmNo() {
  const cb = this._confirmNoCb;
  this._closeConfirm();
  if (typeof cb === 'function') cb();

  // Back to the actions submenu if it's still open, otherwise the command bar.
  if (this._actionsWindow && this._actionsWindow.visible) {
    this._actionsWindow.activate();
  } else if (this._cmdWindow) {
    this._cmdWindow.activate();
  }
}

onActionReply() {
  const summary = this._listWindow.item();
  const box = this._listWindow.box();
  if (!summary || box !== 'inbox' || isRequestType(summary.type)) {
    SoundManager.playBuzzer();
    if (this._actionsWindow) this._actionsWindow.activate();
    return;
  }

  const to = String(summary.fromUsername || '').trim();
  if (!to) {
    SoundManager.playBuzzer();
    if (this._actionsWindow) this._actionsWindow.activate();
    return;
  }

  const rawSubj = String(summary.subject || '').trim() || '(No Subject)';
  const subject = (/^re:/i.test(rawSubj)) ? rawSubj : `Re: ${rawSubj}`;

  Scene_MailCompose.prepare({ to, subject, body: '' });

  this.closeActions();
  SceneManager.push(Scene_MailCompose);
}

onActionDelete() {
  const summary = this._listWindow.item();
  const box = this._listWindow.box();
  if (!summary || box === 'requests' || isRequestType(summary.type)) {
    SoundManager.playBuzzer();
    if (this._actionsWindow) this._actionsWindow.activate();
    return;
  }

  const storeBox = (box === 'sent') ? 'sent' : 'inbox';
  this._openConfirm('Delete this message?', () => {
    Mail.delete(storeBox, summary.id);
  });
}

onActionDeleteAll() {
  // This deletes ALL *emails* (inbox non-requests + all sent).
  this._openConfirm('Delete ALL emails? (Inbox + Sent)', () => {
    if (Mail && typeof Mail.clear === 'function') {
      Mail.clear('mail');
    } else {
      SoundManager.playBuzzer();
    }
  });
}

    onCompose() {
      // Keep this scene usable when we come back (Window_Command deactivates itself on OK)
      if (this._cmdWindow) this._cmdWindow.activate();
      SceneManager.push(Scene_MailCompose);
    }

    onDelete() {
      const summary = this._listWindow.item();
      if (!summary) {
        SoundManager.playBuzzer();
        if (this._cmdWindow) this._cmdWindow.activate();
        return;
      }
      const box = (this._listWindow.box() === 'sent') ? 'sent' : 'inbox';
      Mail.delete(box, summary.id);
      if (this._cmdWindow) this._cmdWindow.activate();
    }

    onRefresh() {
      Mail.requestList();
      if (this._cmdWindow) this._cmdWindow.activate();
    }

    onAccept() {
      const summary = this._listWindow?.item?.();
      const box = this._listWindow?.box?.();
      const type = summary?.type || 'mail';

      if (!summary || box !== 'inbox' || (type !== 'friend_request' && type !== 'guild_invite')) {
        SoundManager.playBuzzer();
        return;
      }

      if (type === 'friend_request') {
        safeBroadcast('f/accept', [summary.id]);
      } else if (type === 'guild_invite') {
        const charName = ($gameParty && $gameParty.leader && $gameParty.leader()) ? $gameParty.leader().name() : ($gameActors && $gameActors.actor ? $gameActors.actor(1).name() : '');
        safeBroadcast('g/acceptMail', [summary.id, charName]);
      }

      setTimeout(() => Mail.requestList(), 150);
    }

    onDecline() {
      const summary = this._listWindow?.item?.();
      const box = this._listWindow?.box?.();
      const type = summary?.type || 'mail';

      if (!summary || box !== 'inbox' || (type !== 'friend_request' && type !== 'guild_invite')) {
        SoundManager.playBuzzer();
        return;
      }

      if (type === 'friend_request') {
        safeBroadcast('f/decline', [summary.id]);
      } else if (type === 'guild_invite') {
        const charName = ($gameParty && $gameParty.leader && $gameParty.leader()) ? $gameParty.leader().name() : ($gameActors && $gameActors.actor ? $gameActors.actor(1).name() : '');
        safeBroadcast('g/declineMail', [summary.id, charName]);
      }

      setTimeout(() => Mail.requestList(), 150);
    }

    onSocial() {
      if (window.Scene_Social) {
        // Keep this scene usable when we come back (Window_Command deactivates itself on OK)
        if (this._cmdWindow) this._cmdWindow.activate();
        SceneManager.push(window.Scene_Social);
      } else {
        SoundManager.playBuzzer();
        chatSystem('Social menu plugin not installed.');
        if (this._cmdWindow) this._cmdWindow.activate();
      }
    }
  }

// --------------------------------------------------------------------------
  // Window: Single-line Text Input (mail compose)
  // --------------------------------------------------------------------------
  class Window_MMOTextInput extends Window_Selectable {
    initialize(rect, options = {}) {
      this._label = options.label || 'Text';
      this._maxLength = options.maxLength || 24;
      this._minLength = options.minLength || 0;
      this._allowSpaces = options.allowSpaces !== false;
      this._text = String(options.defaultText || '');
      this._cursorVisible = true;
      this._cursorCount = 0;
      this._guardEnabled = false;

      super.initialize(rect);
      this.refresh();
    }

    text() { return this._text; }

    setText(t) {
      this._text = String(t || '');
      this.refresh();
    }

    isValid() {
      const len = this._text.trim().length;
      return len >= this._minLength && this._text.length <= this._maxLength;
    }

    maxItems() { return 1; }

    activate() {
      super.activate();
      if (!this._guardEnabled) {
        this._guardEnabled = true;
        MMO_InputGuard.push();
        MMO_TextBuffer.begin();
      }
      return this;
    }

    deactivate() {
      if (this._guardEnabled) {
        this._guardEnabled = false;
        MMO_TextBuffer.end();
        MMO_InputGuard.pop();
      }
      super.deactivate();
      return this;
    }

    hide() {
      // safety: ensure guard is released
      if (this._guardEnabled) {
        this._guardEnabled = false;
        MMO_TextBuffer.end();
        MMO_InputGuard.pop();
      }
      super.hide();
      return this;
    }

    update() {
      super.update();
      if (this.active) {
        this.processKeyboardInput();
        this._cursorCount++;
        if (this._cursorCount >= 30) {
          this._cursorCount = 0;
          this._cursorVisible = !this._cursorVisible;
          this.refresh();
        }
      }
    }

    processKeyboardInput() {
      const key = MMO_TextBuffer.consume();
      if (!key) return;


      if (key === 'Tab') {
        if (this.isHandled('tab')) {
          SoundManager.playCursor();
          this.callHandler('tab');
        }
        return;
      }
      if (key === 'ShiftTab') {
        if (this.isHandled('shiftTab')) {
          SoundManager.playCursor();
          this.callHandler('shiftTab');
        } else if (this.isHandled('tab')) {
          SoundManager.playCursor();
          this.callHandler('tab');
        }
        return;
      }
      if (key === 'Backspace' || key === 'Delete') {
        if (this._text.length > 0) {
          this._text = this._text.slice(0, -1);
          SoundManager.playCancel();
          this.refresh();
        }
        return;
      }

      // Enter is handled by OK action (and should move to next field)
      if (key === 'Enter') return;

      if (key.length === 1) {
        const ch = key;

        if (!this._allowSpaces && ch === ' ') return;
        if (this._text.length >= this._maxLength) return;

        // Accept most printable characters
        if (ch >= ' ' && ch <= '~') {
          this._text += ch;
          SoundManager.playCursor();
          this.refresh();
        }
      }
    }

    drawItem(index) {
      const rect = this.itemLineRect(index);
      this.contents.clear();

      const display = this._text + (this._cursorVisible && this.active ? '|' : '');
      const labelText = this._label + ': ';

      const labelW = Math.min(160, this.textWidth(labelText) + 8);
      const inputX = rect.x + labelW + 4;
      const inputW = rect.width - labelW - 4;

      this.changeTextColor(ColorManager.systemColor());
      this.drawText(labelText, rect.x, rect.y, labelW);

      this.resetTextColor();
      this.drawText(display, inputX, rect.y, inputW);

      const countText = `${this._text.length}/${this._maxLength}`;
      const countColor = this.isValid() ? ColorManager.textColor(3) : ColorManager.textColor(18);
      this.changeTextColor(countColor);
      this.drawText(countText, rect.x, rect.y, rect.width, 'right');
      this.resetTextColor();
    }

    refresh() {
      this.drawItem(0);
    }

    processOk() {
      if (this.isValid()) {
        SoundManager.playOk();
        this.callHandler('ok');
      } else {
        SoundManager.playBuzzer();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Window: Compose Command
  // --------------------------------------------------------------------------
  class Window_MailComposeCommand extends Window_HorzCommand {
    initialize(rect) {
      this._sending = false;
      super.initialize(rect);
    }

    setSending(sending) {
      this._sending = !!sending;
      this.refresh();
    }

    makeCommandList() {
      this.addCommand('Send', 'send', !this._sending);
      this.addCommand('Cancel', 'cancel');
    }

    maxCols() { return 2; }
  }

  // --------------------------------------------------------------------------
  // Scene: Compose Mail
  // --------------------------------------------------------------------------
  class Scene_MailCompose extends Scene_MenuBase {
    static prepare(options) {
      Scene_MailCompose._nextOptions = options || null;
    }

    create() {
      super.create();

      // Opening Mail clears the "new mail" badge until another new message arrives.
      try {
        const N = window.MMO_Notify;
        if (N && typeof N.clearMail === 'function') N.clearMail();
      } catch (_) {}

      this._options = Scene_MailCompose._nextOptions || {};
      Scene_MailCompose._nextOptions = null;

      // Safety: if any previous MMO text input window failed to release the shared guard/buffer,
      // reset here so Z/X/Space presses from other menus do NOT dump into these fields.
      try {
        if (MMO_TextBuffer && typeof MMO_TextBuffer._depth === 'function') {
          while (MMO_TextBuffer._depth() > 0) MMO_TextBuffer.end();
        }
        if (MMO_InputGuard && typeof MMO_InputGuard.depth === 'function') {
          while (MMO_InputGuard.depth() > 0) MMO_InputGuard.pop();
        }
      } catch (_) {}

      if (Input && typeof Input.clear === 'function') Input.clear();
      if (TouchInput && typeof TouchInput.clear === 'function') TouchInput.clear();


      const margin = 12;
      const ww = Graphics.boxWidth - margin * 2;

      const toH = this.calcWindowHeight(1, true);
      const subjH = this.calcWindowHeight(1, true);
      const bodyH = this.calcWindowHeight(4, true);
      const cmdH = this.calcWindowHeight(1, true);

      const toRect = new Rectangle(margin, margin, ww, toH);
      const subjRect = new Rectangle(margin, margin + toH + margin, ww, subjH);
      const bodyRect = new Rectangle(margin, margin + toH + margin + subjH + margin, ww, bodyH);
      const cmdRect = new Rectangle(margin, Graphics.boxHeight - cmdH - margin, ww, cmdH);

      this._toWindow = new Window_MMOTextInput(toRect, { label: 'To', maxLength: 24, minLength: 1, allowSpaces: false });
      this._subjectWindow = new Window_MMOTextInput(subjRect, { label: 'Subject', maxLength: 40, minLength: 0, allowSpaces: true });
      this._bodyWindow = new Window_MMOTextInput(bodyRect, { label: 'Body', maxLength: 1000, minLength: 1, allowSpaces: true });

      // Optional prefill (e.g., Reply)
      try {
        if (this._options) {
          if (this._options.to) this._toWindow.setText(this._options.to);
          if (this._options.subject) this._subjectWindow.setText(this._options.subject);
          if (this._options.body) this._bodyWindow.setText(this._options.body);
        }
      } catch (_) {}

      this._toWindow.setHandler('ok', () => this._activateWindow(this._subjectWindow));
      this._subjectWindow.setHandler('ok', () => this._activateWindow(this._bodyWindow));
      this._bodyWindow.setHandler('ok', () => this._activateCommand());

      // Tab navigation
      this._toWindow.setHandler('tab', () => this._activateWindow(this._subjectWindow));
      this._subjectWindow.setHandler('tab', () => this._activateWindow(this._bodyWindow));
      this._bodyWindow.setHandler('tab', () => this._activateCommand());

      this._toWindow.setHandler('shiftTab', () => this._activateCommand());
      this._subjectWindow.setHandler('shiftTab', () => this._activateWindow(this._toWindow));
      this._bodyWindow.setHandler('shiftTab', () => this._activateWindow(this._subjectWindow));

      this._toWindow.setHandler('cancel', this.popScene.bind(this));
      this._subjectWindow.setHandler('cancel', () => this._activateWindow(this._toWindow));
      this._bodyWindow.setHandler('cancel', () => this._activateWindow(this._subjectWindow));

      this.addWindow(this._toWindow);
      this.addWindow(this._subjectWindow);
      this.addWindow(this._bodyWindow);

      this._cmdWindow = new Window_MailComposeCommand(cmdRect);
      this._cmdWindow.setHandler('send', this.onSend.bind(this));
      this._cmdWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._cmdWindow);

      this._activateWindow(this._toWindow);

      Mail.on('sendResult', (res) => {
        // Ignore stale listeners from previous instances
        if (SceneManager._scene !== this) return;

        if (this._cmdWindow && typeof this._cmdWindow.setSending === 'function') {
          this._cmdWindow.setSending(false);
        }

        if (res && res.success) {
          SoundManager.playOk();
          this.popScene();
        } else {
          SoundManager.playBuzzer();
          const msg = res?.error || 'Send failed.';
          chatSystem(msg);
          this._activateWindow(this._toWindow);
        }
      });
    }

    terminate() {
      super.terminate();

      // Ensure guard/buffer are released even if the scene closes while an input window is active.
      try {
        if (MMO_TextBuffer && typeof MMO_TextBuffer._depth === 'function') {
          while (MMO_TextBuffer._depth() > 0) MMO_TextBuffer.end();
        }
        if (MMO_InputGuard && typeof MMO_InputGuard.depth === 'function') {
          while (MMO_InputGuard.depth() > 0) MMO_InputGuard.pop();
        }
      } catch (_) {}
    }


    _activateWindow(win) {
      this._cmdWindow.deactivate();
      this._toWindow.deactivate();
      this._subjectWindow.deactivate();
      this._bodyWindow.deactivate();

      win.activate();
      win.select(0);
    }

    _activateCommand() {
      this._toWindow.deactivate();
      this._subjectWindow.deactivate();
      this._bodyWindow.deactivate();

      this._cmdWindow.activate();
      this._cmdWindow.select(0);
    }

    onSend() {
      const to = this._toWindow.text().trim();
      const subject = this._subjectWindow.text().trim();
      const body = this._bodyWindow.text().trim();

      if (!to) {
        SoundManager.playBuzzer();
        this._activateWindow(this._toWindow);
        return;
      }
      if (!body) {
        SoundManager.playBuzzer();
        this._activateWindow(this._bodyWindow);
        return;
      }

      if (this._cmdWindow && typeof this._cmdWindow.setSending === 'function') {
        this._cmdWindow.setSending(true);
      }

      Mail.send(to, subject, body);

      // Window_Command deactivates itself on OK; reactivate so the scene doesn't appear frozen.
      if (this._cmdWindow) this._cmdWindow.activate();
    }
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
// Online Players UI
// --------------------------------------------------------------------------
class Window_OnlineList extends Window_Selectable {
  initialize(rect) {
    super.initialize(rect);
    this._data = [];
    this.refresh();
  }

  maxItems() { return this._data.length; }
  item() { return this._data[this.index()]; }

  refresh() {
    this._data = Array.isArray(Presence.users) ? Presence.users : [];
    super.refresh();

    // Empty state
    if (this._data.length === 0) {
      const pad = this.itemPadding();
      this.contents.clear();
      this.resetTextColor();
      this.drawText('No players online.', pad, 0, this.innerWidth - pad * 2, 'center');
    }
  }

  drawItem(index) {
    const rect = this.itemLineRect(index);
    const user = this._data[index];
    if (!user) return;
    this.resetTextColor();
    this.drawText(String(user.username || user.id || ''), rect.x, rect.y, rect.width);
  }
}

class Window_OnlineCommand extends Window_HorzCommand {
  makeCommandList() {
    this.addCommand('View', 'view');
    this.addCommand('Refresh', 'refresh');
    this.addCommand('Close', 'cancel');
  }

  maxCols() { return 3; }

  cursorDown(wrap) {
    // Down from the command bar enters the list (classic JRPG feel)
    if (this.isHandled('view')) {
      SoundManager.playCursor();
      this.callHandler('view');
      return;
    }
    super.cursorDown(wrap);
  }
}

class Window_OnlineActions extends Window_Command {
  initialize(rect) {
    super.initialize(rect);
    this._target = null;
    this.openness = 0;
    this.hide();
  }

  setTarget(user) {
    this._target = user || null;
    this.refresh();
  }

  targetUsername() {
    const u = this._target;
    return String(u?.username || '').trim();
  }

  _hasSocial() {
    return !!(window.Social && typeof window.Social.requestFriend === 'function');
  }

  _hasGuild() {
    return !!(window.Guild && typeof window.Guild.inviteByUsername === 'function');
  }

  _canInviteGuild() {
    const G = window.Guild;
    if (!G || typeof G.canInvite !== 'function') return false;
    return !!(G.inGuild && G.canInvite());
  }

  _canAddFriend(username) {
    if (!username) return false;
    const S = window.Social;
    if (!S) return false;
    if (typeof S.isLoaded === 'function' && S.isLoaded()) {
      if (typeof S.isBlocked === 'function' && S.isBlocked(username)) return false;
      if (typeof S.isFriend === 'function' && S.isFriend(username)) return false;
    }
    return true;
  }

  _canBlock(username) {
    if (!username) return false;
    const S = window.Social;
    if (!S) return false;
    if (typeof S.isLoaded === 'function' && S.isLoaded()) {
      if (typeof S.isBlocked === 'function' && S.isBlocked(username)) return false;
    }
    return true;
  }

  makeCommandList() {
    const username = this.targetUsername();
    const canFriend = this._hasSocial() && this._canAddFriend(username);
    const canBlock = this._hasSocial() && this._canBlock(username);
    const canInvite = this._hasGuild() && this._canInviteGuild();

    this.addCommand('Invite to Guild', 'invite', canInvite);
    this.addCommand('Add Friend', 'friend', canFriend);
    this.addCommand('Block', 'block', canBlock);
    this.addCommand('Cancel', 'cancel', true);
  }
}

class Scene_OnlinePlayers extends Scene_MenuBase {
  create() {
    super.create();

    const margin = 12;
    const cmdH = this.calcWindowHeight(1, true);

    const listRect = new Rectangle(margin, margin, Graphics.boxWidth - margin * 2, Graphics.boxHeight - margin * 3 - cmdH);
    const cmdRect  = new Rectangle(margin, Graphics.boxHeight - margin - cmdH, Graphics.boxWidth - margin * 2, cmdH);

    this._listWindow = new Window_OnlineList(listRect);
    this._listWindow.setHandler('ok', this.onListOk.bind(this));
    this._listWindow.setHandler('cancel', this.onListCancel.bind(this));
    this.addWindow(this._listWindow);

    this._cmdWindow = new Window_OnlineCommand(cmdRect);
    this._cmdWindow.setHandler('view', this.onView.bind(this));
    this._cmdWindow.setHandler('refresh', this.onRefresh.bind(this));
    this._cmdWindow.setHandler('cancel', this.popScene.bind(this));
    this.addWindow(this._cmdWindow);

    const actW = Math.min(420, Graphics.boxWidth - margin * 4);
    const actH = this.calcWindowHeight(4, true);
    const actX = Math.floor((Graphics.boxWidth - actW) / 2);
    const actY = Math.floor((Graphics.boxHeight - actH) / 2);
    this._actionsWindow = new Window_OnlineActions(new Rectangle(actX, actY, actW, actH));
    this._actionsWindow.setHandler('invite', this.onInviteGuild.bind(this));
    this._actionsWindow.setHandler('friend', this.onAddFriend.bind(this));
    this._actionsWindow.setHandler('block', this.onBlock.bind(this));
    this._actionsWindow.setHandler('cancel', this.closeActions.bind(this));
    this.addWindow(this._actionsWindow);

    Presence.on('updated', () => {
      if (SceneManager._scene !== this) return;
      const prev = this._listWindow.index();
      this._listWindow.refresh();
      if (prev >= 0 && prev < this._listWindow.maxItems()) this._listWindow.select(prev);
    });

    // Start focused on the command bar. View enters the list.
    this._listWindow.deactivate();
    this._listWindow.select(-1);

    this._cmdWindow.activate();
    this._cmdWindow.select(0);

    // Initial fetch
    this.onRefresh();
  }

  onView() {
    this._cmdWindow.deactivate();
    this._listWindow.activate();
    if (this._listWindow.maxItems() > 0 && this._listWindow.index() < 0) this._listWindow.select(0);
  }

  onRefresh() {
    Presence.requestOnline();
    // Keep focus on the command bar (Refresh is NOT "sticky view").
    if (this._actionsWindow) this._actionsWindow.hide();
    if (this._listWindow) this._listWindow.deactivate();
    if (this._cmdWindow) {
      this._cmdWindow.activate();
      if (this._cmdWindow.index() < 0) this._cmdWindow.select(0);
    }
  }

  onListOk() {
    const user = this._listWindow.item();
    if (!user) {
      SoundManager.playBuzzer();
      this._listWindow.activate();
      return;
    }

    this._actionsWindow.setTarget(user);
    this._actionsWindow.refresh();
    this._actionsWindow.show();
    this._actionsWindow.open();
    this._actionsWindow.activate();
    this._actionsWindow.select(0);

    this._listWindow.deactivate();
  }

  onListCancel() {
    // Back to command bar (View/Refresh/Close)
    this._listWindow.deactivate();
    this._cmdWindow.activate();
    if (this._cmdWindow.index() < 0) this._cmdWindow.select(0);
  }

  closeActions() {
    this._actionsWindow.deactivate();
    this._actionsWindow.close();
    this._actionsWindow.hide();
    this._listWindow.activate();
  }

  onInviteGuild() {
    const username = this._actionsWindow.targetUsername();
    const G = window.Guild;

    if (!username || !G || typeof G.inviteByUsername !== 'function') {
      SoundManager.playBuzzer();
      this.closeActions();
      return;
    }

    if (!G.inGuild) {
      SoundManager.playBuzzer();
      chatSystem('You are not in a guild.');
      this.closeActions();
      return;
    }

    if (typeof G.canInvite === 'function' && !G.canInvite()) {
      SoundManager.playBuzzer();
      chatSystem('You do not have permission to invite.');
      this.closeActions();
      return;
    }

    G.inviteByUsername(username);
    chatSystem(`Guild invite sent to ${username}.`);
    this.closeActions();
  }

  onAddFriend() {
    const username = this._actionsWindow.targetUsername();
    const S = window.Social;
    if (!username || !S || typeof S.requestFriend !== 'function') {
      SoundManager.playBuzzer();
      this.closeActions();
      return;
    }

    S.requestFriend(username);
    chatSystem(`Friend request sent to ${username}.`);
    this.closeActions();
  }

  onBlock() {
    const username = this._actionsWindow.targetUsername();
    const S = window.Social;
    if (!username || !S || typeof S.block !== 'function') {
      SoundManager.playBuzzer();
      this.closeActions();
      return;
    }

    S.block(username);
    chatSystem(`Blocked: ${username}`);
    this.closeActions();
  }
}



  // ------------------------------------------------------------------------
  // Expose compose scene for other plugins (e.g., Social friend actions).
  // This is non-breaking: existing systems ignore these globals.
  // ------------------------------------------------------------------------
  try {
    window.Scene_MailCompose = Scene_MailCompose;
    window.MMO_MailUI = window.MMO_MailUI || {};
    window.MMO_MailUI.openComposeTo = function(toUsername, subject = '', body = '') {
      if (!toUsername) return;
      Scene_MailCompose.prepare({ to: String(toUsername), subject: String(subject || ''), body: String(body || '') });
      SceneManager.push(Scene_MailCompose);
    };
  } catch (_) {}

})();
