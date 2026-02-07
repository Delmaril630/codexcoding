/*!
 * /*:
 * @target MZ
 * @plugindesc Events
 * @author R.Malizia
 * @url https://rmalizia44.itch.io/
 * @help
 *
 * ⚔️ MMORPG Maker Plugin 0.9.3
 *
 * Events with <Sync> in their note field will be synchronized on the map,
 * ensuring they appear in the same position and state for all players. This
 * allows consistent interaction with events across different player sessions.
 *
 * Be careful when using switches and variables that are not global
 * in events with <Sync>, as this may cause inconsistencies.
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
 * @base MMORPG_Characters
 * @orderAfter MMORPG_Characters
 *
 */(()=>{"use strict";const external_window_namespaceObject=window;function isValidMapId(id){if(typeof id!=="number"){return false}if(!Number.isSafeInteger(id)){return false}if(id<1){return false}if(external_window_namespaceObject.$dataMapInfos&&id>=external_window_namespaceObject.$dataMapInfos.length){return false}return true}function isValidEventId(id){if(typeof id!=="number"){return false}if(!Number.isSafeInteger(id)){return false}if(id<1){return false}if(external_window_namespaceObject.$gameMap&&!external_window_namespaceObject.$gameMap.event(id)){return false}return true}function isValidPosition(x,y,dir){if(!Number.isSafeInteger(x)){return false}if(!Number.isSafeInteger(y)){return false}if(!Number.isSafeInteger(dir)||dir<1||dir>9){return false}if(external_window_namespaceObject.$gameMap&&!external_window_namespaceObject.$gameMap.isValid(x,y)){return false}return true}function isValidMove(x,y,dir){if(!isValidPosition(x,y,dir)){return false}return true}function isValidJump(x,y,dir){if(!isValidPosition(x,y,dir)){return false}return true}const client=window.client;const instance=client;external_window_namespaceObject.Game_Event.prototype.pack=function(x,y,dir,jump){return[external_window_namespaceObject.$gameMap.mapId(),this.eventId(),x,y,dir,jump]};external_window_namespaceObject.Game_Event.prototype.packIdle=function(){return this.pack(this.x,this.y,this.direction(),false)};external_window_namespaceObject.Game_Event.prototype.packMove=function(x,y,dir){return this.pack(x,y,dir,false)};external_window_namespaceObject.Game_Event.prototype.packJump=function(x,y,dir){return this.pack(x,y,dir,true)};external_window_namespaceObject.Game_Event.prototype.mustSync=function(){const data=this.event();if(!data||!data.meta){return false}return Object.keys(data.meta).some(k=>k.toLowerCase()==="sync")};external_window_namespaceObject.Game_Event.prototype.applyStopPenalty=function(percent=1){const ms=1e3*(percent+Math.random());const ping=instance.getPing()||1e3;this._stopCount-=Math.floor(60*(ms+ping)/1e3)};external_window_namespaceObject.Game_Event.prototype.translate=function(x,y){this._x+=x;this._y+=y};const Game_Event_initialize=external_window_namespaceObject.Game_Event.prototype.initialize;external_window_namespaceObject.Game_Event.prototype.initialize=function(mapId,eventId){Game_Event_initialize.call(this,mapId,eventId);if(!this.mustSync()){return}this.applyStopPenalty()};const Game_Event_isCollidedWithCharacters=external_window_namespaceObject.Game_Event.prototype.isCollidedWithCharacters;external_window_namespaceObject.Game_Event.prototype.isCollidedWithCharacters=function(x,y){if(Game_Event_isCollidedWithCharacters.call(this,x,y)){return true}const remotes=external_window_namespaceObject.$gameMap._remotes;if(!remotes){return false}for(const r of remotes.values()){if(r.posNt(x,y)){return true}}return false};const Game_Event_moveStraight=external_window_namespaceObject.Game_Event.prototype.moveStraight;external_window_namespaceObject.Game_Event.prototype.moveStraight=function(d){if(!this.mustSync()){return Game_Event_moveStraight.call(this,d)}this.resetStopCount();this.applyStopPenalty();let x=this.x;let y=this.y;if(this.canPass(x,y,d)){x=external_window_namespaceObject.$gameMap.roundXWithDirection(this.x,d);y=external_window_namespaceObject.$gameMap.roundYWithDirection(this.y,d)}instance.publish(true,"map","event",...this.packMove(x,y,d))};const Game_Event_moveDiagonally=external_window_namespaceObject.Game_Event.prototype.moveDiagonally;external_window_namespaceObject.Game_Event.prototype.moveDiagonally=function(horz,vert){if(!this.mustSync()){return Game_Event_moveDiagonally.call(this,horz,vert)}this.resetStopCount();this.applyStopPenalty();let x=this.x;let y=this.y;if(this.canPassDiagonally(x,y,horz,vert)){x=external_window_namespaceObject.$gameMap.roundXWithDirection(this.x,horz);y=external_window_namespaceObject.$gameMap.roundYWithDirection(this.y,vert)}let d=this.direction();if(this._direction===this.reverseDir(horz)){d=horz}if(this._direction===this.reverseDir(vert)){d=vert}instance.publish(true,"map","event",...this.packMove(x,y,d))};const Game_Event_jump=external_window_namespaceObject.Game_Event.prototype.jump;external_window_namespaceObject.Game_Event.prototype.jump=function(xPlus,yPlus){if(!this.mustSync()){return Game_Event_jump.call(this,xPlus,yPlus)}this.resetStopCount();this.applyStopPenalty();const x=this.x+xPlus;const y=this.y+yPlus;let d=this.direction();if(Math.abs(xPlus)>Math.abs(yPlus)){if(xPlus!==0){d=xPlus<0?4:6}}else{if(yPlus!==0){d=yPlus<0?8:2}}instance.publish(true,"map","event",...this.packJump(x,y,d))};instance.react(external_window_namespaceObject.Scene_Map,"map","+",(scene,from)=>{for(const event of external_window_namespaceObject.$gameMap.events()){if(event._auth&&event._auth!=instance.user()){continue}instance.sendto(from,"event",...event.packIdle())}});instance.react(external_window_namespaceObject.Scene_Map,"map","-",(scene,from)=>{for(const event of external_window_namespaceObject.$gameMap.events()){if(event._auth!=from){continue}event._auth=undefined}});instance.react(external_window_namespaceObject.Scene_Base,["map","@"],"event",(scene,from,mapId,eventId,x,y,dir,jump)=>{if(!isValidMapId(mapId)){return instance.report(from,"event invalid map")}if(external_window_namespaceObject.$gameMap.mapId()!==mapId){return}if(!isValidEventId(eventId)){return instance.report(from,"event invalid id")}if(typeof x!=="number"){return instance.report(from,"event invalid x")}if(typeof y!=="number"){return instance.report(from,"event invalid y")}if(typeof dir!=="number"){return instance.report(from,"event invalid dir")}if(!isValidMove(x,y,dir)){return instance.report(from,"event invalid move")}if(typeof jump!=="boolean"){return instance.report(from,"event invalid jump")}const event=external_window_namespaceObject.$gameMap.event(eventId);event._auth=from;event.setDirection(dir);const isSceneMap=scene instanceof external_window_namespaceObject.Scene_Map;if(jump){if(isSceneMap){Game_Event_jump.call(event,x-event.x,y-event.y)}else{event.locate(x,y)}}else{const distance=external_window_namespaceObject.$gameMap.distance(event._realX,event._realY,x,y);if(isSceneMap&&distance<3){event.translate(x-event.x,y-event.y)}else{event.locate(x,y)}}event.resetStopCount();if(from!=instance.user()){event.applyStopPenalty()}})})();