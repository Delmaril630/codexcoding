/*!
 * /*:
 * @target MZ
 * @plugindesc Time
 * @author R.Malizia
 * @url https://rmalizia44.itch.io/
 * @help
 *
 * ⚔️ MMORPG Maker Plugin 0.9.3
 *
 * This plugin gets a global time, multiplies it by the configured scale
 * value, and calculates a new date. The calculated date's day, month, hour,
 * and minute are stored in game variables configured in the plugin parameters.
 * These variables will not sync.
 *
 * WARNING: when you change the scale, you change the current game time
 *
 * 💖 Special Thanks to Our Patrons!
 *
 * A huge shout-out to everyone supporting the project through Patreon!
 * Your contributions help keep this plugin alive and growing. Here are
 * the amazing supporters from each tier:
 *
 * 🏆 Champion Tier
 *
 * - Emerson
 * - little_kaiba
 * - fanao2
 *
 * 🌟 Legendary Tier
 *
 * - Alexis Naboulet
 * - Ansgar
 * - Samborlini
 * - Georgy
 * - Sephsta
 * - Frapstery
 *
 * ✨ Epic Tier
 *
 * - James Shmo
 * - Lupilo
 * - Richard and Adam
 * - Mr.Timbaba
 *
 * @param scale
 * @name Scale
 * @type number
 * @min 0.01
 * @decimals 2
 * @desc Adjust to scale how quickly time passes.
 * @default 1.0
 *
 * @param timestamp
 * @name Timestamp Variable ID
 * @type variable
 * @desc Variable to store the timestamp in seconds.
 * @default 0
 *
 * @param hour
 * @name Hour Variable ID
 * @type variable
 * @desc Variable to store the calculated hour.
 * @default 0
 *
 * @param minute
 * @name Minute Variable ID
 * @type variable
 * @desc Variable to store the calculated minute.
 * @default 0
 *
 * @param day
 * @name Day Variable ID
 * @type variable
 * @desc Variable to store the calculated day.
 * @default 0
 *
 * @param month
 * @name Month Variable ID
 * @type variable
 * @desc Variable to store the calculated month.
 * @default 0
 *
 */(()=>{"use strict";const external_window_namespaceObject=window;const pluginName="MMORPG_Time";const parameters=external_window_namespaceObject.PluginManager.parameters(pluginName);const scale=Number(parameters["scale"]);const timestamp=Number(parameters["timestamp"]);const day=Number(parameters["day"]);const month=Number(parameters["month"]);const hour=Number(parameters["hour"]);const minute=Number(parameters["minute"]);function updateGameVariables(){const ms=Date.now()*scale;const date=new Date(ms);if(timestamp){external_window_namespaceObject.$gameVariables.setValue(timestamp,Math.floor(ms/1e3))}if(day){external_window_namespaceObject.$gameVariables.setValue(day,date.getUTCDate())}if(month){external_window_namespaceObject.$gameVariables.setValue(month,date.getUTCMonth()+1)}if(hour){external_window_namespaceObject.$gameVariables.setValue(hour,date.getUTCHours())}if(minute){external_window_namespaceObject.$gameVariables.setValue(minute,date.getUTCMinutes())}}const Game_Variables_syncType=external_window_namespaceObject.Game_Variables.prototype.syncType;external_window_namespaceObject.Game_Variables.prototype.syncType=function(id){switch(id){case timestamp:case day:case month:case hour:case minute:return"";default:return Game_Variables_syncType.call(this,id)}};const Scene_Base_update=external_window_namespaceObject.Scene_Base.prototype.update;external_window_namespaceObject.Scene_Base.prototype.update=function(){Scene_Base_update.call(this);updateGameVariables()}})();