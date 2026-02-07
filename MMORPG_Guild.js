/*:
 * @target MZ
 * @plugindesc v1.3.0 Guild System with Map Sync - <guild> tag support for guild-only visibility
 * @author Claude (Anthropic) for Nate's 100 World Story
 * @url https://github.com/your-repo
 *
 * @command open
 * @text Open Guild
 * @desc Opens create scene if not in guild, or management menu if in guild
 *
 * @command openCreate
 * @text Open Create Guild
 * @desc Opens the guild creation scene
 *
 * @command openMenu
 * @text Open Guild Menu
 * @desc Opens the guild management menu (must be in a guild)
 *
 * @command openRoster
 * @text Open Guild Roster
 * @desc Opens the guild roster/member list (must be in a guild)
 *
 * @command openInvites
 * @text Open Guild Invites
 * @desc Opens the guild invitation inbox to view/accept/decline pending invites
 *
 * @command checkInGuild
 * @text Check In Guild
 * @desc Sets a switch ON if player is in a guild, OFF if not
 *
 * @arg switchId
 * @text Switch ID
 * @type switch
 * @desc The switch to set based on guild membership
 * @default 1
 *
 * @command checkIsLeader
 * @text Check Is Guild Leader
 * @desc Sets a switch ON if player is the guild leader, OFF if not
 *
 * @arg switchId
 * @text Switch ID
 * @type switch
 * @desc The switch to set based on leader status
 * @default 2
 *
 * @command leave
 * @text Leave Guild
 * @desc Leave the current guild
 *
 * @command disband
 * @text Disband Guild
 * @desc Disband the guild (leader only)
 *
 * @command sendChat
 * @text Send Guild Chat
 * @desc Send a message to guild chat
 *
 * @arg message
 * @text Message
 * @type string
 * @desc The message to send to guild chat
 *
 * @help
 * ============================================================================
 * GUILD SYSTEM CLIENT
 * ============================================================================
 * * This plugin provides client-side guild functionality that communicates
 * with the server's guild.js and guildIntegration.js modules.
 * * REQUIRES: MMORPG_Client.js or similar (for client.publish, client.react, etc.)
 * * ============================================================================
 * PLUGIN COMMANDS
 * ============================================================================
 * * Open Guild        - Smart open (create if no guild, menu if in guild)
 * Open Create Guild - Opens guild creation scene
 * Open Guild Menu   - Opens guild management (requires being in guild)
 * Open Guild Roster - Opens member list (requires being in guild)
 * Open Guild Invites- Opens invitation inbox
 * Leave Guild       - Leave current guild
 * Disband Guild     - Disband guild (leader only)
 * Send Guild Chat   - Send message to guild chat
 * * ============================================================================
 * SCRIPT CALLS
 * ============================================================================
 * * Guild.open()                        - Smart open scene
 * Guild.openCreate()                  - Open creation scene
 * Guild.openMenu()                    - Open management menu
 * Guild.openRoster()                  - Open roster
 * Guild.openInvites()                 - Open invitation inbox
 * Guild.create(name, tag)             - Create a new guild
 * Guild.invite(userId, username)      - Invite a player
 * Guild.acceptInvite(guildId)         - Accept pending invite
 * Guild.declineInvite(guildId)        - Decline pending invite
 * Guild.getInvites()                  - Fetch pending invites from server
 * Guild.leave()                       - Leave current guild
 * Guild.kick(userId)                  - Kick a member
 * Guild.promote(userId)               - Promote a member
 * Guild.demote(userId)                - Demote a member
 * Guild.transfer(userId)              - Transfer leadership
 * Guild.disband()                     - Disband guild (leader only)
 * Guild.setMotd(text)                 - Update message of the day
 * Guild.setNote(userId, note)         - Set member note
 * Guild.chat(message)                 - Send guild chat message
 * Guild.refresh()                     - Refresh guild info from server
 * Guild.getRoster()                   - Request roster update
 * * ============================================================================
 * CHAT COMMANDS (type in chat input)
 * ============================================================================
 * * Use these prefixes in your chat input. Works with \ or / :
 * * \g message  OR  /g message   - Send to guild chat
 * \p message  OR  /p message   - Send to party chat
 * \w message  OR  /w message   - Send to nearby players (area whisper)
 * * INTEGRATION: Call Guild.parseAndRouteChat(input) from your chat input
 * handler. It returns { handled, type, message } - if handled is true,
 * the message was routed and you should not process it further.
 * * Example in your chat plugin:
 * const result = Guild.parseAndRouteChat(userInput);
 * if (result.handled) return; // Guild plugin handled it
 * // ... your normal chat handling ...
 * * ============================================================================
 * PROPERTIES (read-only)
 * ============================================================================
 * * Guild.inGuild          - Boolean, true if player is in a guild
 * Guild.data             - Current guild data object
 * Guild.roster           - Array of guild members
 * Guild.myRank           - Current player's rank object
 * Guild.pendingInvite    - Pending invite info (or null)
 * * ============================================================================
 * EVENTS
 * ============================================================================
 * * Register handlers with Guild.on(event, callback):
 * * 'joined'              - Player joined a guild
 * 'left'                - Player left the guild
 * 'kicked'              - Player was kicked
 * 'disbanded'           - Guild was disbanded
 * 'memberJoined'        - Another member joined
 * 'memberLeft'          - Another member left
 * 'memberKicked'        - Another member was kicked
 * 'memberOnline'        - Member came online
 * 'memberOffline'       - Member went offline
 * 'promoted'            - Member was promoted
 * 'demoted'             - Member was demoted
 * 'motdUpdated'         - MOTD was changed
 * 'leadershipChanged'   - Leadership was transferred
 * 'inviteReceived'      - Received a guild invite
 * 'chat'                - Guild chat message received
 * 'error'               - Error occurred
 * * @param confirmDisband
 * @text Confirm Disband
 * @type boolean
 * @default true
 * @desc Require confirmation before disbanding guild
 * * @param confirmLeave
 * @text Confirm Leave
 * @type boolean
 * @default true
 * @desc Require confirmation before leaving guild
 * * @param chatPrefix
 * @text Guild Chat Prefix
 * @type string
 * @default [Guild]
 * @desc Prefix for guild chat messages in the chat log
 *
 * @param mmoGlobalName
 * @text MMO Global Name
 * @type string
 * @default client
 * @desc Name of the global MMO client object (e.g., client, MMO, MMORPG)
 */

