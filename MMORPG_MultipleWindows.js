/*!
 * /*:
 * @target MZ
 * @plugindesc Multiple Windows
 * @author R.Malizia
 * @url https://rmalizia44.itch.io/
 * @help
 *
 * ⚔️ MMORPG Maker Plugin 0.9.3
 *
 * This plugin enables the opening of multiple game windows by
 * modifying the package.json file (editor only).
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
 */(()=>{"use strict";var __webpack_modules__={896:module=>{module.exports=require("fs")},928:module=>{module.exports=require("path")}};var __webpack_module_cache__={};function __webpack_require__(moduleId){var cachedModule=__webpack_module_cache__[moduleId];if(cachedModule!==undefined){return cachedModule.exports}var module=__webpack_module_cache__[moduleId]={exports:{}};__webpack_modules__[moduleId](module,module.exports,__webpack_require__);return module.exports}const external_window_namespaceObject=window;const randomUUID=typeof crypto!=="undefined"&&crypto.randomUUID&&crypto.randomUUID.bind(crypto);const esm_browser_native={randomUUID};let getRandomValues;const rnds8=new Uint8Array(16);function rng(){if(!getRandomValues){if(typeof crypto==="undefined"||!crypto.getRandomValues){throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported")}getRandomValues=crypto.getRandomValues.bind(crypto)}return getRandomValues(rnds8)}const byteToHex=[];for(let i=0;i<256;++i){byteToHex.push((i+256).toString(16).slice(1))}function unsafeStringify(arr,offset=0){return(byteToHex[arr[offset+0]]+byteToHex[arr[offset+1]]+byteToHex[arr[offset+2]]+byteToHex[arr[offset+3]]+"-"+byteToHex[arr[offset+4]]+byteToHex[arr[offset+5]]+"-"+byteToHex[arr[offset+6]]+byteToHex[arr[offset+7]]+"-"+byteToHex[arr[offset+8]]+byteToHex[arr[offset+9]]+"-"+byteToHex[arr[offset+10]]+byteToHex[arr[offset+11]]+byteToHex[arr[offset+12]]+byteToHex[arr[offset+13]]+byteToHex[arr[offset+14]]+byteToHex[arr[offset+15]]).toLowerCase()}function stringify(arr,offset=0){const uuid=unsafeStringify(arr,offset);if(!validate(uuid)){throw TypeError("Stringified UUID is invalid")}return uuid}const esm_browser_stringify=null&&stringify;function v4(options,buf,offset){if(esm_browser_native.randomUUID&&!buf&&!options){return esm_browser_native.randomUUID()}options=options||{};const rnds=options.random??options.rng?.()??rng();if(rnds.length<16){throw new Error("Random bytes length must be >= 16")}rnds[6]=rnds[6]&15|64;rnds[8]=rnds[8]&63|128;if(buf){offset=offset||0;if(offset<0||offset+16>buf.length){throw new RangeError(`UUID byte range ${offset}:${offset+15} is out of buffer bounds`)}for(let i=0;i<16;++i){buf[offset+i]=rnds[i]}return buf}return unsafeStringify(rnds)}const esm_browser_v4=v4;function makeGuid(){return esm_browser_v4().replaceAll("-","")}try{if(external_window_namespaceObject.Utils.isOptionValid("test")){const fs=__webpack_require__(896);const path=__webpack_require__(928);const base=path.dirname(process.mainModule.filename);const file=path.join(base,"package.json");const text=fs.readFileSync(file,{encoding:"utf8"});const json=JSON.parse(text);json.name=makeGuid();const save=JSON.stringify(json,undefined,4);fs.writeFileSync(file,save,{encoding:"utf8"})}}catch(e){console.error(e)}})();