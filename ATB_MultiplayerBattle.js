/*:
 * @target MZ
 * @plugindesc ATB Multiplayer Battle Sync — Network relay, state reconciliation [Phase 5]
 * @author Claude / Nate
 * @orderAfter ATB_Core
 * @orderAfter ATB_SpriteExtension
 * @orderAfter ATB_Movement
 * @orderAfter ATB_SpatialSkills
 * @orderAfter ATB_EnemyAI
 * @orderAfter ATB_BattleUI
 *
 * @param POSITION_SYNC_RATE
 * @text Position Sync Rate (frames)
 * @desc How often to send position updates during movement
 * @type number
 * @default 5
 *
 * @param RECONNECT_TIMEOUT
 * @text Reconnect Timeout (ms)
 * @desc Time before disconnected player becomes AI-controlled
 * @type number
 * @default 60000
 *
 * @param ENABLE_MULTIPLAYER_BATTLE
 * @text Enable Multiplayer Battle
 * @type boolean
 * @default true
 *
 * @help
 * ============================================================================
 * ATB_MultiplayerBattle.js — Phase 5: Multiplayer Battle Sync
 * ============================================================================
 *
 * Integrates the ATB battle system with the existing MMORPG networking
 * infrastructure (window.client). Uses the established pubsub pattern:
 *
 *  - Subscribe to 'battle' group channel when battle starts
 *  - PUBLISH to battle channel: actions, movement, state updates
 *  - Server intercepts via battle.js for validation
 *  - REACT to battle channel: receive other players' inputs
 *  - SENDTO for direct battle invites/accepts
 *
 * Authority Model: "Relay with validation"
 *  - Clients compute ATB fill, damage, positions locally
 *  - Server validates damage ranges, position bounds, action legality
 *  - Server rejects anomalous inputs and broadcasts corrections
 *
 * Network Protocol:
 *  Client → Server (PUBLISH to 'battle' group):
 *    btl/action    — Player chose an action (skillId, targetIds, position)
 *    btl/move      — Position update during movement (x, y, gaugeLeft)
 *    btl/move_end  — Movement completed
 *    btl/guard     — Player started guarding
 *    btl/escape    — Player initiated escape
 *    btl/ready     — Player's ATB gauge filled (for verification)
 *    btl/state     — Periodic full state snapshot (HP, MP, ATB, pos)
 *
 *  Server → Client (via battle channel RECV):
 *    btl/validated — Action validated and should execute
 *    btl/rejected  — Action rejected (cheat attempt or desync)
 *    btl/sync      — Authoritative state correction
 *    btl/peer_move — Other player's position update
 *    btl/peer_act  — Other player's validated action
 *    btl/end       — Battle ended (result from server)
 *    btl/dc        — Player disconnected
 *    btl/rc        — Player reconnected
 *
 * Falls back gracefully to single-player when no network is available.
 */

