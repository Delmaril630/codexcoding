/*!
 * /*:
 * @target MZ
 * @plugindesc Switches, Variables
 * @author R.Malizia
 * @url https://rmalizia44.itch.io/
 * @help
 *
 * ⚔️ MMORPG Maker Plugin 0.9.3
 *
 * Using <Sync> on a switch or variable will save it to the database,
 * allowing each player’s data to be preserved across sessions. These
 * synchronized switches and variables are player-specific and do not
 * affect other players' gameplay states.
 *
 * By adding <global>, a switch or variable becomes universally unique
 * across the entire game, with any changes instantly affecting every
 * player.
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
 * @base MMORPG_Client
 * @orderAfter MMORPG_Client
 *
 * @param allowStringVariables
 * @text Allow String Variables
 * @type boolean
 * @desc Whether variables should support string values
 * @default false
 *
 */(()=>{"use strict";const external_window_namespaceObject=window;const client=window.client;const instance=client;external_window_namespaceObject.Game_Switches.prototype.sync=function(){if(!this._sync){this._sync=new Map}return this._sync};external_window_namespaceObject.Game_Switches.prototype.syncFind=function(name){name=name.toLowerCase();if(name.includes("<sync>")){return"sync"}if(name.includes("<global>")){return"global"}return""};external_window_namespaceObject.Game_Switches.prototype.syncType=function(id){let value=this.sync().get(id);if(value===undefined){const name=external_window_namespaceObject.$dataSystem.switches[id];value=name?this.syncFind(name):"";this.sync().set(id,value)}return value};external_window_namespaceObject.Game_Switches.prototype.syncIsGlobal=function(id){return this.syncType(id)==="global"};external_window_namespaceObject.Game_Switches.prototype.rawSet=external_window_namespaceObject.Game_Switches.prototype.setValue;const Game_Switches_initialize=external_window_namespaceObject.Game_Switches.prototype.initialize;external_window_namespaceObject.Game_Switches.prototype.initialize=function(){Game_Switches_initialize.call(this);const sync=this.sync();external_window_namespaceObject.$dataSystem.switches.forEach((name,id)=>{sync.set(id,name?this.syncFind(name):"")})};external_window_namespaceObject.Game_Switches.prototype.setValue=function(id,value){const oldValue=this.value(id);this.rawSet(id,value);if(!this.isValidId(id)||!this.isValidValue(value)){console.error("can't save invalid switch:",id,value);return}if(oldValue===value){return}if(!this.syncType(id)){return}const global=this.syncIsGlobal(id);instance.save(global,"switch",{[id]:value});if(!global){return}instance.broadcast(true,"switch",id,value)};external_window_namespaceObject.Game_Switches.prototype.isValidId=function(id){if(typeof id!=="number"){return false}if(!Number.isSafeInteger(id)){return false}if(id<=0){return false}if(id>=external_window_namespaceObject.$dataSystem.switches.length){return false}return true};external_window_namespaceObject.Game_Switches.prototype.isValidValue=function(value){if(typeof value!=="boolean"){return false}return true};function updateSwitches(global,data){for(const key in data){const value=data[key];const id=Number(key);if(global!==external_window_namespaceObject.$gameSwitches.syncIsGlobal(id)){console.error("incompatible switch:",id,value);continue}if(!external_window_namespaceObject.$gameSwitches.isValidId(id)){console.error("incompatible switch id:",id,value);continue}if(!external_window_namespaceObject.$gameSwitches.isValidValue(value)){console.error("incompatible switch value:",id,value);continue}external_window_namespaceObject.$gameSwitches.rawSet(id,value)}}instance.start(false,"switch",data=>updateSwitches(false,data));instance.start(true,"switch",data=>updateSwitches(true,data));instance.react(external_window_namespaceObject.Scene_Base,"*","switch",(scene,from,key,value)=>{const id=Number(key);if(!external_window_namespaceObject.$gameSwitches.isValidId(id)){return instance.report(from,"switch invalid id")}if(!external_window_namespaceObject.$gameSwitches.isValidValue(value)){return instance.report(from,"switch invalid value")}if(!external_window_namespaceObject.$gameSwitches.syncIsGlobal(id)){return instance.report(from,"switch incompatible")}external_window_namespaceObject.$gameSwitches.rawSet(id,value)});function allowStringVariables(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Progress")["allowStringVariables"]=="true"}external_window_namespaceObject.Game_Variables.prototype.sync=function(){if(!this._sync){this._sync=new Map}return this._sync};external_window_namespaceObject.Game_Variables.prototype.syncFind=function(name){name=name.toLowerCase();if(name.includes("<sync>")){return"sync"}if(name.includes("<global>")){return"global"}return""};external_window_namespaceObject.Game_Variables.prototype.syncType=function(id){let value=this.sync().get(id);if(value===undefined){const name=external_window_namespaceObject.$dataSystem.variables[id];value=name?this.syncFind(name):"";this.sync().set(id,value)}return value};external_window_namespaceObject.Game_Variables.prototype.syncIsGlobal=function(id){return this.syncType(id)==="global"};external_window_namespaceObject.Game_Variables.prototype.rawSet=external_window_namespaceObject.Game_Variables.prototype.setValue;const Game_Variables_initialize=external_window_namespaceObject.Game_Variables.prototype.initialize;external_window_namespaceObject.Game_Variables.prototype.initialize=function(){Game_Variables_initialize.call(this);const sync=this.sync();external_window_namespaceObject.$dataSystem.variables.forEach((name,id)=>{sync.set(id,name?this.syncFind(name):"")})};external_window_namespaceObject.Game_Variables.prototype.setValue=function(id,value){const oldValue=this.value(id);this.rawSet(id,value);if(!this.isValidId(id)||!this.isValidValue(value)){console.error("can't save invalid variable:",id,value);return}if(oldValue===value){return}if(!this.syncType(id)){return}const global=this.syncIsGlobal(id);instance.save(global,"variable",{[id]:value});if(!global){return}instance.broadcast(true,"variable",id,value)};external_window_namespaceObject.Game_Variables.prototype.isValidId=function(id){if(typeof id!=="number"){return false}if(!Number.isSafeInteger(id)){return false}if(id<=0){return false}if(id>=external_window_namespaceObject.$dataSystem.variables.length){return false}return true};external_window_namespaceObject.Game_Variables.prototype.isValidValue=function(value){if(typeof value==="number"){}else{if(!allowStringVariables()||typeof value!=="string"){return false}}return true};function updateVariables(global,data){for(const key in data){const value=data[key];const id=Number(key);if(global!==external_window_namespaceObject.$gameVariables.syncIsGlobal(id)){console.error("incompatible variable:",id,value);continue}if(!external_window_namespaceObject.$gameVariables.isValidId(id)){console.error("incompatible variable id:",id,value);continue}if(!external_window_namespaceObject.$gameVariables.isValidValue(value)){console.error("incompatible variable value:",id,value);continue}external_window_namespaceObject.$gameVariables.rawSet(id,value)}}instance.start(false,"variable",data=>updateVariables(false,data));instance.start(true,"variable",data=>updateVariables(true,data));instance.react(external_window_namespaceObject.Scene_Base,"*","variable",(scene,from,key,value)=>{const id=Number(key);if(!external_window_namespaceObject.$gameVariables.isValidId(id)){return instance.report(from,"variable invalid id")}if(!external_window_namespaceObject.$gameVariables.isValidValue(value)){return instance.report(from,"variable invalid value")}if(!external_window_namespaceObject.$gameVariables.syncIsGlobal(id)){return instance.report(from,"variable incompatible")}external_window_namespaceObject.$gameVariables.rawSet(id,value)})})();