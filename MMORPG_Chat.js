/*!
 * /*:
 * @target MZ
 * @plugindesc Game Chat
 * @author R.Malizia
 * @url https://rmalizia44.itch.io/
 * @help
 *
 * ⚔️ MMORPG Maker Plugin 0.9.5 Preview
 *
 * A live chat system allow players to communicate and coordinate with
 * each other in real time, fostering an engaging and interactive community.
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
 * - Sephsta
 * - fanao2
 * - hypebutter
 * - Christopher Grotheer
 *
 * 🌟 Legendary Tier
 *
 * - Alexis Naboulet
 * - Georgy
 * - Frapstery
 *
 * ✨ Epic Tier
 *
 * - Lupilo
 * - Richard and Adam
 * - Mr.Timbaba
 * - Kit Renard
 *
 * @base MMORPG_Client
 * @orderAfter MMORPG_Client
 *
 * @param chatHorz
 * @text Chat Horizontal
 * @type boolean
 * @desc Chat Horizontal Position
 * @on Right
 * @off Left
 * @default false
 *
 * @param chatVert
 * @text Chat Vertical
 * @type boolean
 * @desc Chat Vertical Position
 * @on Bottom
 * @off Top
 * @default true
 *
 * @param chatFade
 * @text Chat Fade
 * @type number
 * @decimals 2
 * @desc Chat Fade Percentage per Frame
 * @default 0.1
 *
 * @param chatWidth
 * @text Chat Width
 * @type number
 * @desc Chat Width
 * @default 300
 *
 * @param chatHeight
 * @text Chat Height
 * @type number
 * @desc Chat Height
 * @default 100
 *
 * @param maxLength
 * @text Max Length
 * @type number
 * @desc Maximum Number of Characters Allowed
 * @default 64
 *
 * @param systemName
 * @text System Name
 * @type string
 * @desc Chat System Name
 * @default (System)
 *
 * @param welcomeMessage
 * @text Welcome Message
 * @type string
 * @desc Welcome Message to Show
 * @default Welcome to MMORPG!
 *
 * @param showLoginName
 * @text Show Login Name
 * @type boolean
 * @desc Show User Login as Name
 * @default false
 *
 * @param showTime
 * @text Show Time
 * @type boolean
 * @desc Show Time with Messages
 * @default true
 *
 * @param fontSize
 * @text Font Size
 * @type number
 * @desc Font Size in Pixels
 * @default 16
 *
 * @param inputPlaceholder
 * @text Input Placeholder
 * @type string
 * @desc Input Placeholder Text
 * @default ...
 *
 * @param sendText
 * @text Send Text
 * @type string
 * @desc Send Button Text
 * @default Send
 *
 * @param systemColor
 * @text System Color
 * @type string
 * @desc System Name Color
 * @default #B0C4DE
 *
 * @param selfColor
 * @text Self Color
 * @type string
 * @desc Self Name Color
 * @default #FF8C00
 *
 * @param otherColor
 * @text Other Color
 * @type string
 * @desc Other Player Name Color
 * @default #00BFFF
 *
 */(()=>{"use strict";const external_window_namespaceObject=window;const STYLE=`\n#chat-container {\n    font-family: Arial, sans-serif;\n    position: fixed;\n    width: 300px;\n    background-color: rgba(0, 0, 0, 0.4);\n    /*border-radius: 10px;*/\n    box-shadow: 0px 0px 10px rgba(0, 0, 0, 0.5);\n    overflow: hidden;\n    z-index: 1000;\n    opacity: 0;\n}\n#chat-header {\n    display: flex;\n    background-color: #333;\n    padding: 8px;\n    justify-content: space-around;\n}\n#chat-header button.tab {\n    flex: 1 1 auto;\n    background-color: transparent;\n    border: none;\n    color: white;\n    cursor: pointer;\n    padding: 5px 10px;\n    /*border-radius: 10px;*/\n    /*transition: background-color 0.3s ease-in-out;*/\n    font-size: 16px;\n}\n#chat-header button.active {\n    background-color: #555;\n}\n#chat {\n    flex: 1 1 auto;\n    background-color: transparent;\n    border: none;\n    color: white;\n    padding: 5px 10px;\n    /*border-radius: 10px;*/\n    /*transition: background-color 0.3s ease-in-out;*/\n    font-size: 16px;\n}\n#chat-header button#minimize {\n    background-color: #414141;\n    /*border-radius: 50%;*/\n    color: white;\n    flex: 0 0 auto;\n    border: none;\n    margin-left: 4px;\n    cursor: pointer;\n    padding: 5px 10px;\n}\n#chat-messages {\n    overflow-y: scroll;\n    overflow-x: hidden;\n    padding: 10px;\n    color: white;\n    scrollbar-width: thin;\n    scrollbar-color: #555 rgba(0, 0, 0, 0.3);\n    height: 100px;\n}\n#chat-messages::-webkit-scrollbar {\n    width: 6px;\n}\n#chat-messages::-webkit-scrollbar-track {\n    background: rgba(0, 0, 0, 0.3);\n}\n#chat-messages::-webkit-scrollbar-thumb {\n    background-color: #555;\n    /*border-radius: 10px;*/\n}\n.msg-time {\n    margin-right: 4px;\n}\n.msg-from {\n    font-weight: bold;\n    margin-right: 4px;\n}\n.msg-text {\n    font-weight: normal;\n}\n#chat-actions {\n    width: 100%;\n    display: flex;\n    /*background-color: rgba(0, 0, 0, 0.4);*/\n    /*padding: 8px;*/\n}\n#chat-actions input[type="text"] {\n    flex: 1 1 auto;\n    padding: 5px;\n    border: none;\n    font-size: 16px;\n    /*border-radius: 5px;*/\n    margin: 8px;\n    margin-right: 0;\n}\n#chat-actions button {\n    flex: 0 0 auto;\n    background-color: #555;\n    border: none;\n    /*border-radius: 5px;*/\n    color: white;\n    cursor: pointer;\n    padding: 5px 10px;\n    margin: 8px;\n    font-size: 16px;\n}\n`;function chatHorz(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["chatHorz"]=="true"}function chatVert(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["chatVert"]=="true"}function chatFade(){return Number(external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["chatFade"])||.1}function chatWidth(){const wid=Number(external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["chatWidth"])||300;return`${wid}px`}function chatHeight(){const hei=Number(external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["chatHeight"])||100;return`${hei}px`}function maxLength(){const value=Number(external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["maxLength"])||64;return Math.min(value,250)}function systemName(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["systemName"]||"(System)"}function welcomeMessage(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["welcomeMessage"]}function showLoginName(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["showLoginName"]=="true"}function showTime(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["showTime"]=="true"}function fontSize(){const size=Number(external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["fontSize"])||16;return`${size}px`}function inputPlaceholder(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["inputPlaceholder"]||"..."}function sendText(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["sendText"]||"Send"}function systemColor(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["systemColor"]||"#B0C4DE"}function selfColor(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["selfColor"]||"#FF8C00"}function otherColor(){return external_window_namespaceObject.PluginManager.parameters("MMORPG_Chat")["otherColor"]||"#00BFFF"}const chat=document.createElement("div");chat.id="chat-container";chat.style["width"]=chatWidth();chat.style[chatHorz()?"right":"left"]="8px";chat.style[chatVert()?"bottom":"top"]="8px";const messages=document.createElement("div");messages.id="chat-messages";messages.style["height"]=chatHeight();messages.style["fontSize"]=fontSize();chat.appendChild(messages);const actions=document.createElement("div");actions.id="chat-actions";chat.appendChild(actions);const inputText=document.createElement("input");inputText.id="message-input";inputText.type="text";inputText.placeholder=inputPlaceholder();inputText.autocomplete="off";inputText.maxLength=maxLength();actions.appendChild(inputText);const buttonSend=document.createElement("button");buttonSend.id="send-button";buttonSend.innerText=sendText();actions.appendChild(buttonSend);const chatStyle=document.createElement("style");chatStyle.textContent=STYLE;chat.appendChild(chatStyle);document.body.appendChild(chat);function setCommand(key,callback){if(!window._commands){window._commands=new Map}window._commands.set(key.toLowerCase(),callback)}function getCommand(key){if(!window._commands){return undefined}return window._commands.get(key)}const client=window.client;const instance=client;let opacity=0;let isVisible=true;const CHAT_KEYS=Object.freeze(["Enter","NumpadEnter"]);function getVisible(){return isVisible}function setVisible(value){if(isVisible===value){return}isVisible=value}function chatUpdate(){if(isVisible){opacity=Math.min(opacity+chatFade(),1)}else{opacity=Math.max(opacity-chatFade(),0)}chat.style["opacity"]=opacity.toString();chat.style["pointerEvents"]=isVisible?"auto":"none"}function checkPropagation(e){e.stopPropagation()}chat.addEventListener("mousedown",checkPropagation);chat.addEventListener("mousemove",checkPropagation);chat.addEventListener("mouseup",checkPropagation);chat.addEventListener("wheel",checkPropagation);chat.addEventListener("touchstart",checkPropagation);chat.addEventListener("touchmove",checkPropagation);chat.addEventListener("touchend",checkPropagation);chat.addEventListener("touchcancel",checkPropagation);function getTimestamp(){const date=new Date;const hours=date.getHours().toString().padStart(2,"0");const minutes=date.getMinutes().toString().padStart(2,"0");return`${hours}:${minutes}`}function chatAddMessage(name,text,color){const msg=document.createElement("div");msg.classList.add("message");if(showTime()){const msgTime=document.createElement("span");msgTime.classList.add("msg-time");msgTime.innerText=getTimestamp();msg.appendChild(msgTime)}const msgFrom=document.createElement("span");msgFrom.classList.add("msg-from");msgFrom.innerText=`${name}:`;msgFrom.style["color"]=color;msg.appendChild(msgFrom);const msgText=document.createElement("span");msgText.classList.add("msg-text");msgText.innerText=text;msg.appendChild(msgText);messages.appendChild(msg);messages.scrollTop=messages.scrollHeight}document.addEventListener("keydown",onDocumentKeyDown);inputText.addEventListener("keydown",onInputKeyDown);inputText.addEventListener("keyup",onInputKeyUp);inputText.addEventListener("focus",onInputFocus);inputText.addEventListener("blur",onInputBlur);buttonSend.addEventListener("click",sendInput);function isFocused(){return document.activeElement==inputText}function onDocumentKeyDown(evt){if(!isVisible||isFocused()){return}if(!CHAT_KEYS.includes(evt.code)){return}evt.stopImmediatePropagation();inputText.focus()}function onInputKeyDown(evt){if(!isVisible||!isFocused()){return inputText.blur()}evt.stopImmediatePropagation();if(!CHAT_KEYS.includes(evt.code)){return}sendInput()}function onInputKeyUp(evt){if(!isVisible||!isFocused()){return inputText.blur()}evt.stopImmediatePropagation()}function onInputFocus(evt){}function onInputBlur(evt){}function sendMessage(name, text){instance.publish(false,"map","chat",name,text,otherColor())}function sendCommand(code,args){const func=getCommand(code.toLowerCase());if(func){func(...args)}else{chatAddMessage(systemName(),`Unrecognized command: ${code}`,systemColor())}}function sendInput(){const text=inputText.value.trim();inputText.value="";if(!text){return inputText.blur()}inputText.focus();const name=showLoginName()?instance.user():external_window_namespaceObject.$gameParty.leader().name();chatAddMessage(name,text,selfColor());if(text.startsWith("\\")){const[code,...args]=text.substring(1).split(" ");sendCommand(code,args.map(s=>s.trim()).filter(s=>s.length>0))}else{sendMessage(name, text)}}setVisible(false);class ChatImpl{addMessage(name,text,color){chatAddMessage(name,text,color)}}function log(...args){if(true){return}}const src_log=log;function setAdminCommand(key,callback){setCommand(key,(...args)=>{if(!instance.admin()){return window.chat.addMessage(systemName(),"Can't use admin commands",systemColor())}callback(...args)})}function toBool(value){value=value?.toLowerCase();if(value=="true"||value=="on"){return true}else if(value=="false"||value=="off"){return false}else{return undefined}}setAdminCommand("help",()=>{const chat=window.chat;chat.addMessage(systemName(),`Available commands:`,systemColor());chat.addMessage(systemName(),`- online`,systemColor());chat.addMessage(systemName(),`- bans`,systemColor());chat.addMessage(systemName(),`- ban [user] [true/false]`,systemColor())});setAdminCommand("online",()=>{const chat=window.chat;instance.online(res=>{src_log("online:",res);const list=Object.keys(res);chat.addMessage(systemName(),`${list.length} players online`,systemColor());for(const user of list){chat.addMessage(systemName(),`- ${user}`,systemColor())}})});setAdminCommand("bans",()=>{const chat=window.chat;instance.banned(res=>{src_log("bans:",res);const list=Object.keys(res);chat.addMessage(systemName(),`${list.length} players banned`,systemColor());for(const user of list){chat.addMessage(systemName(),`- ${user}`,systemColor())}})});setAdminCommand("ban",(user,value)=>{const chat=window.chat;if(typeof user!="string"){return chat.addMessage(systemName(),`Invalid user`,systemColor())}const state=typeof value!="string"?true:toBool(value);if(typeof state!="boolean"){return chat.addMessage(systemName(),`Invalid argument: ${value}, must be true or false`,systemColor())}instance.banning(user,state,res=>{src_log("banning:",res);chat.addMessage(systemName(),`Ban of ${user} set to ${state}`,systemColor())})});window.chat=new ChatImpl;function resetVisibility(){const scene=external_window_namespaceObject.SceneManager._scene;setVisible(scene instanceof external_window_namespaceObject.Scene_Map)}const Scene_Base_start=external_window_namespaceObject.Scene_Base.prototype.start;external_window_namespaceObject.Scene_Base.prototype.start=function(){resetVisibility();Scene_Base_start.call(this)};const Scene_Base_update=external_window_namespaceObject.Scene_Base.prototype.update;external_window_namespaceObject.Scene_Base.prototype.update=function(){Scene_Base_update.call(this);chatUpdate()};const Window_Message_startMessage=external_window_namespaceObject.Window_Message.prototype.startMessage;external_window_namespaceObject.Window_Message.prototype.startMessage=function(){setVisible(false);return Window_Message_startMessage.call(this)};const Window_Message_startInput=external_window_namespaceObject.Window_Message.prototype.startInput;external_window_namespaceObject.Window_Message.prototype.startInput=function(){const result=Window_Message_startInput.call(this);if(result){setVisible(false)}return result};const Window_Message_terminateMessage=external_window_namespaceObject.Window_Message.prototype.terminateMessage;external_window_namespaceObject.Window_Message.prototype.terminateMessage=function(){resetVisibility();return Window_Message_terminateMessage.call(this)};instance.start(false,"chat",data=>{const text=welcomeMessage()?.trim();if(text){chatAddMessage(systemName(),text,systemColor())}});instance.react(external_window_namespaceObject.Scene_Base,"map","chat",(scene,from,name,text,color)=>{if(typeof name!=="string"){return instance.report(from,"chat invalid name")}if(typeof text!=="string"){return instance.report(from,"chat invalid text")}if(typeof color!=="string"){return instance.report(from,"chat invalid color")}chatAddMessage(name,text,color)})})();