(() => {
  'use strict';
  const ATB = window.ATB;
  if (!ATB) throw new Error('ATB_MultiplayerBattle requires ATB_Core');

  const p = PluginManager.parameters('ATB_MultiplayerBattle');
  const SYNC_RATE       = parseInt(p['POSITION_SYNC_RATE'] || '5');
  const RECONNECT_MS    = parseInt(p['RECONNECT_TIMEOUT']  || '60000');
  const ENABLED         = p['ENABLE_MULTIPLAYER_BATTLE'] !== 'false';

  // ========================================================================
  //  STATE
  // ========================================================================

  const MultiSync = {
    _active: false,             // Currently in a multiplayer battle
    _battleChannel: null,       // Battle channel ID (e.g. "battle_abc123")
    _partyPeers: new Map(),     // peerId -> { userId, actorIndex, lastUpdate, connected }
    _syncCounter: 0,            // Frame counter for periodic sync
    _stateCounter: 0,           // Frame counter for full state snapshots
    _pendingActions: [],        // Actions waiting for server validation
    _localPlayerId: null,       // Our own userId
    _localActorIndex: 0,        // Which party slot we control
    _reactorsRegistered: false,
    _disconnectedPeers: new Map() // userId -> { timestamp, aiActive }
  };

  // ========================================================================
  //  1. CLIENT API HELPERS
  // ========================================================================

  function getClient() {
    return window.client || null;
  }

  function publish(code, args) {
    const c = getClient();
    if (c && MultiSync._active) {
      c.publish('battle', code, args || []);
    }
  }

  function sendTo(targetUserId, code, args) {
    const c = getClient();
    if (c) {
      c.sendto(targetUserId, code, args || []);
    }
  }

  function subscribe(channel) {
    const c = getClient();
    if (c) c.subscribe('battle', channel);
  }

  function unsubscribe() {
    const c = getClient();
    if (c) c.subscribe('battle', null);
  }

  // ========================================================================
  //  2. BATTLE LIFECYCLE — Join/Leave battle channels
  // ========================================================================

  MultiSync.startMultiplayerBattle = function(battleChannel, partyData) {
    if (!ENABLED || !getClient()) return;

    this._active = true;
    this._battleChannel = battleChannel;
    this._localPlayerId = getClient().userId || getClient().id;
    this._syncCounter = 0;
    this._stateCounter = 0;
    this._pendingActions = [];
    this._partyPeers.clear();
    this._disconnectedPeers.clear();

    // Parse party data: [{ userId, actorIndex, username }, ...]
    if (partyData) {
      for (const pd of partyData) {
        if (pd.userId === this._localPlayerId) {
          this._localActorIndex = pd.actorIndex;
        } else {
          this._partyPeers.set(pd.userId, {
            userId: pd.userId,
            actorIndex: pd.actorIndex,
            username: pd.username,
            lastUpdate: Date.now(),
            connected: true
          });
        }
      }
    }

    // Subscribe to battle channel
    subscribe(battleChannel);
    this._registerReactors();

    // Send initial state
    this._sendFullState();

    console.log('[ATB_MP] Joined multiplayer battle:', battleChannel);
  };

  MultiSync.endMultiplayerBattle = function() {
    if (!this._active) return;
    this._active = false;
    unsubscribe();
    this._partyPeers.clear();
    this._disconnectedPeers.clear();
    this._pendingActions = [];
    console.log('[ATB_MP] Left multiplayer battle');
  };

  // ========================================================================
  //  3. REACTOR REGISTRATION — Listen for server/peer messages
  // ========================================================================

  MultiSync._registerReactors = function() {
    if (this._reactorsRegistered) return;
    const c = getClient();
    if (!c) return;
    this._reactorsRegistered = true;

    // Peer action validated by server
    c.react('battle', 'btl/peer_act', (from, args) => {
      this._onPeerAction(from, args[0]);
    });

    // Peer movement update
    c.react('battle', 'btl/peer_move', (from, args) => {
      this._onPeerMove(from, args[0]);
    });

    // Server validated our action
    c.react('battle', 'btl/validated', (from, args) => {
      this._onActionValidated(args[0]);
    });

    // Server rejected our action
    c.react('battle', 'btl/rejected', (from, args) => {
      this._onActionRejected(args[0]);
    });

    // Server state correction
    c.react('battle', 'btl/sync', (from, args) => {
      this._onStateSync(args[0]);
    });

    // Battle ended
    c.react('battle', 'btl/end', (from, args) => {
      this._onBattleEnd(args[0]);
    });

    // Player disconnect/reconnect
    c.react('battle', 'btl/dc', (from, args) => {
      this._onPeerDisconnect(args[0]);
    });

    c.react('battle', 'btl/rc', (from, args) => {
      this._onPeerReconnect(args[0]);
    });

    // Channel join/leave notifications
    c.react('battle', '+', (from, args) => {
      console.log('[ATB_MP] Player joined battle:', from);
    });

    c.react('battle', '-', (from, args) => {
      console.log('[ATB_MP] Player left battle:', from);
      if (this._partyPeers.has(from)) {
        this._onPeerDisconnect({ userId: from });
      }
    });
  };

  // ========================================================================
  //  4. OUTBOUND — Send local actions/movement to server
  // ========================================================================

  MultiSync.sendAction = function(actor, action) {
    if (!this._active) return;
    if (!this._isLocalActor(actor)) return;

    const data = {
      actorIndex: $gameParty.battleMembers().indexOf(actor),
      skillId: action.item() ? action.item().id : 0,
      targetIndices: action._targetIndex !== undefined ? [action._targetIndex] : [],
      isAttack: action.isAttack(),
      isGuard: action.isGuard(),
      isItem: action.isItem(),
      position: { x: actor._battleX, y: actor._battleY },
      atbGauge: actor._atbGauge,
      timestamp: Date.now()
    };

    // Optimistic: execute locally immediately
    this._pendingActions.push({ id: data.timestamp, data });

    publish('btl/action', [data]);
  };

  MultiSync.sendMovement = function(actor) {
    if (!this._active) return;
    if (!this._isLocalActor(actor)) return;

    publish('btl/move', [{
      actorIndex: $gameParty.battleMembers().indexOf(actor),
      x: actor._battleX,
      y: actor._battleY,
      atbGauge: actor._atbGauge,
      moving: actor._atbMoving
    }]);
  };

  MultiSync.sendMoveEnd = function(actor) {
    if (!this._active) return;
    if (!this._isLocalActor(actor)) return;

    publish('btl/move_end', [{
      actorIndex: $gameParty.battleMembers().indexOf(actor),
      x: actor._battleX,
      y: actor._battleY,
      atbGauge: actor._atbGauge
    }]);
  };

  MultiSync.sendGuard = function(actor) {
    if (!this._active) return;
    if (!this._isLocalActor(actor)) return;

    publish('btl/guard', [{
      actorIndex: $gameParty.battleMembers().indexOf(actor),
      atbGauge: actor._atbGauge
    }]);
  };

  MultiSync.sendEscape = function(actor) {
    if (!this._active) return;
    if (!this._isLocalActor(actor)) return;

    publish('btl/escape', [{
      actorIndex: $gameParty.battleMembers().indexOf(actor)
    }]);
  };

  MultiSync._sendFullState = function() {
    if (!this._active) return;

    const members = $gameParty.battleMembers();
    const localActor = members[this._localActorIndex];
    if (!localActor) return;

    publish('btl/state', [{
      actorIndex: this._localActorIndex,
      hp: localActor.hp,
      mp: localActor.mp,
      tp: localActor.tp,
      atbGauge: localActor._atbGauge,
      x: localActor._battleX,
      y: localActor._battleY,
      states: localActor._states.slice(),
      casting: localActor._atbCasting,
      guarding: localActor._atbGuarding,
      escaping: localActor._atbEscaping,
      dead: localActor.isDead()
    }]);
  };

  // ========================================================================
  //  5. INBOUND — Handle messages from server/peers
  // ========================================================================

  MultiSync._onPeerAction = function(from, data) {
    if (!this._active || !data) return;
    const peer = this._partyPeers.get(from);
    if (!peer) return;
    peer.lastUpdate = Date.now();

    const actor = $gameParty.battleMembers()[data.actorIndex];
    if (!actor) return;

    // Apply peer's action
    const action = new Game_Action(actor);
    if (data.isAttack) action.setAttack();
    else if (data.isGuard) action.setGuard();
    else if (data.isItem) action.setItem(data.skillId);
    else action.setSkill(data.skillId);

    if (data.targetIndices && data.targetIndices.length > 0) {
      action._targetIndex = data.targetIndices[0];
    }

    // Queue for execution
    actor._actions = [action];
    BattleManager.atbQueueAction(actor);
  };

  MultiSync._onPeerMove = function(from, data) {
    if (!this._active || !data) return;
    const peer = this._partyPeers.get(from);
    if (!peer) return;
    peer.lastUpdate = Date.now();

    const actor = $gameParty.battleMembers()[data.actorIndex];
    if (!actor) return;

    // Smoothly interpolate to peer's position
    actor._atbTargetX = data.x;
    actor._atbTargetY = data.y;
    actor._atbGauge = data.atbGauge;
    actor._atbMoving = data.moving;
  };

  MultiSync._onActionValidated = function(data) {
    if (!data) return;
    // Remove from pending — action was accepted
    this._pendingActions = this._pendingActions.filter(a => a.id !== data.timestamp);
  };

  MultiSync._onActionRejected = function(data) {
    if (!data) return;
    console.warn('[ATB_MP] Action rejected by server:', data.reason);
    // Rollback: could restore gauge, cancel action
    // For now just log — full rollback is complex
    this._pendingActions = this._pendingActions.filter(a => a.id !== data.timestamp);

    // If server says our gauge isn't ready, correct it
    if (data.correctedGauge !== undefined) {
      const actor = $gameParty.battleMembers()[this._localActorIndex];
      if (actor) actor._atbGauge = data.correctedGauge;
    }
  };

  MultiSync._onStateSync = function(data) {
    if (!data) return;
    // Server is sending authoritative state — apply corrections
    const actor = $gameParty.battleMembers()[data.actorIndex];
    if (!actor) return;

    // Only apply corrections for peers, not ourselves (unless forced)
    if (data.actorIndex === this._localActorIndex && !data.forced) return;

    if (data.hp !== undefined) actor._hp = data.hp;
    if (data.mp !== undefined) actor._mp = data.mp;
    if (data.atbGauge !== undefined) actor._atbGauge = data.atbGauge;
    if (data.x !== undefined) actor._battleX = data.x;
    if (data.y !== undefined) actor._battleY = data.y;
    if (data.dead && !actor.isDead()) actor.die();
  };

  MultiSync._onBattleEnd = function(data) {
    if (!data) return;
    console.log('[ATB_MP] Battle ended:', data.result);
    // Server says battle is over — trigger local end
    if (data.result === 'victory') {
      BattleManager.processVictory();
    } else if (data.result === 'defeat') {
      BattleManager.processDefeat();
    } else if (data.result === 'escape') {
      BattleManager.processEscape();
    }
    this.endMultiplayerBattle();
  };

  MultiSync._onPeerDisconnect = function(data) {
    if (!data || !data.userId) return;
    const peer = this._partyPeers.get(data.userId);
    if (!peer) return;
    peer.connected = false;

    this._disconnectedPeers.set(data.userId, {
      timestamp: Date.now(),
      aiActive: false
    });

    console.log('[ATB_MP] Peer disconnected:', data.userId);

    // Show notification
    if (SceneManager._scene && SceneManager._scene._logWindow) {
      const name = peer.username || 'Player';
      SceneManager._scene._logWindow.push('addText', name + ' disconnected!');
    }
  };

  MultiSync._onPeerReconnect = function(data) {
    if (!data || !data.userId) return;
    const peer = this._partyPeers.get(data.userId);
    if (peer) {
      peer.connected = true;
      peer.lastUpdate = Date.now();
    }
    this._disconnectedPeers.delete(data.userId);

    console.log('[ATB_MP] Peer reconnected:', data.userId);

    // Send full state for reconciliation
    this._sendFullState();
  };

  // ========================================================================
  //  6. UPDATE LOOP — Periodic sync, disconnect detection, AI takeover
  // ========================================================================

  MultiSync.update = function() {
    if (!this._active) return;

    this._syncCounter++;
    this._stateCounter++;

    // Position sync during movement
    if (this._syncCounter >= SYNC_RATE) {
      this._syncCounter = 0;
      const actor = $gameParty.battleMembers()[this._localActorIndex];
      if (actor && actor._atbMoving) {
        this.sendMovement(actor);
      }
    }

    // Full state snapshot every 5 seconds (300 frames at 60fps)
    if (this._stateCounter >= 300) {
      this._stateCounter = 0;
      this._sendFullState();
    }

    // Interpolate peer positions smoothly
    this._interpolatePeers();

    // Check for disconnect timeouts → AI takeover
    this._checkDisconnects();
  };

  MultiSync._interpolatePeers = function() {
    for (const [userId, peer] of this._partyPeers) {
      const actor = $gameParty.battleMembers()[peer.actorIndex];
      if (!actor || !actor._atbTargetX) continue;

      // Lerp toward target position
      const dx = actor._atbTargetX - actor._battleX;
      const dy = actor._atbTargetY - actor._battleY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        const speed = Math.min(dist, ATB.MOVEMENT_WALK_SPEED * 1.5);
        actor._battleX += (dx / dist) * speed;
        actor._battleY += (dy / dist) * speed;
      } else {
        actor._battleX = actor._atbTargetX;
        actor._battleY = actor._atbTargetY;
      }
    }
  };

  MultiSync._checkDisconnects = function() {
    const now = Date.now();
    for (const [userId, dc] of this._disconnectedPeers) {
      if (dc.aiActive) continue;
      if (now - dc.timestamp > RECONNECT_MS) {
        // Timeout reached — activate AI for this player's actor
        dc.aiActive = true;
        const peer = this._partyPeers.get(userId);
        if (peer) {
          console.log('[ATB_MP] AI takeover for disconnected peer:', userId);
          if (SceneManager._scene && SceneManager._scene._logWindow) {
            const name = peer.username || 'Player';
            SceneManager._scene._logWindow.push('addText', name + ' → AI control');
          }
        }
      }
    }
  };

  // Check if a battler's actor is controlled by us or by AI (disconnect)
  MultiSync._isLocalActor = function(actor) {
    const idx = $gameParty.battleMembers().indexOf(actor);
    return idx === this._localActorIndex;
  };

  MultiSync.isPeerActor = function(actor) {
    if (!this._active) return false;
    const idx = $gameParty.battleMembers().indexOf(actor);
    if (idx === this._localActorIndex) return false;
    for (const [userId, peer] of this._partyPeers) {
      if (peer.actorIndex === idx) return true;
    }
    return false;
  };

  MultiSync.isAITakeover = function(actor) {
    if (!this._active) return false;
    const idx = $gameParty.battleMembers().indexOf(actor);
    for (const [userId, peer] of this._partyPeers) {
      if (peer.actorIndex === idx) {
        const dc = this._disconnectedPeers.get(userId);
        return dc ? dc.aiActive : false;
      }
    }
    return false;
  };

  // ========================================================================
  //  7. BATTLE INVITE / ACCEPT FLOW — Pre-battle P2P signaling
  // ========================================================================

  MultiSync.sendBattleInvite = function(targetUserId, troopId) {
    const channel = 'btl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    sendTo(targetUserId, 'battle/invite', [{
      fromUserId: this._localPlayerId || (getClient() && getClient().userId),
      fromName: $gameActors.actor(1) ? $gameActors.actor(1).name() : 'Player',
      troopId: troopId,
      channel: channel
    }]);
    this._pendingInviteChannel = channel;
    this._pendingInviteTroop = troopId;
  };

  MultiSync.acceptBattleInvite = function(inviteData) {
    sendTo(inviteData.fromUserId, 'battle/accept', [{
      channel: inviteData.channel,
      userId: this._localPlayerId || (getClient() && getClient().userId),
      username: $gameActors.actor(1) ? $gameActors.actor(1).name() : 'Player'
    }]);

    // Both players join the battle channel
    const partyData = [
      { userId: inviteData.fromUserId, actorIndex: 0, username: inviteData.fromName },
      { userId: this._localPlayerId, actorIndex: 1, username: $gameActors.actor(1)?.name() || 'Player' }
    ];

    // Start the troop battle
    BattleManager.setup(inviteData.troopId, false, false);
    SceneManager.push(Scene_Battle);

    // Delayed start after scene is ready
    setTimeout(() => {
      this.startMultiplayerBattle(inviteData.channel, partyData);
    }, 500);
  };

  MultiSync.declineBattleInvite = function(inviteData) {
    sendTo(inviteData.fromUserId, 'battle/decline', [{
      reason: 'declined'
    }]);
  };

  // Register invite listener
  MultiSync._registerInviteListener = function() {
    const c = getClient();
    if (!c) return;

    c.react('@', 'battle/invite', (from, args) => {
      const data = args[0];
      if (!data) return;
      console.log('[ATB_MP] Battle invite from:', data.fromName);
      // Store for UI to pick up
      ATB._pendingBattleInvite = data;
    });

    c.react('@', 'battle/accept', (from, args) => {
      const data = args[0];
      if (!data) return;
      console.log('[ATB_MP] Battle invite accepted by:', data.username);

      // Start the battle we invited for
      if (this._pendingInviteChannel) {
        const partyData = [
          { userId: this._localPlayerId, actorIndex: 0, username: $gameActors.actor(1)?.name() || 'Player' },
          { userId: data.userId, actorIndex: 1, username: data.username }
        ];

        BattleManager.setup(this._pendingInviteTroop, false, false);
        SceneManager.push(Scene_Battle);

        setTimeout(() => {
          this.startMultiplayerBattle(this._pendingInviteChannel, partyData);
        }, 500);

        this._pendingInviteChannel = null;
        this._pendingInviteTroop = null;
      }
    });

    c.react('@', 'battle/decline', (from, args) => {
      console.log('[ATB_MP] Battle invite declined');
      this._pendingInviteChannel = null;
      this._pendingInviteTroop = null;
    });
  };

  // ========================================================================
  //  8. HOOKS — Integrate with ATB_Core's BattleManager
  // ========================================================================

  // Hook into BattleManager.update for periodic sync
  const _BM_update_mp = BattleManager.update;
  BattleManager.update = function(timeActive) {
    _BM_update_mp.call(this, timeActive);
    MultiSync.update();
  };

  // Hook into battle start/end
  const _BM_startBattle_mp = BattleManager.startBattle;
  BattleManager.startBattle = function() {
    _BM_startBattle_mp.call(this);
    // If we're not already in a multiplayer battle, this is a solo encounter
    // MultiSync stays inactive
  };

  const _BM_endBattle_mp = BattleManager.endBattle;
  BattleManager.endBattle = function(result) {
    if (MultiSync._active) {
      publish('btl/end', [{ result: result === 0 ? 'victory' : result === 1 ? 'escape' : 'defeat' }]);
      MultiSync.endMultiplayerBattle();
    }
    _BM_endBattle_mp.call(this, result);
  };

  // Hook into action confirmation to send over network
  const _BM_confirmAtbAction_mp = BattleManager.confirmAtbAction;
  BattleManager.confirmAtbAction = function(actor) {
    if (MultiSync._active && MultiSync._isLocalActor(actor)) {
      const action = actor.currentAction();
      if (action) MultiSync.sendAction(actor, action);
    }
    _BM_confirmAtbAction_mp.call(this, actor);
  };

  // Hook into guard for network
  const _GB_startAtbGuard_mp = Game_Battler.prototype.startAtbGuard;
  Game_Battler.prototype.startAtbGuard = function() {
    _GB_startAtbGuard_mp.call(this);
    if (this.isActor()) MultiSync.sendGuard(this);
  };

  // Hook into escape for network
  const _BM_startAtbEscape_mp = BattleManager.startAtbEscape;
  BattleManager.startAtbEscape = function() {
    _BM_startAtbEscape_mp.call(this);
    const actor = $gameParty.battleMembers()[MultiSync._localActorIndex];
    if (actor) MultiSync.sendEscape(actor);
  };

  // Hook into movement end
  const _GB_stopMovement_mp = Game_Battler.prototype.stopMovement;
  Game_Battler.prototype.stopMovement = function() {
    _GB_stopMovement_mp.call(this);
    if (this.isActor()) MultiSync.sendMoveEnd(this);
  };

  // Skip command window for peer-controlled actors
  const _BM_updateAtb_mp = BattleManager.updateAtb;
  BattleManager.updateAtb = function() {
    _BM_updateAtb_mp.call(this);

    // If it's a peer actor's turn, don't open our command window
    if (this._atbActiveActor && MultiSync.isPeerActor(this._atbActiveActor)) {
      // Peer controls this actor — skip local command window
      this._atbActiveActor = null;
    }

    // AI takeover for disconnected peers
    if (MultiSync._active) {
      for (const actor of $gameParty.battleMembers()) {
        if (MultiSync.isAITakeover(actor) && actor.isAtbReady()) {
          if (!actor._atbCasting && !actor._atbGuarding && !actor._atbMoving) {
            // Simple AI: attack nearest enemy
            const action = new Game_Action(actor);
            action.setAttack();
            const enemies = $gameTroop.aliveMembers();
            if (enemies.length > 0) {
              action._targetIndex = 0;
              actor._actions = [action];
              BattleManager.atbQueueAction(actor);
            }
          }
        }
      }
    }
  };

  // ========================================================================
  //  9. INITIALIZATION
  // ========================================================================

  // Register invite listeners when client is ready
  const _SM_onSceneStart = SceneManager.onSceneStart;
  SceneManager.onSceneStart = function() {
    if (_SM_onSceneStart) _SM_onSceneStart.call(this);
    if (getClient() && !MultiSync._inviteListenerReady) {
      MultiSync._registerInviteListener();
      MultiSync._inviteListenerReady = true;
    }
  };

  // ========================================================================
  //  10. EXPORTS
  // ========================================================================

  ATB.MultiSync = MultiSync;

})();