(() => {
  'use strict';

  // Chat integration (uses window.chat from your chat plugin)
  const CHAT_GUILD_COLOR = 'cyan';
  function chatGuildAddMessage(text) {
    const chat = window.chat;
    if (!chat || typeof chat.addMessage !== 'function') return;
    chat.addMessage('[Guild]', text, CHAT_GUILD_COLOR);
  }

  const pluginName = 'MMORPG_Guild';
  const parameters = PluginManager.parameters(pluginName);
  const confirmDisband = parameters['confirmDisband'] !== 'false';
  const confirmLeave = parameters['confirmLeave'] !== 'false';
  const chatPrefix = parameters['chatPrefix'] || '[Guild]';
  const mmoGlobalName = parameters['mmoGlobalName'] || 'client';

  // ============================================================================
  // MMO CLIENT HELPER
  // ============================================================================
  
  /**
   * Get the MMO client object safely
   * @returns {object|null} The MMO client or null if not available
   */
  function getMMO() {
    return window[mmoGlobalName] || null;
  }

  /**
   * Check if MMO client is available and connected
   * @returns {boolean}
   */
  function isMMOReady() {
    const mmo = getMMO();
    if (!mmo) return false;

    // Prefer explicit readiness checks if available (MMORPG_Client exposes isReady()).
    try {
      if (typeof mmo.isReady === 'function') return !!mmo.isReady();
      if (typeof mmo.net?.isReady === 'function') return !!mmo.net.isReady();
    } catch (e) {
      // ignore
    }

    // Fallback for older / custom clients
    return !!(mmo.connected || mmo.net || mmo.publish || mmo.broadcast);
  }

  /**
   * Get current user ID from MMO client
   * @returns {string|null}
   */
  function getMyUserId() {
    const mmo = getMMO();
    if (!mmo) return null;

    // Prefer the actual MMORPG_Client API (ClientImpl.user())
    try {
      if (typeof mmo.user === 'function') {
        const u = mmo.user();
        if (u) return u;
      }
    } catch (e) {
      // ignore
    }

    // Fallbacks for older / custom client builds
    return mmo.oderId || mmo.orderId || mmo.userId || mmo.playerId || mmo.id || null;
  }

  /**
   * Safely send a broadcast/publish to the server
   * Tries multiple method names: broadcast, publish, send
   * @param {string} command - The command to send
   * @param {array} args - Arguments to send
   * @returns {boolean} - True if sent, false if MMO not ready
   */
  function safeBroadcast(command, args) {
    const mmo = getMMO();
    if (!mmo) {
      console.error(`[Guild] MMO client "${mmoGlobalName}" not found! Check plugin parameter "MMO Global Name"`);
      return false;
    }
    
    // console.log(`[Guild] safeBroadcast: command=${command}, args=`, args);
    
    // Try broadcast with positional arguments: broadcast(loopback, code, ...args)
    if (mmo.broadcast) {
      mmo.broadcast(false, command, ...args);
      return true;
    }
    if (mmo.net?.broadcast) {
      mmo.net.broadcast(false, command, ...args);
      return true;
    }
    
    // Try publish with positional arguments
    if (mmo.publish) {
      mmo.publish(true, 'guild', command, ...args);
      return true;
    }
    if (mmo.net?.publish) {
      mmo.net.publish(true, 'guild', command, ...args);
      return true;
    }
    
    // Try send
    if (mmo.send) {
      mmo.send(command, ...args);
      return true;
    }
    if (mmo.net?.send) {
      mmo.net.send(command, ...args);
      return true;
    }
    
    console.error(`[Guild] MMO client has no broadcast/publish/send method!`);
    return false;
  }

  // ============================================================================
  // GUILD MANAGER
  // ============================================================================

  class GuildManager {
    constructor() {
      this._data = null;
      this._roster = [];
      this._pendingInvite = null;
      this._invites = [];
      this._handlers = {};
      this._pendingCallbacks = new Map();
      this._callbackId = 0;
      this._isLeader = false;
      
      // FIX: Load from cache immediately so "inGuild" is true on startup
      setTimeout(() => this._loadLocalCacheToMemory(), 100);

      this._setupNetworkHandlers();
    }

    _loadLocalCacheToMemory() {
      const cache = this._loadLocalCache();
      if (cache && cache.inGuild) {
        // Construct a partial data object so the UI works
        this._data = {
          id: cache.guildId,
          name: cache.guildName,
          tag: cache.guildTag,
          leaderId: cache.isLeader ? getMyUserId() : null,
          myRankId: cache.isLeader ? 'leader' : 'member', // Assumed until sync
          memberCount: '?',
          level: 1
        };
        this._isLeader = !!cache.isLeader;
        console.log('[Guild] Restored state from local cache');
      }
    }

    // ========== PROPERTIES ==========

    get inGuild() {
      return !!this._data;
    }

    get data() {
      return this._data;
    }

    get roster() {
      return this._roster;
    }

    get myRank() {
      if (!this._data) return null;
      // Default to member if ranks not loaded yet
      if (!this._data.ranks) return { id: 'member', name: 'Member', priority: 99 };
      return this._data.ranks.find(r => r.id === this._data.myRankId);
    }

    get pendingInvite() {
      return this._pendingInvite;
    }

    get invites() {
      return this._invites || [];
    }

    get hasInvites() {
      return this._invites && this._invites.length > 0;
    }

    // ========== EVENT SYSTEM ==========

    on(event, callback) {
      if (!this._handlers[event]) {
        this._handlers[event] = [];
      }
      this._handlers[event].push(callback);
      return this;
    }

    off(event, callback) {
      if (!this._handlers[event]) return this;
      if (callback) {
        this._handlers[event] = this._handlers[event].filter(h => h !== callback);
      } else {
        delete this._handlers[event];
      }
      return this;
    }

    _emit(event, ...args) {
      const handlers = this._handlers[event];
      if (handlers) {
        handlers.forEach(h => {
          try {
            h(...args);
          } catch (e) {
            console.error(`Guild event handler error (${event}):`, e);
          }
        });
      }
    }

    // ========== NETWORK HANDLERS ==========

    _setupNetworkHandlers() {
      const mmo = getMMO();
      
      // Check if client is available
      if (!mmo) {
        setTimeout(() => this._setupNetworkHandlers(), 1000);
        return;
      }

      // Detect which API pattern to use
      let reactFn = null;
      
      if (mmo.net?.react) {
        reactFn = (group, event, cb) => mmo.net.react(group, event, cb);
      } else if (mmo.unsafeReact) {
        reactFn = (group, event, cb) => mmo.unsafeReact(Scene_Base, group, event, (scene, from, ...args) => cb([args[0]]));
      } else if (mmo.react) {
        reactFn = (group, event, cb) => mmo.react(Scene_Base, group, event, (scene, from, ...args) => cb([args[0]]));
      } else if (mmo.net?.on) {
        reactFn = (group, event, cb) => mmo.net.on(event, cb);
      } else if (mmo.on) {
        reactFn = (group, event, cb) => mmo.on(event, cb);
      }
      
      if (!reactFn) {
        setTimeout(() => this._setupNetworkHandlers(), 1000);
        return;
      }

      // Response handlers (server responses to our commands)
      reactFn('guild', 'g/info/res', (args) => this._onInfoResponse(args[0]));
      reactFn('guild', 'g/roster/res', (args) => this._onRosterResponse(args[0]));
      reactFn('guild', 'g/create/res', (args) => this._onCreateResponse(args[0]));
      reactFn('guild', 'g/invite/res', (args) => this._onGenericResponse('invite', args[0]));
      reactFn('guild', 'g/accept/res', (args) => this._onAcceptResponse(args[0]));
      reactFn('guild', 'g/decline/res', (args) => this._onGenericResponse('decline', args[0]));
      reactFn('guild', 'g/leave/res', (args) => this._onLeaveResponse(args[0]));
      reactFn('guild', 'g/kick/res', (args) => this._onGenericResponse('kick', args[0]));
      reactFn('guild', 'g/promote/res', (args) => this._onGenericResponse('promote', args[0]));
      reactFn('guild', 'g/demote/res', (args) => this._onGenericResponse('demote', args[0]));
      reactFn('guild', 'g/transfer/res', (args) => this._onGenericResponse('transfer', args[0]));
      reactFn('guild', 'g/disband/res', (args) => this._onDisbandResponse(args[0]));
      reactFn('guild', 'g/motd/res', (args) => this._onGenericResponse('motd', args[0]));
      reactFn('guild', 'g/note/res', (args) => this._onGenericResponse('note', args[0]));
      reactFn('guild', 'g/invites/res', (args) => this._onInvitesResponse(args[0]));
      reactFn('guild', 'g/invites/clear/res', (args) => this._onGenericResponse('clearInvites', args[0]));

      // FIX: Also listen on '@' for responses that might come before channel sub
      reactFn('@', 'g/info/res', (args) => this._onInfoResponse(args[0]));
      reactFn('@', 'g/roster/res', (args) => this._onRosterResponse(args[0]));
      reactFn('@', 'g/create/res', (args) => this._onCreateResponse(args[0]));
      reactFn('@', 'guild/invite', (args) => this._onInviteReceived(args[0]));
      reactFn('@', 'guild/invite_declined', (args) => this._onInviteDeclined(args[0]));
      reactFn('@', 'guild/invite_accepted', (args) => this._onInviteAccepted(args[0]));
      reactFn('@', 'g/invites/res', (args) => this._onInvitesResponse(args[0]));

      // Event handlers (server broadcasts to all guild members)
      reactFn('guild', 'guild/joined', (args) => this._onMemberJoined(args[0]));
      reactFn('guild', 'guild/left', (args) => this._onMemberLeft(args[0]));
      reactFn('guild', 'guild/kicked', (args) => this._onMemberKicked(args[0]));
      reactFn('guild', 'guild/you_kicked', (args) => this._onYouKicked(args[0]));
      reactFn('guild', 'guild/promoted', (args) => this._onMemberPromoted(args[0]));
      reactFn('guild', 'guild/demoted', (args) => this._onMemberDemoted(args[0]));
      reactFn('guild', 'guild/motd_updated', (args) => this._onMotdUpdated(args[0]));
      reactFn('guild', 'guild/leadership_transferred', (args) => this._onLeadershipTransferred(args[0]));
      reactFn('guild', 'guild/disbanded', (args) => this._onGuildDisbanded(args[0]));
      reactFn('guild', 'guild/invite', (args) => this._onInviteReceived(args[0]));
      reactFn('guild', 'guild/invite_declined', (args) => this._onInviteDeclined(args[0]));
      reactFn('guild', 'guild/invite_accepted', (args) => this._onInviteAccepted(args[0]));
      reactFn('guild', 'g/chat', (args) => this._onChatMessage(args[0]));
      reactFn('guild', 'g/online', (args) => this._onMemberOnline(args[0]));
      reactFn('guild', 'g/offline', (args) => this._onMemberOffline(args[0]));

      console.log('MMORPG_Guild: Network handlers registered');
    }

    // ========== COMMANDS ==========

    /**
     * Get the local player's character name
     */
    _getCharacterName() {
      if ($gameActors && $gameActors.actor(1)) {
        return $gameActors.actor(1).name();
      }
      return null;
    }

    create(name, tag) {
      if (this.inGuild) {
        this._emit('error', { command: 'create', error: 'Already in a guild' });
        return false;
      }
      const characterName = this._getCharacterName();
      safeBroadcast('g/create', [name, tag, characterName]);
      return true;
    }

    invite(userId, characterName) {
      if (!this.inGuild) {
        this._emit('error', { command: 'invite', error: 'Not in a guild' });
        return false;
      }
      this._lastInviteTarget = characterName || String(userId);
      safeBroadcast('g/invite', [userId, characterName]);
      return true;
    }

    inviteByUsername(username) {
      if (!this.inGuild) {
        this._emit('error', { command: 'invite', error: 'Not in a guild' });
        return false;
      }
      const target = (username || '').trim();
      if (!target) {
        this._emit('error', { command: 'invite', error: 'Username is required' });
        return false;
      }
      this._lastInviteTarget = target;
      safeBroadcast('g/invite', [target]);
      return true;
    }


    acceptInvite(guildId = null) {
      const invites = this._invites || [];
      if (invites.length === 0 && !this._pendingInvite) {
        this._emit('error', { command: 'accept', error: 'No pending invite' });
        return false;
      }
      const characterName = this._getCharacterName();
      safeBroadcast('g/accept', [guildId, characterName]);
      return true;
    }

    declineInvite(guildId = null) {
      const invites = this._invites || [];
      if (invites.length === 0 && !this._pendingInvite) {
        this._emit('error', { command: 'decline', error: 'No pending invite' });
        return false;
      }
      const characterName = this._getCharacterName();
      safeBroadcast('g/decline', [guildId, characterName]);
      // Remove from local list
      if (guildId && this._invites) {
        this._invites = this._invites.filter(inv => inv.guildId !== guildId);
      } else {
        this._pendingInvite = null;
      }
      return true;
    }

    getInvites() {
      safeBroadcast('g/invites', []);
      return true;
    }

    clearInvites() {
      safeBroadcast('g/invites/clear', []);
      this._invites = [];
      return true;
    }

    leave() {
      if (!this.inGuild) {
        this._emit('error', { command: 'leave', error: 'Not in a guild' });
        return false;
      }
      if (this.isLeader()) {
        this._emit('error', { command: 'leave', error: 'Leader must transfer ownership or disband' });
        return false;
      }
      safeBroadcast('g/leave', []);
      return true;
    }

    kick(userId) {
      if (!this.inGuild) {
        this._emit('error', { command: 'kick', error: 'Not in a guild' });
        return false;
      }
      safeBroadcast('g/kick', [userId]);
      return true;
    }

    promote(userId) {
      if (!this.inGuild) {
        this._emit('error', { command: 'promote', error: 'Not in a guild' });
        return false;
      }
      safeBroadcast('g/promote', [userId]);
      return true;
    }

    demote(userId) {
      if (!this.inGuild) {
        this._emit('error', { command: 'demote', error: 'Not in a guild' });
        return false;
      }
      safeBroadcast('g/demote', [userId]);
      return true;
    }

    transfer(userId) {
      if (!this.inGuild) {
        this._emit('error', { command: 'transfer', error: 'Not in a guild' });
        return false;
      }
      if (this._data.leaderId !== getMyUserId()) {
        this._emit('error', { command: 'transfer', error: 'Only the leader can transfer ownership' });
        return false;
      }
      safeBroadcast('g/transfer', [userId]);
      return true;
    }

    disband() {
      if (!this.inGuild) {
        this._emit('error', { command: 'disband', error: 'Not in a guild' });
        return false;
      }
      if (this._data.leaderId !== getMyUserId()) {
        this._emit('error', { command: 'disband', error: 'Only the leader can disband' });
        return false;
      }
      safeBroadcast('g/disband', []);
      return true;
    }

    setMotd(text) {
      if (!this.inGuild) {
        this._emit('error', { command: 'motd', error: 'Not in a guild' });
        return false;
      }
      safeBroadcast('g/motd', [text]);
      return true;
    }

    setNote(userId, note) {
      if (!this.inGuild) {
        this._emit('error', { command: 'note', error: 'Not in a guild' });
        return false;
      }

      // Cache target name for chat feedback.
      try {
        const idStr = String(userId);
        const member = (this._roster || []).find(m => String(m.oderId ?? m.userId) === idStr);
        this._lastNoteTarget = member?.characterName || member?.username || member?.name || idStr;
      } catch (e) {
        this._lastNoteTarget = String(userId);
      }

      safeBroadcast('g/note', [userId, note]);
      return true;
    }

    chat(message) {
      if (!this.inGuild) {
        this._emit('error', { command: 'chat', error: 'Not in a guild' });
        return false;
      }
      if (!message || message.trim().length === 0) return false;
      safeBroadcast('g/chat', [message]);
      return true;
    }

    // ========== CHAT PREFIX ROUTING ==========

    parseAndRouteChat(input) {
      if (!input || input.length < 2) {
        return { handled: false, type: 'default', message: input };
      }

      const trimmed = input.trim();

      // Guild chat: /g message  OR  \g message
      if (trimmed.startsWith('\\g ') || trimmed.startsWith('/g ')) {
        const message = trimmed.substring(3).trim();
        if (message.length > 0) {
          this.chat(message);
          return { handled: true, type: 'guild', message };
        }
        return { handled: true, type: 'guild', message: '', error: 'Empty message' };
      }

      // Party chat: /p message  OR  \p message
      if (trimmed.startsWith('\\p ') || trimmed.startsWith('/p ')) {
        const message = trimmed.substring(3).trim();
        if (message.length > 0 && isMMOReady()) {
          safeBroadcast('p/chat', [message]);
          return { handled: true, type: 'party', message };
        }
        return { handled: true, type: 'party', message: '', error: 'Empty message or no party' };
      }

      return { handled: false, type: 'default', message: input };
    }


    refresh() {
      safeBroadcast('g/info', []);
      return true;
    }

    getRoster() {
      if (!this.inGuild) {
        this._emit('error', { command: 'roster', error: 'Not in a guild' });
        return false;
      }
      safeBroadcast('g/roster', []);
      return true;
    }

    // ========== PERMISSION HELPERS ==========

    hasPermission(permission) {
      if (!this.inGuild || !this.myRank) return false;
      if (this.myRank.permissions && this.myRank.permissions.all) return true;
      // Simple default if permissions object is missing
      if (!this.myRank.permissions) {
        if (this.myRank.id === 'leader') return true;
        if (this.myRank.id === 'officer' && permission !== 'disband') return true;
        return false;
      }
      return this.myRank.permissions && this.myRank.permissions[permission];
    }

    canInvite() { return this.hasPermission('invite'); }
    canKick() { return this.hasPermission('kick'); }
    canPromote() { return this.hasPermission('promote'); }
    canDemote() { return this.hasPermission('demote'); }
    canEditMotd() { return this.hasPermission('editMotd'); }
    isLeader() { return this.inGuild && (this._isLeader || (this._data?.leaderId != null && getMyUserId() != null && String(this._data.leaderId) === String(getMyUserId()))); }

    // Keep "in guild" / "is leader" game switches in sync with server truth.
    // Switch 1: In Guild, Switch 2: Is Guild Leader
    _syncFlagSwitches() {
      try {
        if (typeof $gameSwitches === 'undefined' || !$gameSwitches) return;
        $gameSwitches.setValue(1, this.inGuild);
        $gameSwitches.setValue(2, this.isLeader());
      } catch (e) {
        // ignore
      }
    }


    // ========== RESPONSE HANDLERS ==========

    _onInfoResponse(data) {
      if (data.success && data.guild) {
        this._data = data.guild;
        if (data.myRankId) this._data.myRankId = data.myRankId;
        this._isLeader = !!data.isLeader;
        this._emit('infoUpdated', this._data);
      } else {
        this._data = null;
        this._roster = [];
        this._isLeader = false;
      }
      this._syncFlagSwitches();
      this._saveLocalCache();
    }

    _onRosterResponse(data) {
      if (data.success) {
        const raw = data.roster || [];
        this._roster = raw.map(m => {
          const memberId = (m.userId ?? m.oderId);
          const username = (m.username ?? m.name ?? 'Unknown');
          return {
            ...m,
            userId: memberId,
            oderId: memberId,
            username,
            name: username
          };
        });
        this._emit('rosterUpdated', this._roster);
      } else {
        this._emit('error', { command: 'roster', error: data.error });
      }
    }

    _onCreateResponse(data) {
      if (data.success) {
        this._data = {
          id: data.guild.id,
          name: data.guild.name,
          tag: data.guild.tag,
          level: 1,
          motd: '',
          memberCount: 1,
          leaderId: getMyUserId(),
          myRankId: 'leader',
          ranks: [
            { id: 'leader', name: 'Guild Master', priority: 0 },
            { id: 'officer', name: 'Officer', priority: 1 },
            { id: 'veteran', name: 'Veteran', priority: 2 },
            { id: 'member', name: 'Member', priority: 3 },
            { id: 'recruit', name: 'Recruit', priority: 4 }
          ]
        };
        this._isLeader = true;
        this._syncFlagSwitches();
        this._emit('joined', this._data);
        this.refresh();
        if (typeof $gameMessage !== 'undefined' && $gameMessage.add) {
          $gameMessage.add(`\\C[3]Guild Created!\\C[0]\nWelcome to [${data.guild.tag}] ${data.guild.name}!`);
        }
        this._saveLocalCache();
      } else {
        this._emit('error', { command: 'create', error: data.error });
        if (typeof $gameMessage !== 'undefined' && $gameMessage.add) {
          $gameMessage.add(`\\C[2]Guild Creation Failed\\C[0]\n${data.error || 'Unknown error'}`);
        }
      }
    }

    _onAcceptResponse(data) {
      if (data.success) {
        this._pendingInvite = null;
        this._data = {
          id: data.guild.id,
          name: data.guild.name,
          tag: data.guild.tag,
          myRankId: 'recruit'
        };
        this._isLeader = false;
        this._syncFlagSwitches();
        this._emit('joined', this._data);
        this.refresh();
        this._saveLocalCache();
      } else {
        this._emit('error', { command: 'accept', error: data.error });
      }
    }

    _onLeaveResponse(data) {
      if (data.success) {
        const oldGuild = this._data;
        this._data = null;
        this._roster = [];
        this._isLeader = false;
        this._syncFlagSwitches();
        this._emit('left', oldGuild);
        this._saveLocalCache();
      } else {
        this._emit('error', { command: 'leave', error: data.error });
      }
    }

    _onDisbandResponse(data) {
      if (data.success) {
        const oldGuild = this._data;
        this._data = null;
        this._roster = [];
        this._isLeader = false;
        this._syncFlagSwitches();
        this._emit('disbanded', oldGuild);
        this._saveLocalCache();
      } else {
        this._emit('error', { command: 'disband', error: data.error });
      }
    }

    _onGenericResponse(command, data) {
      if (data.success) {
        if (command === 'invite') {
          const target = this._lastInviteTarget || 'player';
          chatGuildAddMessage(`Guild invite sent to ${target}.`);
          this._lastInviteTarget = null;
        }

        if (command === 'note') {
          const target = this._lastNoteTarget || 'member';
          chatGuildAddMessage(`Updated member note for ${target}.`);
          this._lastNoteTarget = null;
          // Pull fresh roster so the new note shows immediately.
          this.getRoster();
        }

        return;
      }

      this._emit('error', { command, error: data.error });
    }

    // ========== EVENT HANDLERS ==========

    _onMemberJoined(data) {
      if (this._data) {
        this._data.memberCount = (this._data.memberCount || 0) + 1;
      }
      this._emit('memberJoined', data);
      chatGuildAddMessage(`${data.characterName || data.username} joined the guild.`);
      this.getRoster();
    }

    _onMemberLeft(data) {
      if (this._data) {
        this._data.memberCount = Math.max(0, (this._data.memberCount || 1) - 1);
      }
      this._roster = this._roster.filter(m => m.userId !== data.userId);
      this._emit('memberLeft', data);
    }

    _onMemberKicked(data) {
      if (this._data) {
        this._data.memberCount = Math.max(0, (this._data.memberCount || 1) - 1);
      }
      this._roster = this._roster.filter(m => m.userId !== data.userId);
      this._emit('memberKicked', data);
    }

    _onYouKicked(data) {
      const oldGuild = this._data;
      this._data = null;
      this._roster = [];
      this._isLeader = false;
      this._syncFlagSwitches();
      this._saveLocalCache();
      this._emit('kicked', { guildName: data.guildName, oldGuild });
    }

    _onMemberPromoted(data) {
      const member = this._roster.find(m => m.userId === data.userId);
      if (member) {
        member.rankName = data.newRank;
      }
      if (data.userId === getMyUserId() && this._data) {
        // We'd ideally need the actual rank ID, not just name, assuming update will fetch
        this.refresh();
      }
      this._emit('promoted', data);
      this.getRoster();
    }

    _onMemberDemoted(data) {
      const member = this._roster.find(m => m.userId === data.userId);
      if (member) {
        member.rankName = data.newRank;
      }
      if (data.userId === getMyUserId() && this._data) {
        this.refresh();
      }
      this._emit('demoted', data);
      this.getRoster();
    }

    _onMotdUpdated(data) {
      if (this._data) {
        this._data.motd = data.motd;
      }
      this._emit('motdUpdated', data.motd);
    }

    _onLeadershipTransferred(data) {
      if (this._data) {
        this._data.leaderId = data.newLeaderId;
        if (data.newLeaderId === getMyUserId()) {
          this._data.myRankId = 'leader';
        } else if (data.oldLeaderId === getMyUserId()) {
          this._data.myRankId = 'officer';
        }
      }
      this._emit('leadershipChanged', data);
      this.getRoster();
      this._saveLocalCache();
    }

    _onGuildDisbanded(data) {
      const oldGuild = this._data;
      this._data = null;
      this._roster = [];
      this._isLeader = false;
      this._syncFlagSwitches();
      this._saveLocalCache();
      this._emit('disbanded', { guildName: data.guildName, oldGuild });
    }

    _onInviteReceived(data) {
      const invite = {
        guildId: data.guildId,
        guildName: data.guildName,
        guildTag: data.guildTag,
        inviterName: data.inviterName,
        receivedAt: Date.now()
      };
      
      // Keep legacy _pendingInvite for backwards compatibility
      this._pendingInvite = invite;
      
      // Also add to invites array (avoid duplicates)
      if (!this._invites) this._invites = [];
      const exists = this._invites.some(inv => inv.guildId === invite.guildId);
      if (!exists) {
        this._invites.push(invite);
      }
      
      chatGuildAddMessage(`Guild invite from ${invite.inviterName}: [${invite.guildTag}] ${invite.guildName}.`);
      this._emit('inviteReceived', invite);
    }

    _onInviteDeclined(data) {
      const name = data.characterName || data.username || 'Player';
      chatGuildAddMessage(`${name} declined your guild invite.`);
      this._emit('inviteDeclined', data);
    }

    _onInviteAccepted(data) {
      const name = data.characterName || data.username || 'Player';
      chatGuildAddMessage(`${name} accepted your guild invite.`);
      this._emit('inviteAccepted', data);
    }


    _onInvitesResponse(data) {
      if (data.success) {
        this._invites = (data.invites || []).map(inv => ({
          guildId: inv.guildId,
          guildName: inv.guildName,
          guildTag: inv.guildTag,
          inviterName: inv.inviterName,
          expiresAt: inv.expiresAt,
          receivedAt: Date.now()
        }));
        this._emit('invitesUpdated', this._invites);
      } else {
        this._emit('error', { command: 'invites', error: data.error });
      }
    }

    _onChatMessage(data) {
      this._emit('chat', {
        from: data.from,
        name: data.name,
        message: data.message,
        timestamp: data.timestamp || Date.now()
      });
      chatGuildAddMessage(`${data.name}: ${data.message}`);
    }

    _onMemberOnline(data) {
      const member = this._roster.find(m => m.userId === data.userId);
      if (member) {
        member.isOnline = true;
      }
      this._emit('memberOnline', data);
    }

    _onMemberOffline(data) {
      const member = this._roster.find(m => m.userId === data.userId);
      if (member) {
        member.isOnline = false;
      }
      this._emit('memberOffline', data);
    }
  }

  // ============================================================================
  // GLOBAL INSTANCE
  // ============================================================================

  window.Guild = new GuildManager();

  // ============================================================================
  // LOCAL PERSISTENCE - Store guild membership so it's available immediately
  // ============================================================================
  
  GuildManager.prototype._saveLocalCache = function() {
    if (typeof $gameSystem !== 'undefined' && $gameSystem) {
      $gameSystem._guildCache = {
        inGuild: this.inGuild,
        guildId: this._data?.id || null,
        guildName: this._data?.name || null,
        guildTag: this._data?.tag || null,
        isLeader: this.isLeader()
      };
    }
  };
  
  GuildManager.prototype._loadLocalCache = function() {
    if (typeof $gameSystem !== 'undefined' && $gameSystem && $gameSystem._guildCache) {
      return $gameSystem._guildCache;
    }
    return null;
  };
  
  Guild.checkInGuildCached = function() {
    if (this._data) return true;
    const cache = this._loadLocalCache();
    return cache?.inGuild || false;
  };
  
  Guild.checkIsLeaderCached = function() {
    if (this._data) return this.isLeader();
    const cache = this._loadLocalCache();
    return cache?.isLeader || false;
  };

  const _Scene_Map_start = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function() {
    _Scene_Map_start.call(this);

    // Load cached guild membership as early as possible (prevents <guild> map race on login).
    try {
      if (window.Guild && typeof Guild._loadLocalCacheToMemory === 'function') {
        Guild._loadLocalCacheToMemory();
      }
    } catch (e) {
      // ignore
    }

    if (isMMOReady()) {
      Guild.refresh();
    }
  };

  // ============================================================================
  // MAP SYNC INTEGRATION - <guild> TAG SUPPORT (FIX)
  // ============================================================================
  // The core MMO client (MMORPG_Characters) drives visibility by subscribing to:
  //   group:   "map"
  //   channel: ($gameMap.syncType() + $gameMap.syncName())
  //
  // By default, only <sync> maps return a non-empty syncType(), so <guild> maps
  // were never subscribed to the "map" group (characters never streamed).
  //
  // This section hooks <guild> into the SAME map-sync pipeline:
  //   - <guild> => syncType() === "guild"
  //   - syncName() === "<guildId>_<mapId>" (when guildId is known)
  //   - fallback syncName() === "solo_<userId>_<mapId>" (still subscribes, but isolated)
  //
  // It also re-subscribes after guild data loads/changes to avoid the "solo channel"
  // race condition on login/transfer.
  // ============================================================================

  function _guildHasTag(tag) {
    const data = $dataMap;
    const meta = data?.meta;
    if (meta) {
      return Object.keys(meta).some(k => String(k).toLowerCase() === String(tag).toLowerCase());
    }
    const note = (data?.note || '').toLowerCase();
    return note.includes(`<${String(tag).toLowerCase()}>`);
  }

  function _guildGetIdFromCache() {
    try {
      const cache = $gameSystem?._guildCache;
      const id = cache?.guildId;
      if (id === 0 || id) return String(id);
    } catch (e) {
      // ignore
    }
    return null;
  }

  function _guildGetIdFast() {
    try {
      const id = Guild?.data?.id;
      if (id === 0 || id) return String(id);
    } catch (e) {
      // ignore
    }
    return _guildGetIdFromCache();
  }

  function _guildGetUserIdFast() {
    const mmo = (typeof getMMO === 'function') ? getMMO() : null;
    const id =
      (typeof getMyUserId === 'function' ? getMyUserId() : null) ??
      (mmo && typeof mmo.user === 'function' ? mmo.user() : null) ??
      mmo?.oderId ??
      null;
    return id != null ? String(id) : 'unknown';
  }

  // Extend Game_Map.syncFind => recognize <guild>
  const _Game_Map_syncFind_Guild = Game_Map.prototype.syncFind;
  Game_Map.prototype.syncFind = function(keys) {
    try {
      if (Array.isArray(keys) && keys.some(k => String(k).toLowerCase() === 'guild')) {
        return 'guild';
      }
    } catch (e) {
      // ignore
    }
    return _Game_Map_syncFind_Guild.call(this, keys);
  };

  // Extend Game_Map.syncName => include guildId + mapId, with safe fallback (never empty).
  const _Game_Map_syncName_Guild = Game_Map.prototype.syncName;
  Game_Map.prototype.syncName = function() {
    const type = this.syncType?.();
    if (type !== 'guild') return _Game_Map_syncName_Guild.call(this);

    const mapId = this.mapId?.() ?? $gameMap?.mapId?.() ?? 0;
    const guildId = _guildGetIdFast();
    if (guildId) return `${guildId}_${mapId}`;

    // Not in guild / guild not loaded yet => isolate this user (but keep map subscription alive).
    return `solo_${_guildGetUserIdFast()}_${mapId}`;
  };

  // Track the currently subscribed map channel so we can avoid noisy re-subscribes.
  const _Game_Player_performTransfer_GuildTrack = Game_Player.prototype.performTransfer;
  Game_Player.prototype.performTransfer = function() {
    _Game_Player_performTransfer_GuildTrack.call(this);
    try {
      const type = $gameMap.syncType?.();
      const name = $gameMap.syncName?.();
      this._mapSyncChannel = (type && name) ? String(type) + String(name) : '';
    } catch (e) {
      this._mapSyncChannel = this._mapSyncChannel || '';
    }
  };

  function _guildResubscribeMapIfNeeded(reason = 'unknown') {
    if (!isMMOReady()) return;
    if (!$gameMap || !$gamePlayer) return;

    // Only needed on <guild> maps.
    const type = $gameMap.syncType?.();
    if (type !== 'guild') return;

    // Avoid resubscribing before the initial map subscription (performTransfer) runs.
    if (typeof $gamePlayer._mapSyncChannel !== 'string') return;

    const name = $gameMap.syncName?.();
    const desired = (type && name) ? String(type) + String(name) : '';

    // No-op if we're already on the desired channel.
    if ($gamePlayer._mapSyncChannel === desired) return;

    const mmo = getMMO();
    if (!mmo || typeof mmo.subscribe !== 'function') return;

    if (desired) {
      mmo.subscribe('map', desired, $gameParty?.leaderName?.() || '');
      $gamePlayer._subscribed = true;
    } else {
      mmo.subscribe('map', null);
      $gamePlayer._subscribed = false;
    }

    $gamePlayer._mapSyncChannel = desired;
    console.log(`[Guild] Map resubscribe (${reason}): map/${desired || '(none)'}`);
  }

  // Re-evaluate the channel after guild data loads / changes.
  Guild.on?.('infoUpdated', () => _guildResubscribeMapIfNeeded('infoUpdated'));
  Guild.on?.('joined',     () => _guildResubscribeMapIfNeeded('joined'));
  Guild.on?.('left',       () => _guildResubscribeMapIfNeeded('left'));
  Guild.on?.('kicked',     () => _guildResubscribeMapIfNeeded('kicked'));
  Guild.on?.('disbanded',  () => _guildResubscribeMapIfNeeded('disbanded'));

  // Minimal exports (avoid duplicates / conflicting implementations).
  Guild.isGuildMap = function() { return _guildHasTag('guild'); };
  Guild.getGuildMapChannel = function(mapId) {
    const id = mapId ?? $gameMap?.mapId?.();
    if (!id) return null;
    const guildId = _guildGetIdFast();
    return guildId ? `${guildId}_${id}` : `solo_${_guildGetUserIdFast()}_${id}`;
  };
  // Backwards-compatible alias (older code used getMapChannel).
  Guild.getMapChannel = Guild.getGuildMapChannel;



  // ============================================================================
  // SCENE FUNCTIONS
  // ============================================================================

  Guild.openCreate = function() {
    if (this.inGuild) {
      this._emit('error', { message: 'Already in a guild!' });
      return false;
    }
    SceneManager.push(Scene_GuildCreate);
    return true;
  };

  Guild.openMenu = function() {
    if (!this.inGuild) {
      this._emit('error', { message: 'Not in a guild!' });
      return false;
    }
    SceneManager.push(Scene_GuildMenu);
    return true;
  };

  Guild.openRoster = function() {
    if (!this.inGuild) {
      this._emit('error', { message: 'Not in a guild!' });
      return false;
    }
    SceneManager.push(Scene_GuildRoster);
    return true;
  };

  Guild.openInvites = function() {
    // Fetch latest invites then open scene
    this.getInvites();
    SceneManager.push(Scene_GuildInvites);
    return true;
  };

  Guild.open = function() {
    if (this.inGuild) {
      return this.openMenu();
    } else {
      return this.openCreate();
    }
  };

  // ============================================================================
  // SCENE: Guild Create
  // ============================================================================

  class Scene_GuildCreate extends Scene_MenuBase {
    create() {
      super.create();
      this.createHelpWindow();
      this.createNameWindow();
      this.createTagWindow();
      this.createConfirmWindow();
    }

    createHelpWindow() {
      const rect = this.helpWindowRect();
      this._helpWindow = new Window_Help(rect);
      this._helpWindow.setText('Create a New Guild\\nEnter a name and tag (2-5 characters)');
      this.addWindow(this._helpWindow);
    }

    helpWindowRect() {
      const wx = 0;
      const wy = this.mainAreaTop();
      const ww = Graphics.boxWidth;
      const wh = this.calcWindowHeight(2, false);
      return new Rectangle(wx, wy, ww, wh);
    }

    createNameWindow() {
      const rect = this.nameWindowRect();
      this._nameWindow = new Window_GuildNameEdit(rect);
      this._nameWindow.setHandler('ok', this.onNameOk.bind(this));
      this._nameWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._nameWindow);
    }

    nameWindowRect() {
      const ww = 400;
      const wh = this.calcWindowHeight(1, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = this.mainAreaTop() + this.calcWindowHeight(2, false) + 20;
      return new Rectangle(wx, wy, ww, wh);
    }

    createTagWindow() {
      const rect = this.tagWindowRect();
      this._tagWindow = new Window_GuildTagEdit(rect);
      this._tagWindow.setHandler('ok', this.onTagOk.bind(this));
      this._tagWindow.setHandler('cancel', this.onTagCancel.bind(this));
      this._tagWindow.deactivate();
      this._tagWindow.hide();
      this.addWindow(this._tagWindow);
    }

    tagWindowRect() {
      const ww = 200;
      const wh = this.calcWindowHeight(1, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = this.mainAreaTop() + this.calcWindowHeight(2, false) + 80;
      return new Rectangle(wx, wy, ww, wh);
    }

    createConfirmWindow() {
      const rect = this.confirmWindowRect();
      this._confirmWindow = new Window_GuildCreateConfirm(rect);
      this._confirmWindow.setHandler('create', this.onConfirmCreate.bind(this));
      this._confirmWindow.setHandler('cancel', this.onConfirmCancel.bind(this));
      this._confirmWindow.deactivate();
      this._confirmWindow.hide();
      this.addWindow(this._confirmWindow);
    }

    confirmWindowRect() {
      const ww = 300;
      const wh = this.calcWindowHeight(2, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = this.mainAreaTop() + this.calcWindowHeight(2, false) + 150;
      return new Rectangle(wx, wy, ww, wh);
    }

    start() {
      super.start();
      this._nameWindow.activate();
    }

    onNameOk() {
      this._guildName = this._nameWindow.name();
      if (this._guildName.length < 2) {
        SoundManager.playBuzzer();
        this._nameWindow.activate();
        return;
      }
      this._nameWindow.deactivate();
      this._tagWindow.show();
      this._tagWindow.activate();
    }

    onTagOk() {
      this._guildTag = this._tagWindow.tag();
      if (this._guildTag.length < 2 || this._guildTag.length > 5) {
        SoundManager.playBuzzer();
        this._tagWindow.activate();
        return;
      }
      this._tagWindow.deactivate();
      this._confirmWindow.setGuildInfo(this._guildName, this._guildTag);
      this._confirmWindow.show();
      this._confirmWindow.activate();
    }

    onTagCancel() {
      this._tagWindow.deactivate();
      this._tagWindow.hide();
      this._nameWindow.activate();
    }

    onConfirmCreate() {
      Guild.create(this._guildName, this._guildTag);
      this.popScene();
    }

    onConfirmCancel() {
      this._confirmWindow.deactivate();
      this._confirmWindow.hide();
      this._tagWindow.show();
      this._tagWindow.activate();
    }
  }

  // ============================================================================
  // SCENE: Guild Menu
  // ============================================================================

  class Scene_GuildMenu extends Scene_MenuBase {
    create() {
      super.create();
      this.createInfoWindow();
      this.createCommandWindow();
    }

    createInfoWindow() {
      const rect = this.infoWindowRect();
      this._infoWindow = new Window_GuildInfo(rect);
      this.addWindow(this._infoWindow);
    }

    infoWindowRect() {
      const wx = 0;
      const wy = this.mainAreaTop();
      const ww = Graphics.boxWidth;
      const wh = this.calcWindowHeight(4, false);
      return new Rectangle(wx, wy, ww, wh);
    }

    createCommandWindow() {
      const rect = this.commandWindowRect();
      this._commandWindow = new Window_GuildCommand(rect);
      this._commandWindow.setHandler('roster', this.cmdRoster.bind(this));
      this._commandWindow.setHandler('motd', this.cmdMotd.bind(this));
      this._commandWindow.setHandler('invite', this.cmdInvite.bind(this));
      this._commandWindow.setHandler('leave', this.cmdLeave.bind(this));
      this._commandWindow.setHandler('disband', this.cmdDisband.bind(this));
      this._commandWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._commandWindow);
    }

    commandWindowRect() {
      const ww = 300;
      const wh = this.calcWindowHeight(6, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = this.mainAreaTop() + this.calcWindowHeight(4, false) + 20;
      return new Rectangle(wx, wy, ww, wh);
    }

    cmdRoster() {
      SceneManager.push(Scene_GuildRoster);
    }

    cmdMotd() {
      SceneManager.push(Scene_GuildMotd);
    }

    cmdInvite() {
      // Invite a player by account username
      SceneManager.push(Scene_GuildInviteByUsername);
    }

    cmdLeave() {
      SceneManager.push(Scene_GuildLeaveConfirm);
    }

    cmdDisband() {
      SceneManager.push(Scene_GuildDisbandConfirm);
    }
  }

  // ============================================================================
  // SCENE: Guild Roster
  // ============================================================================

  class Scene_GuildRoster extends Scene_MenuBase {
    create() {
      super.create();
      this.createRosterWindow();
      this.createProfileWindow();
      this.createMemberCommandWindow();

      this._lastProfileIndex = null;

      this._rosterUpdateHandler = () => {
        if (this._rosterWindow) {
          this._rosterWindow.refresh();
        }
        this.updateProfileWindow(true);
      };
      Guild.on('rosterUpdated', this._rosterUpdateHandler);
      Guild.getRoster();
    }

    start() {
      super.start();
      this._rosterWindow.activate();
      // FIX: Check if items exist before selecting to prevent index error
      if (this._rosterWindow.maxItems() > 0) {
        this._rosterWindow.select(0);
      } else {
        this._rosterWindow.select(-1);
      }
      this.updateProfileWindow(true);
    }

    update() {
      super.update();
      this.updateProfileWindow(false);
    }

    terminate() {
      super.terminate();
      if (this._rosterUpdateHandler) {
        Guild.off('rosterUpdated', this._rosterUpdateHandler);
      }
    }

    createRosterWindow() {
      const rect = this.rosterWindowRect();
      this._rosterWindow = new Window_GuildRoster(rect);
      this._rosterWindow.setHandler('ok', this.onRosterOk.bind(this));
      this._rosterWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._rosterWindow);
    }

    createProfileWindow() {
      const rect = this.profileWindowRect();
      this._profileWindow = new Window_GuildMemberProfile(rect);
      this.addWindow(this._profileWindow);
    }

    rosterWindowRect() {
      const wx = 0;
      const wy = this.mainAreaTop();
      const ww = Graphics.boxWidth;
      const wh = this.mainAreaHeight();
      return new Rectangle(wx, wy, ww, wh);
    }

    profileWindowRect() {
      const ww = 360;
      const wh = this.calcWindowHeight(7, true);
      const wx = Graphics.boxWidth - ww;
      const wy = this.mainAreaTop();
      return new Rectangle(wx, wy, ww, wh);
    }

    updateProfileWindow(force) {
      if (!this._profileWindow || !this._rosterWindow) return;

      const idx = this._rosterWindow.index();
      if (!force && idx === this._lastProfileIndex) return;

      this._lastProfileIndex = idx;
      const member = (idx >= 0) ? this._rosterWindow.currentMember() : null;
      this._profileWindow.setMember(member);
    }

    createMemberCommandWindow() {
      const rect = this.memberCommandRect();
      this._memberCommandWindow = new Window_GuildMemberCommand(rect);
      this._memberCommandWindow.setHandler('promote', this.cmdPromote.bind(this));
      this._memberCommandWindow.setHandler('demote', this.cmdDemote.bind(this));
      this._memberCommandWindow.setHandler('kick', this.cmdKick.bind(this));
      this._memberCommandWindow.setHandler('note', this.cmdNote.bind(this));
      this._memberCommandWindow.setHandler('cancel', this.onMemberCancel.bind(this));
      this._memberCommandWindow.deactivate();
      this._memberCommandWindow.hide();
      this.addWindow(this._memberCommandWindow);
    }

    memberCommandRect() {
      const ww = 200;
      const wh = this.calcWindowHeight(5, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = (Graphics.boxHeight - wh) / 2;
      return new Rectangle(wx, wy, ww, wh);
    }

    onRosterOk() {
      const member = this._rosterWindow.currentMember();
      const myId = getMyUserId();
      if (member && member.oderId !== myId && member.userId !== myId) {
        this._selectedMember = member;
        this._memberCommandWindow.setMember(member);
        this._memberCommandWindow.show();
        this._memberCommandWindow.activate();
      } else {
        this._rosterWindow.activate();
      }
    }

    onMemberCancel() {
      this._memberCommandWindow.hide();
      this._memberCommandWindow.deactivate();
      this._rosterWindow.activate();
    }

    cmdPromote() {
      if (this._selectedMember) {
        Guild.promote(this._selectedMember.oderId);
      }
      this.onMemberCancel();
    }

    cmdDemote() {
      if (this._selectedMember) {
        Guild.demote(this._selectedMember.oderId);
      }
      this.onMemberCancel();
    }

    cmdKick() {
      if (this._selectedMember) {
        Guild.kick(this._selectedMember.oderId);
      }
      this.onMemberCancel();
    }

    cmdNote() {
      const member = this._selectedMember;
      this.onMemberCancel();

      if (!member) return;
      if (!Guild.hasPermission('editNotes')) {
        SoundManager.playBuzzer();
        return;
      }

      // Pass the member to the note edit scene via a global.
      window.__guildNoteTarget = member;
      SceneManager.push(Scene_GuildNoteEdit);
    }
  }

  // ============================================================================
  // SCENE: Member Note Edit
  // ============================================================================

  class Scene_GuildNoteEdit extends Scene_MenuBase {
    create() {
      super.create();

      this._target = window.__guildNoteTarget || null;
      if (!this._target) {
        this.popScene();
        return;
      }

      this.createHelpWindow();
      this.createEditWindow();

      const charName = this._target.characterName || this._target.username || this._target.name || 'Member';
      this._helpWindow.setText(`Set note for: ${charName}`);
    }

    helpWindowRect() {
      const wx = 0;
      const wy = this.mainAreaTop();
      const ww = Graphics.boxWidth;
      const wh = this.calcWindowHeight(1, false);
      return new Rectangle(wx, wy, ww, wh);
    }

    createEditWindow() {
      const rect = this.editWindowRect();
      this._editWindow = new Window_GuildNoteEdit(rect, this._target);
      this._editWindow.setHandler('ok', this.onEditOk.bind(this));
      this._editWindow.setHandler('cancel', this.onEditCancel.bind(this));
      this.addWindow(this._editWindow);
    }

    editWindowRect() {
      const ww = Math.min(700, Graphics.boxWidth - 80);
      const wh = this.calcWindowHeight(3, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = this._helpWindow.y + this._helpWindow.height + 24;
      return new Rectangle(wx, wy, ww, wh);
    }

    start() {
      super.start();
      this._editWindow.activate();
    }

    onEditOk() {
      const noteText = this._editWindow.getNote();
      const targetId = this._target.oderId ?? this._target.userId;
      Guild.setNote(targetId, noteText);
      window.__guildNoteTarget = null;
      this.popScene();
    }

    onEditCancel() {
      window.__guildNoteTarget = null;
      this.popScene();
    }
  }

  // ============================================================================
  // SCENE: Invite By Username
  // ============================================================================

  class Scene_GuildInviteByUsername extends Scene_MenuBase {
    create() {
      super.create();
      this.createEditWindow();
    }

    createEditWindow() {
      const rect = this.editWindowRect();
      this._editWindow = new Window_GuildUsernameEdit(rect);
      this._editWindow.setHandler('ok', this.onEditOk.bind(this));
      this._editWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._editWindow);
    }

    editWindowRect() {
      const ww = 500;
      const wh = this.calcWindowHeight(3, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = (Graphics.boxHeight - wh) / 2;
      return new Rectangle(wx, wy, ww, wh);
    }

    start() {
      super.start();
      this._editWindow.activate();
    }

    onEditOk() {
      const targetUsername = (this._editWindow.getUsername() || '').trim();

      if (!targetUsername) {
        SoundManager.playBuzzer();
        this._editWindow.activate();
        return;
      }

      if (!Guild.inGuild) {
        if (typeof $gameMessage !== 'undefined') $gameMessage.add('You are not in a guild.');
        this.popScene();
        return;
      }

      if (!Guild.canInvite()) {
        if (typeof $gameMessage !== 'undefined') $gameMessage.add('You do not have permission to invite.');
        this.popScene();
        return;
      }

      // Server supports username-only invite via g/invite [username]
      Guild.inviteByUsername(targetUsername);
      this.popScene();
    }
  }

  // ============================================================================
  // SCENE: MOTD Edit
  // ============================================================================

  class Scene_GuildMotd extends Scene_MenuBase {
    create() {
      super.create();
      this.createEditWindow();
    }

    createEditWindow() {
      const rect = this.editWindowRect();
      this._editWindow = new Window_GuildMotdEdit(rect);
      this._editWindow.setHandler('ok', this.onEditOk.bind(this));
      this._editWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._editWindow);
    }

    editWindowRect() {
      const ww = 500;
      const wh = this.calcWindowHeight(3, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = (Graphics.boxHeight - wh) / 2;
      return new Rectangle(wx, wy, ww, wh);
    }

    start() {
      super.start();
      this._editWindow.activate();
    }

    onEditOk() {
      const motd = this._editWindow.getMotd();
      Guild.setMotd(motd);
      this.popScene();
    }
  }

  // ============================================================================
  // SCENE: Leave Confirm
  // ============================================================================

  class Scene_GuildLeaveConfirm extends Scene_MenuBase {
    create() {
      super.create();
      this.createConfirmWindow();
    }

    createConfirmWindow() {
      const rect = this.confirmWindowRect();
      this._confirmWindow = new Window_GuildLeaveConfirm(rect);
      this._confirmWindow.setHandler('yes', this.onYes.bind(this));
      this._confirmWindow.setHandler('no', this.popScene.bind(this));
      this._confirmWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._confirmWindow);
    }

    confirmWindowRect() {
      const ww = 350;
      const wh = this.calcWindowHeight(3, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = (Graphics.boxHeight - wh) / 2;
      return new Rectangle(wx, wy, ww, wh);
    }

    onYes() {
      Guild.leave();
      SceneManager.goto(Scene_Map);
    }
  }

  // ============================================================================
  // SCENE: Disband Confirm
  // ============================================================================

  class Scene_GuildDisbandConfirm extends Scene_MenuBase {
    create() {
      super.create();
      this.createConfirmWindow();
    }

    createConfirmWindow() {
      const rect = this.confirmWindowRect();
      this._confirmWindow = new Window_GuildDisbandConfirm(rect);
      this._confirmWindow.setHandler('yes', this.onYes.bind(this));
      this._confirmWindow.setHandler('no', this.popScene.bind(this));
      this._confirmWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._confirmWindow);
    }

    confirmWindowRect() {
      const ww = 400;
      const wh = this.calcWindowHeight(4, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = (Graphics.boxHeight - wh) / 2;
      return new Rectangle(wx, wy, ww, wh);
    }

    onYes() {
      Guild.disband();
      SceneManager.goto(Scene_Map);
    }
  }

  // ============================================================================
  // SCENE: Guild Invites Inbox
  // ============================================================================

  class Scene_GuildInvites extends Scene_MenuBase {
    create() {
      super.create();
      this.createHelpWindow();
      this.createInviteListWindow();
      this.createCommandWindow();
      this._refreshHandler = () => this._inviteListWindow.refresh();
      Guild.on('invitesUpdated', this._refreshHandler);
    }

    start() {
      super.start();
      this._inviteListWindow.activate();
      if (this._inviteListWindow.maxItems() > 0) {
        this._inviteListWindow.select(0);
      } else {
        this._inviteListWindow.select(-1);
      }
    }


    terminate() {
      super.terminate();
      Guild.off('invitesUpdated', this._refreshHandler);
    }

    createHelpWindow() {
      const rect = this.helpWindowRect();
      this._helpWindow = new Window_Help(rect);
      this._helpWindow.setText('Guild Invitations - Select an invite to accept or decline');
      this.addWindow(this._helpWindow);
    }

    helpWindowRect() {
      const wx = 0;
      const wy = 0;
      const ww = Graphics.boxWidth;
      const wh = this.calcWindowHeight(1, false);
      return new Rectangle(wx, wy, ww, wh);
    }

    createInviteListWindow() {
      const rect = this.inviteListWindowRect();
      this._inviteListWindow = new Window_GuildInviteList(rect);
      this._inviteListWindow.setHandler('ok', this.onInviteSelect.bind(this));
      this._inviteListWindow.setHandler('cancel', this.popScene.bind(this));
      this.addWindow(this._inviteListWindow);
    }

    inviteListWindowRect() {
      const wx = 0;
      const wy = this._helpWindow.y + this._helpWindow.height;
      const ww = Graphics.boxWidth;
      const wh = Graphics.boxHeight - wy - this.calcWindowHeight(1, true);
      return new Rectangle(wx, wy, ww, wh);
    }

    createCommandWindow() {
      const rect = this.commandWindowRect();
      this._commandWindow = new Window_GuildInviteCommand(rect);
      this._commandWindow.setHandler('accept', this.onAccept.bind(this));
      this._commandWindow.setHandler('decline', this.onDecline.bind(this));
      this._commandWindow.setHandler('cancel', this.onCommandCancel.bind(this));
      this._commandWindow.deactivate();
      this._commandWindow.hide();
      this.addWindow(this._commandWindow);
    }

    commandWindowRect() {
      const ww = 200;
      const wh = this.calcWindowHeight(3, true);
      const wx = (Graphics.boxWidth - ww) / 2;
      const wy = (Graphics.boxHeight - wh) / 2;
      return new Rectangle(wx, wy, ww, wh);
    }

    onInviteSelect() {
      const invite = this._inviteListWindow.currentInvite();
      if (invite) {
        this._selectedInvite = invite;
        this._commandWindow.show();
        this._commandWindow.activate();
        this._commandWindow.select(0);
      }
    }

    onAccept() {
      if (this._selectedInvite) {
        Guild.acceptInvite(this._selectedInvite.guildId);
        // Wait for response then close
        const handler = (data) => {
          Guild.off('joined', handler);
          Guild.off('error', errorHandler);
          SceneManager.goto(Scene_Map);
        };
        const errorHandler = (data) => {
          if (data.command === 'accept') {
            Guild.off('joined', handler);
            Guild.off('error', errorHandler);
            this._commandWindow.hide();
            this._commandWindow.deactivate();
            this._inviteListWindow.activate();
            if (typeof $gameMessage !== 'undefined') {
              $gameMessage.add(`\\C[2]Error:\\C[0] ${data.error || 'Failed to accept invite'}`);
            }
          }
        };
        Guild.on('joined', handler);
        Guild.on('error', errorHandler);
      }
    }

    onDecline() {
      if (this._selectedInvite) {
        Guild.declineInvite(this._selectedInvite.guildId);
        this._commandWindow.hide();
        this._commandWindow.deactivate();
        this._inviteListWindow.refresh();
        this._inviteListWindow.activate();
        this._selectedInvite = null;
      }
    }

    onCommandCancel() {
      this._commandWindow.hide();
      this._commandWindow.deactivate();
      this._inviteListWindow.activate();
      this._selectedInvite = null;
    }
  }

  class Window_GuildInviteList extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._data = [];
      this.refresh();
    }

    maxItems() { return this._data.length; }

    currentInvite() { return this._data[this.index()]; }

    refresh() {
      this._data = Guild.invites || [];
      this.createContents();
      this.drawAllItems();
      // If list is empty, show message
      if (this._data.length === 0) {
        this.drawEmptyMessage();
      }
    }

    drawEmptyMessage() {
      const rect = this.itemLineRect(0);
      this.changeTextColor(ColorManager.systemColor());
      this.drawText('No pending invitations', rect.x, rect.y, rect.width, 'center');
      this.resetTextColor();
    }

    drawItem(index) {
      const invite = this._data[index];
      if (!invite) return;
      const rect = this.itemLineRect(index);
      
      // Format: [TAG] Guild Name - invited by InviterName
      const tagText = invite.guildTag ? `[${invite.guildTag}] ` : '';
      const line1 = `${tagText}${invite.guildName}`;
      const line2 = `  \\C[8]invited by ${invite.inviterName}\\C[0]`;
      
      this.drawTextEx(line1, rect.x, rect.y, rect.width);
    }

    itemHeight() {
      return this.lineHeight();
    }
  }

  class Window_GuildInviteCommand extends Window_Command {
    initialize(rect) {
      super.initialize(rect);
    }

    makeCommandList() {
      this.addCommand('Accept', 'accept');
      this.addCommand('Decline', 'decline');
      this.addCommand('Cancel', 'cancel');
    }
  }

  // ============================================================================
  // WINDOWS
  // ============================================================================

  //===========================================================================
  // MMO_TextEntry - capture raw keyboard characters for text entry windows
  // Prevents Z/X (OK/Cancel) from firing while typing.
  //===========================================================================
    const MMO_TextEntry = (() => {
      // V2: tracks scene + auto-detaches to avoid Z/X getting "stuck" after closing a text window.
      if (window.__MMO_TextEntry && window.__MMO_TextEntry.__isMMOTextEntryV2) return window.__MMO_TextEntry;

      const state = { owner: null, handler: null, scene: null };

      function currentScene() {
        try { return SceneManager ? SceneManager._scene : null; } catch (e) { return null; }
      }

      function attach(owner, handler) {
        state.owner = owner || null;
        state.handler = (typeof handler === 'function') ? handler : null;
        state.scene = currentScene();
      }

      function detach(owner) {
        if (!owner || state.owner === owner) {
          state.owner = null;
          state.handler = null;
          state.scene = null;
        }
      }

      function shouldAutoDetach() {
        if (!state.handler) return false;

        const scn = currentScene();
        if (state.scene && scn && scn !== state.scene) return true;

        const o = state.owner;
        if (!o) return true;
        if (o._destroyed) return true;
        if (o.parent == null) return true;
        if (o.visible === false) return true;
        if (o.active === false) return true;

        return false;
      }

      window.addEventListener('keydown', (event) => {
        if (state.handler && shouldAutoDetach()) {
          detach(); // clear stuck handler
        }
        if (!state.handler) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;

        const key = event.key;

        // Only intercept keys that could be "typed" so they don't trigger OK/Cancel.
        if (key === 'Backspace' || key === 'Delete' || key.length === 1) {
          const handled = !!state.handler(key, event);
          if (handled) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }
      }, true); // capture phase

      window.__MMO_TextEntry = { attach, detach, __isMMOTextEntryV2: true };
      return window.__MMO_TextEntry;
    })();

class Window_GuildTextInput extends Window_Selectable {
    initialize(rect, options = {}) {
      this._text = options.defaultText || '';
      this._maxLength = options.maxLength || 24;
      this._minLength = options.minLength || 2;
      this._uppercase = options.uppercase || false;
      this._allowSpaces = options.allowSpaces !== false;
      this._label = options.label || 'Text';
      this._cursorVisible = true;
      this._cursorCount = 0;
      super.initialize(rect);
      this.refresh();
    }

    text() { return this._text; }
    
    setText(text) {
      this._text = text;
      this.refresh();
    }

    isValid() {
      return this._text.length >= this._minLength && this._text.length <= this._maxLength;
    }

    maxItems() { return 1; }

    update() {
      super.update();
      if (this.active) {
        this._cursorCount++;
        if (this._cursorCount >= 30) {
          this._cursorCount = 0;
          this._cursorVisible = !this._cursorVisible;
          this.refresh();
        }
      }
    }

    activate() {
      super.activate();
      MMO_TextEntry.attach(this, this.onTextKey.bind(this));
      this._cursorVisible = true;
      this._cursorCount = 0;
      this.refresh();
      return this;
    }

    deactivate() {
      MMO_TextEntry.detach(this);
      super.deactivate();
      this.refresh();
      return this;
    }

    onTextKey(key) {
      // Always swallow typed keys so Z/X can't trigger OK/Cancel while editing.
      if (key === 'Backspace' || key === 'Delete') {
        if (this._text.length > 0) {
          this._text = this._text.slice(0, -1);
          SoundManager.playCancel();
          this.refresh();
        }
        return true;
      }

      if (key.length === 1) {
        const isLetter = /^[a-zA-Z]$/.test(key);
        const isNumber = /^[0-9]$/.test(key);
        const isSpace = key === ' ' && this._allowSpaces;

        if ((isLetter || isNumber || isSpace) && this._text.length < this._maxLength) {
          let char = key;
          if (this._uppercase) char = char.toUpperCase();
          this._text += char;
          SoundManager.playCursor();
          this.refresh();
        } else {
          // Still swallow the key even if we ignore it (prevents OK/Cancel side effects).
        }
        return true;
      }

      return false;
    }


    drawItem(index) {
      const rect = this.itemLineRect(index);
      this.contents.clear();

      // Extra padding to account for thicker windowskins
      const padX = 4;

      const displayText = this._text + (this._cursorVisible && this.active ? '|' : '');
      const labelText = this._label + ': ';

      this.changeTextColor(ColorManager.systemColor());
      this.drawText(labelText, rect.x + padX, rect.y, 80);

      this.changeTextColor(ColorManager.normalColor());
      if (this._text.length === 0 && !this.active) {
        this.changeTextColor(ColorManager.textColor(8));
        this.drawText('(click to type)', rect.x + 80 + padX, rect.y, rect.width - 80 - padX);
      } else {
        this.drawText(displayText, rect.x + 80 + padX, rect.y, rect.width - 80 - padX);
      }

      const countText = `${this._text.length}/${this._maxLength}`;
      const countColor = this.isValid() ? ColorManager.textColor(3) : ColorManager.textColor(18);
      this.changeTextColor(countColor);
      this.drawText(countText, rect.x + padX, rect.y, rect.width - padX * 2, 'right');
    }

    refresh() {
      this.contents.clear();
      this.drawItem(0);
    }

    processOk() {
      if (this.isValid()) {
        this.playOkSound();
        this.callOkHandler();
      } else {
        SoundManager.playBuzzer();
      }
    }
  }

  class Window_GuildNameEdit extends Window_GuildTextInput {
    initialize(rect) {
      super.initialize(rect, {
        maxLength: 24,
        minLength: 2,
        uppercase: false,
        allowSpaces: true,
        label: 'Name'
      });
    }

    name() { return this.text(); }
  }

  class Window_GuildTagEdit extends Window_GuildTextInput {
    initialize(rect) {
      super.initialize(rect, {
        maxLength: 5,
        minLength: 2,
        uppercase: true,
        allowSpaces: false,
        label: 'Tag'
      });
    }

    tag() { return this.text(); }
  }

  class Window_GuildUsernameEdit extends Window_GuildTextInput {
    initialize(rect) {
      super.initialize(rect, {
        maxLength: 24,
        minLength: 2,
        uppercase: false,
        allowSpaces: false,
        label: 'Username'
      });
    }

    getUsername() { return this.text(); }
  }

  class Window_GuildCreateConfirm extends Window_Command {
    initialize(rect) {
      this._guildName = '';
      this._guildTag = '';
      super.initialize(rect);
    }

    setGuildInfo(name, tag) {
      this._guildName = name;
      this._guildTag = tag;
      this.refresh();
    }

    makeCommandList() {
      this.addCommand(`Create [${this._guildTag}] ${this._guildName}`, 'create');
      this.addCommand('Cancel', 'cancel');
    }
  }

  class Window_GuildInfo extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this.refresh();
    }

    refresh() {
      this.contents.clear();
      const data = Guild.data;
      if (!data) {
        this.drawText('Loading...', 0, 0, this.innerWidth);
        return;
      }
      const lh = this.lineHeight();
      this.drawText(`[${data.tag}] ${data.name}`, 0, 0, this.innerWidth, 'center');
      this.drawText(`Level: ${data.level || 1}  |  Members: ${data.memberCount || '?'}`, 0, lh, this.innerWidth, 'center');
      this.drawText(`MotD: ${data.motd || 'None'}`, 0, lh * 2, this.innerWidth);
    }
  }

  class Window_GuildCommand extends Window_Command {
    makeCommandList() {
      this.addCommand('Roster', 'roster');
      this.addCommand('Message of the Day', 'motd', Guild.hasPermission('editMotd'));
      this.addCommand('Invite Player', 'invite', Guild.hasPermission('invite'));
      this.addCommand('Leave Guild', 'leave', !Guild.isLeader());
      this.addCommand('Disband Guild', 'disband', Guild.isLeader());
    }
  }

  class Window_GuildRoster extends Window_Selectable {
    initialize(rect) {
      super.initialize(rect);
      this._data = [];
      this.refresh();
    }

    maxItems() { return this._data.length; }

    currentMember() { return this._data[this.index()]; }

    refresh() {
      this._data = Guild.roster || [];
      this.createContents();
      this.drawAllItems();
    }

    drawItem(index) {
      const member = this._data[index];
      if (!member) return;
      const rect = this.itemLineRect(index);
      const online = member.isOnline ? '\\c[3]●\\c[0]' : '\\c[8]○\\c[0]';
      // Show characterName (accountName) if different, otherwise just the name
      const charName = member.characterName || member.name;
      const acctName = member.username || member.name;
      const displayName = (charName !== acctName) ? `${charName} (${acctName})` : charName;
      const text = `${online} [${member.rankName}] ${displayName}`;
      this.drawTextEx(text, rect.x, rect.y, rect.width);
    }
  }

  class Window_GuildMemberCommand extends Window_Command {
    initialize(rect) {
      this._member = null;
      super.initialize(rect);
    }

    setMember(member) {
      this._member = member;
      this.refresh();
    }

    makeCommandList() {
      const canPromote = Guild.hasPermission('promote') && Guild.canActOn(this._member?.oderId);
      const canDemote = Guild.hasPermission('demote') && Guild.canActOn(this._member?.oderId);
      const canKick = Guild.hasPermission('kick') && Guild.canActOn(this._member?.oderId);
      const canNote = Guild.hasPermission('editNotes');

      this.addCommand('Promote', 'promote', canPromote);
      this.addCommand('Demote', 'demote', canDemote);
      this.addCommand('Kick', 'kick', canKick);
      this.addCommand('Set Note', 'note', canNote);
      this.addCommand('Cancel', 'cancel');
    }
  }

  // ============================================================================
  // WINDOW: Member Profile (top-right overlay)
  // ============================================================================

  class Window_GuildMemberProfile extends Window_Base {
    initialize(rect) {
      super.initialize(rect);
      this._member = null;
      this.refresh();
    }

    setMember(member) {
      this._member = member || null;
      this.refresh();
    }

    refresh() {
      this.contents.clear();

      const padX = 4;
      const w = this.innerWidth - padX * 2;
      const lh = this.lineHeight();
      let y = 0;

      this.changeTextColor(ColorManager.systemColor());
      this.drawText('Member', padX, y, w, 'center');
      y += lh;

      const m = this._member;
      if (!m) {
        this.resetTextColor();
        this.drawText('—', padX, y, w, 'center');
        return;
      }

      const charName = m.characterName || m.username || m.name || 'Unknown';
      const acctName = m.username || m.name || charName;
      const nameLine = (acctName && acctName !== charName) ? `${charName} (${acctName})` : charName;

      this.resetTextColor();
      this.drawText(`Rank: ${m.rankName || 'Member'}`, padX, y, w);
      y += lh;

      this.drawText(`Status: ${m.isOnline ? 'Online' : 'Offline'}`, padX, y, w);
      y += lh;

      this.drawText(nameLine, padX, y, w);
      y += lh;

      this.changeTextColor(ColorManager.systemColor());
      this.drawText('Note:', padX, y, w);
      y += lh;

      this.resetTextColor();
      const note = (m.note != null && String(m.note).trim() !== '') ? String(m.note) : '(No note)';
      this.drawWrappedText(note, padX, y, w, this.innerHeight - y);
    }

    drawWrappedText(text, x, y, width, height) {
      const lh = this.lineHeight();
      const maxLines = Math.max(1, Math.floor(height / lh));
      const lines = this.wrapText(String(text || ''), width);

      const count = Math.min(lines.length, maxLines);
      for (let i = 0; i < count; i++) {
        this.drawText(lines[i], x, y + lh * i, width);
      }

      if (lines.length > maxLines) {
        const lastY = y + lh * (maxLines - 1);
        let last = lines[maxLines - 1] || '';
        while (last.length > 0 && this.textWidth(last + '…') > width) {
          last = last.slice(0, -1);
        }
        this.drawText(last + '…', x, lastY, width);
      }
    }

    wrapText(text, width) {
      const words = text.replace(/\r/g, '').split(/\s+/);
      const lines = [];
      let line = '';

      for (const word of words) {
        if (!word) continue;
        const test = line ? `${line} ${word}` : word;

        if (this.textWidth(test) <= width) {
          line = test;
          continue;
        }

        if (line) lines.push(line);

        // Hard-wrap very long "words"
        if (this.textWidth(word) > width) {
          let chunk = '';
          for (const ch of word) {
            const testChunk = chunk + ch;
            if (this.textWidth(testChunk) <= width) {
              chunk = testChunk;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          line = chunk;
        } else {
          line = word;
        }
      }

      if (line) lines.push(line);
      return lines;
    }
  }

  // ============================================================================
  // WINDOW: Note Edit
  // ============================================================================

  class Window_GuildNoteEdit extends Window_GuildTextInput {
    initialize(rect, member) {
      const defaultText = (member && member.note != null) ? String(member.note) : '';
      super.initialize(rect, {
        maxLength: 200,
        minLength: 0,
        uppercase: false,
        allowSpaces: true,
        label: 'Note',
        defaultText
      });
    }

    getNote() { return this.text(); }

    isValid() { return true; }
  }

  class Window_GuildMotdEdit extends Window_GuildTextInput {
    initialize(rect) {
      super.initialize(rect, {
        maxLength: 500,
        minLength: 0,
        uppercase: false,
        allowSpaces: true,
        label: 'MotD',
        defaultText: Guild.data?.motd || ''
      });
    }

    getMotd() { return this.text(); }

    isValid() { return true; }
  }

  class Window_GuildLeaveConfirm extends Window_Command {
    makeCommandList() {
      this.addCommand('Leave Guild', 'yes');
      this.addCommand('Cancel', 'no');
    }

    drawItem(index) {
      if (index === 0) {
        const rect = this.itemLineRect(index);
        this.drawText('Are you sure you want to leave?', rect.x, rect.y - this.lineHeight(), rect.width, 'center');
      }
      super.drawItem(index);
    }
  }

  class Window_GuildDisbandConfirm extends Window_Command {
    makeCommandList() {
      this.addCommand('DISBAND GUILD', 'yes');
      this.addCommand('Cancel', 'no');
    }

    drawItem(index) {
      if (index === 0) {
        const rect = this.itemLineRect(index);
        this.changeTextColor(ColorManager.textColor(2));
        this.drawText('WARNING: This cannot be undone!', rect.x, rect.y - this.lineHeight() * 2, rect.width, 'center');
        this.drawText('All members will be removed.', rect.x, rect.y - this.lineHeight(), rect.width, 'center');
        this.resetTextColor();
      }
      super.drawItem(index);
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  Guild.canActOn = function(targetId) {
    if (!this.inGuild || !this._roster || !targetId) return false;
    const myRank = this.myRank;
    const target = this._roster.find(m => String(m.oderId ?? m.userId) === String(targetId));
    if (!myRank || !target) return false;
    const targetRank = this._data.ranks?.find(r => r.id === target.rankId);
    if (!targetRank) return false;
    return myRank.priority < targetRank.priority;
  };

  // ============================================================================
  // PLUGIN COMMANDS
  // ============================================================================

  PluginManager.registerCommand(pluginName, 'open', args => {
    Guild.open();
  });

  PluginManager.registerCommand(pluginName, 'openCreate', args => {
    Guild.openCreate();
  });

  PluginManager.registerCommand(pluginName, 'openMenu', args => {
    Guild.openMenu();
  });

  PluginManager.registerCommand(pluginName, 'openRoster', args => {
    Guild.openRoster();
  });

  PluginManager.registerCommand(pluginName, 'checkInGuild', args => {
    const switchId = Number(args.switchId) || 1;
    $gameSwitches.setValue(switchId, Guild.checkInGuildCached());
  });

  PluginManager.registerCommand(pluginName, 'checkIsLeader', args => {
    const switchId = Number(args.switchId) || 2;
    $gameSwitches.setValue(switchId, Guild.checkIsLeaderCached());
  });

  PluginManager.registerCommand(pluginName, 'leave', args => {
    Guild.leave();
  });

  PluginManager.registerCommand(pluginName, 'disband', args => {
    Guild.disband();
  });

  PluginManager.registerCommand(pluginName, 'sendChat', args => {
    Guild.chat(args.message);
  });

  PluginManager.registerCommand(pluginName, 'openInvites', args => {
    // Open invites inside the Mail Requests tab (preferred).
    // Falls back to legacy Scene_GuildInvites if the Mail plugin isn't installed.
    if (window.MMO_MailUI && typeof window.MMO_MailUI.open === 'function') {
      window.MMO_MailUI.open('requests');
      return;
    }

    // Legacy fallback
    Guild.getInvites();
    SceneManager.push(Scene_GuildInvites);
  });

  // Export scenes
  window.Scene_GuildCreate = Scene_GuildCreate;
  window.Scene_GuildMenu = Scene_GuildMenu;
  window.Scene_GuildRoster = Scene_GuildRoster;
  window.Scene_GuildMotd = Scene_GuildMotd;
  window.Scene_GuildLeaveConfirm = Scene_GuildLeaveConfirm;
  window.Scene_GuildDisbandConfirm = Scene_GuildDisbandConfirm;
  window.Scene_GuildInvites = Scene_GuildInvites;

  // ============================================================================
  // INTERACTION INTEGRATION (Fix for missing Guild option)
  // ============================================================================
  
  function registerInteraction() {
    // The interaction menu system (DotMove bridge, party, trade, etc.) uses window._interaction (Map)
    if (!window._interaction) window._interaction = new Map();

    window._interaction.set('Guild Invite', (user, name) => {
      if (!Guild.inGuild) {
        if (typeof $gameMessage !== 'undefined') $gameMessage.add('You are not in a guild.');
        return;
      }
      if (!Guild.canInvite()) {
        if (typeof $gameMessage !== 'undefined') $gameMessage.add('You do not have permission to invite.');
        return;
      }
      Guild.invite(user, name);
      if (typeof $gameMessage !== 'undefined') $gameMessage.add(`Invited ${name} to guild.`);
    });

    console.log('[Guild] Interaction registered');
  }

  registerInteraction();

  

  console.log('[MMORPG_Guild] Plugin loaded v1.3.1 (guild map-sync integration)');

})();
