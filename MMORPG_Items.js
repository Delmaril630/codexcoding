/*!
 * /*:
 * @target MZ
 * @plugindesc Weapons, Armors, Items, Gold
 * @author R.Malizia
 * @url https://rmalizia44.itch.io/
 * @help
 *
 * ⚔️ MMORPG Maker Plugin 0.9.3
 *
 * All player inventory items—including weapons, armors, items, and
 * gold—are synchronized, ensuring a unified experience across sessions
 * and for all players.
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
 */(()=>{"use strict";const external_window_namespaceObject=window;function log(...args){if(true){return}}const src_log=log;const client=window.client;const instance=client;function gameIndependents(){return window.$gameIndependents}function getNextId(){const gi=gameIndependents();if(!gi){return 0}return gi._independentId}function updateNextId(id){const gi=gameIndependents();if(!gi){return}if(id>=gi._independentId){gi._independentId=id+1;src_log("dmIndepId update:",gi._independentId)}}function itemDiff(newItem,oldItem){const result=[];for(const key of Object.keys(newItem)){if(key=="id"||key=="_deepCopy"){continue}const newValue=newItem[key];const oldValue=oldItem[key];if(JSON.stringify(newValue)==JSON.stringify(oldValue)){continue}result.push([key,newValue])}return Object.fromEntries(result)}function buildItem(oldItem,id,diff){const copy=external_window_namespaceObject.JsonEx.makeDeepCopy(oldItem);copy.id=id;return Object.assign(copy,diff)}function saveItem(id){const oldId=external_window_namespaceObject.$dataItems[id].originalId;const oldItem=external_window_namespaceObject.$dataItems[oldId];const diff=itemDiff(external_window_namespaceObject.$dataItems[id],oldItem);src_log("dmIndepItems save:",id,diff);instance.save(false,"dmIndepItems",{[id]:diff})}function saveWeapon(id){const oldId=external_window_namespaceObject.$dataWeapons[id].originalId;const oldItem=external_window_namespaceObject.$dataWeapons[oldId];const diff=itemDiff(external_window_namespaceObject.$dataWeapons[id],oldItem);src_log("dmIndepWeapons save:",id,diff);instance.save(false,"dmIndepWeapons",{[id]:diff})}function saveArmor(id){const oldId=external_window_namespaceObject.$dataArmors[id].originalId;const oldItem=external_window_namespaceObject.$dataArmors[oldId];const diff=itemDiff(external_window_namespaceObject.$dataArmors[id],oldItem);src_log("dmIndepArmors save:",id,diff);instance.save(false,"dmIndepArmors",{[id]:diff})}function updateChanges(oldValue){const gi=gameIndependents();if(!gi){return}const newValue=getNextId();if(oldValue==newValue){return}const id=newValue-1;if(external_window_namespaceObject.$dataItems[id]){saveItem(id)}if(external_window_namespaceObject.$dataWeapons[id]){saveWeapon(id)}if(external_window_namespaceObject.$dataArmors[id]){saveArmor(id)}}const Game_Actor_tradeItemWithParty=external_window_namespaceObject.Game_Actor.prototype.tradeItemWithParty;external_window_namespaceObject.Game_Actor.prototype.tradeItemWithParty=function(newItem,oldItem){const id=getNextId();const result=Game_Actor_tradeItemWithParty.call(this,newItem,oldItem);updateChanges(id);return result};const Game_Interpreter_command126=external_window_namespaceObject.Game_Interpreter.prototype.command126;external_window_namespaceObject.Game_Interpreter.prototype.command126=function(params){const id=getNextId();const result=Game_Interpreter_command126.call(this,params);updateChanges(id);return result};const Game_Interpreter_command127=external_window_namespaceObject.Game_Interpreter.prototype.command127;external_window_namespaceObject.Game_Interpreter.prototype.command127=function(params){const id=getNextId();const result=Game_Interpreter_command127.call(this,params);updateChanges(id);return result};const Game_Interpreter_command128=external_window_namespaceObject.Game_Interpreter.prototype.command128;external_window_namespaceObject.Game_Interpreter.prototype.command128=function(params){const id=getNextId();const result=Game_Interpreter_command128.call(this,params);updateChanges(id);return result};const Scene_Shop_doBuy=external_window_namespaceObject.Scene_Shop.prototype.doBuy;external_window_namespaceObject.Scene_Shop.prototype.doBuy=function(number){const id=getNextId();const result=Scene_Shop_doBuy.call(this,number);updateChanges(id);return result};const Game_Party_applyRandomStats=external_window_namespaceObject.Game_Party.prototype.applyRandomStats;external_window_namespaceObject.Game_Party.prototype.applyRandomStats=function(item){Game_Party_applyRandomStats.call(this,item);item.firstStatRoll=true;if(!item.originalId){return}const id=item.id;if(external_window_namespaceObject.DataManager.isItem(item)){saveItem(id)}if(external_window_namespaceObject.DataManager.isWeapon(item)){saveWeapon(id)}if(external_window_namespaceObject.DataManager.isArmor(item)){saveArmor(id)}};instance.start(false,"dmIndepItems",data=>{for(const[sid,diff]of Object.entries(data)){src_log("dmIndepItems load:",sid,diff);const newId=Number(sid);const oldId=diff.originalId;external_window_namespaceObject.$dataItems[newId]=buildItem(external_window_namespaceObject.$dataItems[oldId],newId,diff);updateNextId(newId)}});instance.start(false,"dmIndepWeapons",data=>{for(const[sid,diff]of Object.entries(data)){src_log("dmIndepWeapons load:",sid,diff);const newId=Number(sid);const oldId=diff.originalId;external_window_namespaceObject.$dataWeapons[newId]=buildItem(external_window_namespaceObject.$dataWeapons[oldId],newId,diff);updateNextId(newId)}});instance.start(false,"dmIndepArmors",data=>{for(const[sid,diff]of Object.entries(data)){src_log("dmIndepArmors load:",sid,diff);const newId=Number(sid);const oldId=diff.originalId;external_window_namespaceObject.$dataArmors[newId]=buildItem(external_window_namespaceObject.$dataArmors[oldId],newId,diff);updateNextId(newId)}});external_window_namespaceObject.Game_Party.prototype.rawGainGold=external_window_namespaceObject.Game_Party.prototype.gainGold;external_window_namespaceObject.Game_Party.prototype.gainGold=function(amount){const oldNumber=this.gold();this.rawGainGold(amount);const newNumber=this.gold();if(oldNumber===newNumber){return}instance.save(false,"gold",{gold:newNumber})};external_window_namespaceObject.Game_Party.prototype.rawGainItem=external_window_namespaceObject.Game_Party.prototype.gainItem;external_window_namespaceObject.Game_Party.prototype.gainItem=function(item,amount,includeEquip){const oldNumber=this.numItems(item);this.rawGainItem(item,amount,includeEquip);const newNumber=this.numItems(item);if(oldNumber===newNumber){return}if(external_window_namespaceObject.DataManager.isItem(item)){instance.save(false,"item",{[item.id]:newNumber})}else if(external_window_namespaceObject.DataManager.isWeapon(item)){instance.save(false,"weapon",{[item.id]:newNumber})}else if(external_window_namespaceObject.DataManager.isArmor(item)){instance.save(false,"armor",{[item.id]:newNumber})}};function makeItemRecord(data){const entries=[];for(const k in data){const amount=data[k];const id=Number(k);if(!Number.isSafeInteger(id)||typeof amount!=="number"){continue}if(!amount){continue}entries.push([id,amount])}return Object.fromEntries(entries)}instance.start(false,"gold",data=>{const{gold}=data;if(typeof gold!=="number"){return src_log("no gold")}external_window_namespaceObject.$gameParty._gold=gold});instance.start(false,"item",data=>{external_window_namespaceObject.$gameParty._items=makeItemRecord(data)});instance.start(false,"weapon",data=>{external_window_namespaceObject.$gameParty._weapons=makeItemRecord(data)});instance.start(false,"armor",data=>{external_window_namespaceObject.$gameParty._armors=makeItemRecord(data)})})();