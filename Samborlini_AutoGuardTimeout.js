/*:
 * @target MZ
 * @plugindesc [Version 1.0] Auto-Guard after idle time in battle with customizable warning. Resets timer instantly on input confirm.
 * @author Samborlini
 *
 * @param Warning Time
 * @type number
 * @min 1
 * @max 120
 * @default 25
 * @desc Time in seconds before showing the warning message.

 * @param Auto Guard Time
 * @type number
 * @min 1
 * @max 300
 * @default 30
 * @desc Time in seconds before the actor auto-guards.

 * @param Warning Message
 * @type string
 * @default You are taking too long... Guarding soon!
 * @desc The warning message shown before auto-guard. Wait and auto-close codes added automatically.

 * @help
 * Starts a timer during battle input. If no action is chosen within the auto guard time,
 * the actor auto-guards. A warning message appears before that.
 * Timer resets immediately when player confirms an action, preventing auto-guard on next turn.
 */

(() => {
    const pluginName = document.currentScript.src.match(/([^\/]+)\.js$/)[1];

    const parameters = PluginManager.parameters(pluginName);
    const WARNING_SECONDS = Number(parameters["Warning Time"] || 25);
    const GUARD_SECONDS = Number(parameters["Auto Guard Time"] || 30);
    let warningMessage = String(parameters["Warning Message"] || "You are taking too long... Guarding soon!");

    if (!warningMessage.includes("\\|")) warningMessage += "\\|";
    if (!warningMessage.includes("\\^")) warningMessage += "\\^";

    const WARNING_TIME = WARNING_SECONDS * 60;
    const IDLE_LIMIT = GUARD_SECONDS * 60;

    const AutoGuardTimer = {
        idleTimer: 0,
        warned: false,
        isTracking: false,
        alreadyStarted: false
    };

    const _BattleManager_startInput = BattleManager.startInput;
    BattleManager.startInput = function() {
        if (!AutoGuardTimer.alreadyStarted) {
            AutoGuardTimer.isTracking = true;
            AutoGuardTimer.idleTimer = 0;
            AutoGuardTimer.warned = false;
            AutoGuardTimer.alreadyStarted = true;
        }
        _BattleManager_startInput.call(this);
    };

    // Reset timer immediately when an action is confirmed
    const _BattleManager_selectNextCommand = BattleManager.selectNextCommand;
    BattleManager.selectNextCommand = function() {
        // Reset timer here on action confirmation (before selecting next)
        AutoGuardTimer.idleTimer = 0;
        AutoGuardTimer.warned = false;
        _BattleManager_selectNextCommand.call(this);
    };

    const _BattleManager_endInput = BattleManager.endInput;
    BattleManager.endInput = function() {
        _BattleManager_endInput.call(this);

        if (this._phase !== "input" || !this._actorIndexValid()) {
            AutoGuardTimer.isTracking = false;
            AutoGuardTimer.idleTimer = 0;
            AutoGuardTimer.warned = false;
            AutoGuardTimer.alreadyStarted = false;
        }
    };

    BattleManager._actorIndexValid = function() {
        return this._actorIndex >= 0 && this._actorIndex < $gameParty.battleMembers().length;
    };

    const _Scene_Battle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function() {
        _Scene_Battle_update.call(this);

        if (AutoGuardTimer.isTracking && BattleManager.isInputting()) {
            AutoGuardTimer.idleTimer++;

            if (AutoGuardTimer.idleTimer >= WARNING_TIME && !AutoGuardTimer.warned) {
                AutoGuardTimer.warned = true;
                $gameMessage.add(warningMessage);
            }

            if (AutoGuardTimer.idleTimer >= IDLE_LIMIT) {
                this.forceAutoGuard();
                AutoGuardTimer.idleTimer = 0;
                AutoGuardTimer.warned = false;
                AutoGuardTimer.isTracking = false;
                AutoGuardTimer.alreadyStarted = false;
            }
        }
    };

    Scene_Battle.prototype.forceAutoGuard = function() {
        const actor = BattleManager.actor();
        if (actor) {
            const action = new Game_Action(actor);
            action.setGuard();
            actor.setAction(0, action);
            this._actorCommandWindow.close();
            this._actorCommandWindow.deactivate();
            this.selectNextCommand();
        }
    };
})();