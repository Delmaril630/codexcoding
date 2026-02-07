/*:
 * @target MZ
 * @plugindesc [v2.0] Character Creation system - M/F pairs for hairstyles, multi-page colors
 * @author Claude
 * @url
 * 
 * @help
 * ============================================================================
 * CHARACTER CREATION PLUGIN v2.0
 * ============================================================================
 * 
 * This plugin provides a character creation scene where players can:
 * 1. Select their class (shows male/female enemy sprites side by side)
 * 2. Select their hairstyle (M/F pairs shown side by side)
 * 3. Select their hair/face color (browse through pages of 8)
 * 
 * == CONFIGURATION ==
 * 
 * Use the "Class Configuration" parameter to set up each class with:
 * - Class ID (from database)
 * - Male Enemy Sprite filename (from img/enemies/)
 * - Female Enemy Sprite filename (from img/enemies/)
 * - Number of hairstyle pages (4 hairstyles per page with M/F pairs)
 * - Number of color pages (8 colors per page)
 * 
 * == FILE NAMING CONVENTION ==
 * 
 * Enemy sprites for class preview (img/enemies/):
 *   En1_Actor1_1.png, En1_Actor1_2.png = Warrior (male, female)
 * 
 * Hairstyle sheets (img/characters/):
 *   Warrior_hairstyles_0.png  (4 hairstyles: 0&1=HS1, 2&3=HS2, 4&5=HS3, 6&7=HS4)
 *   Warrior_hairstyles_1.png  (4 hairstyles: 0&1=HS5, 2&3=HS6, 4&5=HS7, 6&7=HS8)
 *   etc.
 *   Each pair is male (even) & female (odd) shown side by side during selection
 * 
 * Color sheets (img/characters/):
 *   Warrior_hair_0_colors_0.png  (hairstyle 0, colors 0-7)
 *   Warrior_hair_0_colors_1.png  (hairstyle 0, colors 8-15)
 *   Warrior_hair_1_colors_0.png  (hairstyle 1, colors 0-7)
 *   etc.
 * 
 * Face portraits (img/faces/):
 *   Warrior_face_colors_0.png  (face colors 0-7)
 *   Warrior_face_colors_1.png  (face colors 8-15)
 *   etc.
 * 
 * == PLUGIN COMMANDS ==
 * 
 * OpenCharacterCreation - Opens the character creation scene
 * 
 * ============================================================================
 * 
 * @param classConfig
 * @text Class Configuration
 * @type struct<ClassConfig>[]
 * @desc Configure each class with enemy sprites, hairstyle pages, and color pages
 * @default []
 * 
 * @param previewX
 * @text Preview Sprite X
 * @type number
 * @desc X position of the character preview sprite
 * @default 600
 * 
 * @param previewY
 * @text Preview Sprite Y
 * @type number
 * @desc Y position of the character preview sprite
 * @default 400
 * 
 * @param previewScale
 * @text Preview Scale
 * @type number
 * @decimals 1
 * @desc Scale of the preview sprite (1 = normal, 2 = double, etc.)
 * @default 2
 * 
 * @param classPreviewScale
 * @text Class Preview Scale
 * @type number
 * @decimals 1
 * @desc Scale of the enemy sprites in class selection (1 = normal)
 * @default 1
 * 
 * @param fallbackCharacter
 * @text Fallback Character
 * @type file
 * @dir img/characters
 * @desc Fallback character image if the requested one doesn't exist
 * @default Actor1
 * 
 * @param fallbackFace
 * @text Fallback Face
 * @type file
 * @dir img/faces
 * @desc Fallback face image if the requested one doesn't exist
 * @default Actor1
 * 
 * @command OpenCharacterCreation
 * @text Open Character Creation
 * @desc Opens the character creation scene
 */

/*~struct~ClassConfig:
 * @param classId
 * @text Class ID
 * @type class
 * @desc The class ID from the database
 * @default 1
 * 
 * @param maleSprite
 * @text Male Enemy Sprite
 * @type file
 * @dir img/enemies
 * @desc Enemy sprite for male version (e.g., En1_Actor1_1)
 * @default
 * 
 * @param femaleSprite
 * @text Female Enemy Sprite
 * @type file
 * @dir img/enemies
 * @desc Enemy sprite for female version (e.g., En1_Actor1_2)
 * @default
 * 
 * @param hairstylePages
 * @text Hairstyle Pages
 * @type number
 * @min 0
 * @desc Number of hairstyle pages (4 hairstyles per page, each with M/F pair). Set to 0 if not available.
 * @default 0
 * 
 * @param colorPages
 * @text Color Pages
 * @type number
 * @min 0
 * @desc How many color pages (8 per page). Applies to both hair colors and face colors.
 * @default 1
 */

(() => {
    "use strict";
    
    const pluginName = "Character_Creation";
    const params = PluginManager.parameters(pluginName);
    
    const PREVIEW_X = Number(params.previewX || 600);
    const PREVIEW_Y = Number(params.previewY || 400);
    const PREVIEW_SCALE = Number(params.previewScale || 2);
    const CLASS_PREVIEW_SCALE = Number(params.classPreviewScale || 1);
    const FALLBACK_CHARACTER = params.fallbackCharacter || "Actor1";
    const FALLBACK_FACE = params.fallbackFace || "Actor1";
const NAME_MAX_LENGTH = 12; // max character name length
    
    // Parse class configuration
    let classConfig = [];
    try {
        const parsed = JSON.parse(params.classConfig || "[]");
        classConfig = parsed.map(item => {
            const obj = JSON.parse(item);
            return {
                classId: Number(obj.classId),
                maleSprite: obj.maleSprite || "",
                femaleSprite: obj.femaleSprite || "",
                hairstylePages: Number(obj.hairstylePages || 0),
                colorPages: Number(obj.colorPages || 1)
            };
        });
        console.log("Character_Creation: Loaded config for", classConfig.length, "classes:", classConfig);
    } catch (e) {
        console.error("Character_Creation: Error parsing classConfig parameter", e);
    }
    
    // Helper: Get class name from ID
    function getClassName(classId) {
        const classData = $dataClasses[classId];
        return classData ? classData.name : "Unknown";
    }
    
    // Helper: Get config for a class
    function getClassConfig(classId) {
        return classConfig.find(c => c.classId === classId) || null;
    }
    
    // Helper: Get hairstyle pages for a class
    function getHairstylePages(classId) {
        const config = getClassConfig(classId);
        return config ? config.hairstylePages : 0;
    }
    
    // Helper: Get color pages for a class
    function getColorPages(classId) {
        const config = getClassConfig(classId);
        return config ? config.colorPages : 1;
    }
    
    // Helper: Get total hairstyles for a class (4 hairstyles per page, each has M/F pair)
    function getTotalHairstyles(classId) {
        return getHairstylePages(classId) * 4;
    }
    
    // Helper: Convert hairstyle number to page and M/F index pair
    // Hairstyle 0 → page 0, indexes 0 & 1
    // Hairstyle 1 → page 0, indexes 2 & 3
    // Hairstyle 2 → page 0, indexes 4 & 5
    // Hairstyle 3 → page 0, indexes 6 & 7
    // Hairstyle 4 → page 1, indexes 0 & 1
    // etc.
    function getHairstylePageAndIndexes(hairstyleNum) {
        const page = Math.floor(hairstyleNum / 4);
        const pairIndex = hairstyleNum % 4;
        const maleIndex = pairIndex * 2;
        const femaleIndex = maleIndex + 1;
        return { page, maleIndex, femaleIndex };
    }
    
    // Helper: Get total colors for a class
    function getTotalColors(classId) {
        return getColorPages(classId) * 8;
    }
    
    // Helper: Convert absolute index to page and index within page
    // Returns 0-based page number and index within page
    function getPageAndIndex(absoluteIndex) {
        const page = Math.floor(absoluteIndex / 8);
        const index = absoluteIndex % 8;
        return { page, index };
    }
    
    
    //=========================================================================
    // MMO_TextEntry - capture raw keyboard characters for text entry windows
    // Prevents Z/X (OK/Cancel) from firing while typing.
    //=========================================================================
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

// Plugin Command
    PluginManager.registerCommand(pluginName, "OpenCharacterCreation", args => {
        SceneManager.push(Scene_CharacterCreation);
    });
    
    //=========================================================================
    // ImageValidator - Check if images exist before proceeding
    //=========================================================================
    
    function ImageValidator() {
        this._cache = {};
        this._pending = {};
    }
    
    ImageValidator.prototype.checkCharacterImage = function(filename, callback) {
        const cacheKey = "char_" + filename;
        if (this._cache[cacheKey] !== undefined) {
            callback(this._cache[cacheKey], filename);
            return;
        }

        if (this._pending[cacheKey]) {
            this._pending[cacheKey].push(callback);
            return;
        }

        this._pending[cacheKey] = [callback];

        // Support both development files (".png") and deployed/encrypted files (".png_")
        // We only need to know if the file exists; RPG Maker will handle the actual image loading/decryption.
        const self = this;
        const urls = [
            "img/characters/" + filename + ".png",
            "img/characters/" + filename + ".png_"
        ];
        let i = 0;

        function finish(ok) {
            self._cache[cacheKey] = ok;
            const callbacks = self._pending[cacheKey] || [];
            delete self._pending[cacheKey];
            callbacks.forEach(cb => cb(ok, filename));
        }

        function tryNext() {
            if (i >= urls.length) {
                finish(false);
                return;
            }

            const xhr = new XMLHttpRequest();
            xhr.open("GET", urls[i], true);
            xhr.responseType = "arraybuffer";
            xhr.onload = function() {
                // In local/NW.js builds, status may be 0; treat non-empty response as success.
                const ok =
                    (xhr.status >= 200 && xhr.status < 400) ||
                    (xhr.status === 0 && xhr.response && xhr.response.byteLength > 0);
                if (ok) {
                    finish(true);
                } else {
                    i++;
                    tryNext();
                }
            };
            xhr.onerror = function() {
                i++;
                tryNext();
            };

            try {
                xhr.send();
            } catch (e) {
                i++;
                tryNext();
            }
        }

        tryNext();
    };
    
    ImageValidator.prototype.checkFaceImage = function(filename, callback) {
        const cacheKey = "face_" + filename;

        if (this._cache[cacheKey] !== undefined) {
            callback(this._cache[cacheKey], filename);
            return;
        }

        if (this._pending[cacheKey]) {
            this._pending[cacheKey].push(callback);
            return;
        }

        this._pending[cacheKey] = [callback];

        // Support both development files (".png") and deployed/encrypted files (".png_")
        // We only need to know if the file exists; RPG Maker will handle the actual image loading/decryption.
        const self = this;
        const urls = [
            "img/faces/" + filename + ".png",
            "img/faces/" + filename + ".png_"
        ];
        let i = 0;

        function finish(ok) {
            self._cache[cacheKey] = ok;
            const callbacks = self._pending[cacheKey] || [];
            delete self._pending[cacheKey];
            callbacks.forEach(cb => cb(ok, filename));
        }

        function tryNext() {
            if (i >= urls.length) {
                finish(false);
                return;
            }

            const xhr = new XMLHttpRequest();
            xhr.open("GET", urls[i], true);
            xhr.responseType = "arraybuffer";
            xhr.onload = function() {
                const ok =
                    (xhr.status >= 200 && xhr.status < 400) ||
                    (xhr.status === 0 && xhr.response && xhr.response.byteLength > 0);
                if (ok) {
                    finish(true);
                } else {
                    i++;
                    tryNext();
                }
            };
            xhr.onerror = function() {
                i++;
                tryNext();
            };

            try {
                xhr.send();
            } catch (e) {
                i++;
                tryNext();
            }
        }

        tryNext();
    };
    
    // Global validator instance
    const imageValidator = new ImageValidator();
    
    //=========================================================================
    // Scene_CharacterCreation
    //=========================================================================
    
    function Scene_CharacterCreation() {
        this.initialize(...arguments);
    }
    
    Scene_CharacterCreation.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CharacterCreation.prototype.constructor = Scene_CharacterCreation;
    
    Scene_CharacterCreation.prototype.initialize = function() {
        Scene_MenuBase.prototype.initialize.call(this);
        this._phase = "class";
        this._selectedClassId = null;
        this._selectedClassName = "";
        this._selectedHairstyle = 0;
        this._selectedColor = 0;
        this._selectedName = "";
        this._currentImageValid = true;
        this._isValidating = false;
    };
    
    Scene_CharacterCreation.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createTitleWindow();
        this.createClassPreviewSprites();
        this.createClassWindow();
        this.createHairstyleWindow();
        this.createColorWindow();
        this.createNameWindows();
        this.createConfirmWindow();
        this.createPreviewSprite();
        this.createInstructionWindow();
        this.createErrorWindow();
        
        // Initial preview update
        this.updateClassPreview();
    };
    
    Scene_CharacterCreation.prototype.createTitleWindow = function() {
        const rect = new Rectangle(0, 0, Graphics.boxWidth, 60);
        this._titleWindow = new Window_Base(rect);
        this._titleWindow.contents.fontSize = 28;
        this._titleWindow.drawText("Character Creation", 0, 0, Graphics.boxWidth - 40, "center");
        this.addWindow(this._titleWindow);
    };
    
    Scene_CharacterCreation.prototype.createInstructionWindow = function() {
        const rect = new Rectangle(0, Graphics.boxHeight - 60, Graphics.boxWidth, 60);
        this._instructionWindow = new Window_Base(rect);
        this.addWindow(this._instructionWindow);
        this.updateInstructions();
    };
    
    Scene_CharacterCreation.prototype.createErrorWindow = function() {
        const rect = new Rectangle(50, Graphics.boxHeight - 130, Graphics.boxWidth - 100, 60);
        this._errorWindow = new Window_Base(rect);
        this._errorWindow.contents.fontSize = 14;
        this._errorWindow.hide();
        this.addWindow(this._errorWindow);
    };
    
    Scene_CharacterCreation.prototype.showError = function(message) {
        this._currentImageValid = false;
        
        if (this._errorWindow) {
            this._errorWindow.contents.clear();
            this._errorWindow.contents.textColor = "#ff6666";
            this._errorWindow.drawText(message, 0, 0, this._errorWindow.contentsWidth(), "center");
            this._errorWindow.show();
        }
        console.warn("Character_Creation: " + message);
    };
    
    Scene_CharacterCreation.prototype.hideError = function() {
        this._currentImageValid = true;
        if (this._errorWindow) {
            this._errorWindow.hide();
        }
    };
    
    Scene_CharacterCreation.prototype.updateInstructions = function() {
        if (!this._instructionWindow) return;
        this._instructionWindow.contents.clear();
        
        let text = "";
        switch (this._phase) {
            case "class":
                text = "Up/Down to browse classes, Enter to select";
                break;
            case "hairstyle":
                text = "Left/Right to browse hairstyles, Enter to select, Escape to go back";
                break;
            case "color":
                text = "Left/Right to browse colors, Enter to select, Escape to go back";
                break;
            case "name":
                text = "Type your name (keyboard) or select letters. Enter/OK to confirm, Escape to go back";
                break;
            case "confirm":
                text = "Confirm your character?";
                break;
        }
        this._instructionWindow.drawText(text, 0, 0, Graphics.boxWidth - 40, "center");
    };
    
    //-------------------------------------------------------------------------
    // Class Selection Window & Preview
    //-------------------------------------------------------------------------
    
    Scene_CharacterCreation.prototype.createClassWindow = function() {
        const rect = new Rectangle(50, 80, 250, 400);
        this._classWindow = new Window_ClassSelect(rect);
        this._classWindow.setHandler("ok", this.onClassOk.bind(this));
        this._classWindow.setHandler("cancel", this.onClassCancel.bind(this));
        this._classWindow.setSelectCallback(this.onClassSelect.bind(this));
        this._classWindow.activate();
        this.addWindow(this._classWindow);
    };
    
    Scene_CharacterCreation.prototype.createClassPreviewSprites = function() {
        // Container for class preview sprites
        this._classPreviewContainer = new Sprite();
        this._classPreviewContainer.x = 550;
        this._classPreviewContainer.y = 300;
        this.addChild(this._classPreviewContainer);
        
        // Male sprite (left)
        this._malePreviewSprite = new Sprite();
        this._malePreviewSprite.anchor.x = 1;
        this._malePreviewSprite.anchor.y = 1;
        this._malePreviewSprite.x = -10;
        this._malePreviewSprite.scale.x = CLASS_PREVIEW_SCALE;
        this._malePreviewSprite.scale.y = CLASS_PREVIEW_SCALE;
        this._classPreviewContainer.addChild(this._malePreviewSprite);
        
        // Female sprite (right)
        this._femalePreviewSprite = new Sprite();
        this._femalePreviewSprite.anchor.x = 0;
        this._femalePreviewSprite.anchor.y = 1;
        this._femalePreviewSprite.x = 10;
        this._femalePreviewSprite.scale.x = CLASS_PREVIEW_SCALE;
        this._femalePreviewSprite.scale.y = CLASS_PREVIEW_SCALE;
        this._classPreviewContainer.addChild(this._femalePreviewSprite);
    };
    
    Scene_CharacterCreation.prototype.onClassSelect = function(classId) {
        this.updateClassPreview();
    };
    
    Scene_CharacterCreation.prototype.updateClassPreview = function() {
        if (!this._classWindow) return;
        if (!this._malePreviewSprite || !this._femalePreviewSprite) return;
        
        const classId = this._classWindow.currentClassId();
        const config = getClassConfig(classId);
        
        // Clear previous
        this._malePreviewSprite.bitmap = null;
        this._femalePreviewSprite.bitmap = null;
        
        if (config) {
            // Load male sprite
            if (config.maleSprite) {
                this._malePreviewSprite.bitmap = ImageManager.loadEnemy(config.maleSprite);
            }
            
            // Load female sprite
            if (config.femaleSprite) {
                this._femalePreviewSprite.bitmap = ImageManager.loadEnemy(config.femaleSprite);
            }
        }
    };
    
    Scene_CharacterCreation.prototype.showClassPreview = function() {
        if (this._classPreviewContainer) {
            this._classPreviewContainer.visible = true;
        }
    };
    
    Scene_CharacterCreation.prototype.hideClassPreview = function() {
        if (this._classPreviewContainer) {
            this._classPreviewContainer.visible = false;
        }
    };
    
    Scene_CharacterCreation.prototype.onClassOk = function() {
        const classId = this._classWindow.currentClassId();
        const config = getClassConfig(classId);
        const className = getClassName(classId);
        
        // Check if class has hairstyle configuration
        if (!config || config.hairstylePages <= 0) {
            this.showError("No hairstyles available for " + className + "!");
            SoundManager.playBuzzer();
            this._classWindow.activate();
            return;
        }
        
        this._selectedClassId = classId;
        this._selectedClassName = className;
        this._selectedHairstyle = 0;
        this._selectedColor = 0;
        
        // Validate the first hairstyle image exists before proceeding
        // Each hairstyle IS a page: Warrior_hairstyles_0.png
        const filename = this._selectedClassName + "_hairstyles_0";
        
        this._isValidating = true;
        this._classWindow.deactivate();
        
        imageValidator.checkCharacterImage(filename, (exists, fname) => {
            this._isValidating = false;
            
            if (!exists) {
                this.showError("Hairstyle image not found: " + fname);
                SoundManager.playBuzzer();
                this._classWindow.activate();
                return;
            }
            
            this._phase = "hairstyle";
            this._classWindow.hide();
            this.hideClassPreview();
            this.hideError();
            
            this._hairstyleWindow.setClass(this._selectedClassId, this._selectedClassName);
            this._hairstyleWindow.show();
            this._hairstyleWindow.activate();
            
            this.updatePreviewWithValidation();
            this.updateInstructions();
        });
    };
    
    Scene_CharacterCreation.prototype.onClassCancel = function() {
        // Do not allow exiting character creation via Cancel at the class step
        SoundManager.playBuzzer();
        this.updateInstructions();
        this._classWindow.activate();
    };
    
    //-------------------------------------------------------------------------
    // Hairstyle Selection Window
    //-------------------------------------------------------------------------
    
    Scene_CharacterCreation.prototype.createHairstyleWindow = function() {
        const rect = new Rectangle(50, 80, 300, 150);
        this._hairstyleWindow = new Window_HairstyleSelect(rect, this);
        this._hairstyleWindow.setHandler("ok", this.onHairstyleOk.bind(this));
        this._hairstyleWindow.setHandler("cancel", this.onHairstyleCancel.bind(this));
        this._hairstyleWindow.setChangeCallback(this.onHairstyleChange.bind(this));
        this._hairstyleWindow.hide();
        this._hairstyleWindow.deactivate();
        this.addWindow(this._hairstyleWindow);
    };
    
    Scene_CharacterCreation.prototype.onHairstyleOk = function() {
        if (this._isValidating) {
            SoundManager.playBuzzer();
            return;
        }
        
        if (!this._currentImageValid) {
            SoundManager.playBuzzer();
            this._hairstyleWindow.activate();
            return;
        }
        
        this._selectedHairstyle = this._hairstyleWindow.currentHairstyle();
        
        // Validate first color page exists before proceeding
        // New format: [ClassName]_hair_[hairstyle]_colors_[page].png
        const colorFilename = this._selectedClassName + "_hair_" + this._selectedHairstyle + "_colors_0";
        
        this._isValidating = true;
        this._hairstyleWindow.deactivate();
        
        imageValidator.checkCharacterImage(colorFilename, (exists, fname) => {
            this._isValidating = false;
            
            if (!exists) {
                this.showError("Hair color image not found: " + fname);
                SoundManager.playBuzzer();
                this._hairstyleWindow.activate();
                return;
            }
            
            this._phase = "color";
            this._hairstyleWindow.hide();
            this.hideError();
            
            this._colorWindow.setHairstyle(this._selectedClassId, this._selectedClassName, this._selectedHairstyle);
            this._colorWindow.show();
            this._colorWindow.activate();
            
            this._selectedColor = 0;
            this.updatePreviewWithValidation();
            this.updateInstructions();
        });
    };
    
    Scene_CharacterCreation.prototype.onHairstyleCancel = function() {
        this._phase = "class";
        this._hairstyleWindow.deactivate();
        this._hairstyleWindow.hide();
        this.hideError();
        
        this._classWindow.show();
        this._classWindow.activate();
        this.showClassPreview();
        this.updateClassPreview();
        
        this.clearPreview();
        this.updateInstructions();
    };
    
    Scene_CharacterCreation.prototype.onHairstyleChange = function(hairstyleIndex) {
        this._selectedHairstyle = hairstyleIndex;
        this.updatePreviewWithValidation();
    };
    
    //-------------------------------------------------------------------------
    // Color Selection Window
    //-------------------------------------------------------------------------
    
    Scene_CharacterCreation.prototype.createColorWindow = function() {
        const rect = new Rectangle(50, 80, 300, 150);
        this._colorWindow = new Window_ColorSelect(rect, this);
        this._colorWindow.setHandler("ok", this.onColorOk.bind(this));
        this._colorWindow.setHandler("cancel", this.onColorCancel.bind(this));
        this._colorWindow.setChangeCallback(this.onColorChange.bind(this));
        this._colorWindow.hide();
        this._colorWindow.deactivate();
        this.addWindow(this._colorWindow);
    };
    
    Scene_CharacterCreation.prototype.onColorOk = function() {
        if (this._isValidating) {
            SoundManager.playBuzzer();
            return;
        }
        
        if (!this._currentImageValid) {
            SoundManager.playBuzzer();
            this._colorWindow.activate();
            return;
        }
        
        this._selectedColor = this._colorWindow.currentColor();
        
        // Validate face image exists before proceeding
        // New format: [ClassName]_face_colors_[page].png
        const { page, index } = getPageAndIndex(this._selectedColor);
        const faceFilename = this._selectedClassName + "_face_colors_" + page;
        
        this._isValidating = true;
        this._colorWindow.deactivate();
        
        imageValidator.checkFaceImage(faceFilename, (exists, fname) => {
            this._isValidating = false;
            
            if (!exists) {
                this.showError("Face image not found: " + fname);
                SoundManager.playBuzzer();
                this._colorWindow.activate();
                return;
            }
            
            this._phase = "name";
            this._colorWindow.hide();
            this.hideError();
            
            Input.clear();
            
            this.startNameEntry();
            
            this.updatePreviewWithValidation();
            this.updateInstructions();
        });
    };
    
    Scene_CharacterCreation.prototype.onColorCancel = function() {
        this._phase = "hairstyle";
        this._colorWindow.deactivate();
        this._colorWindow.hide();
        this.hideError();
        
        Input.clear();
        
        this._hairstyleWindow.show();
        this._hairstyleWindow.activate();
        
        this.updatePreviewWithValidation();
        this.updateInstructions();
    };
    
    Scene_CharacterCreation.prototype.onColorChange = function(colorIndex) {
        this._selectedColor = colorIndex;
        this.updatePreviewWithValidation();
    };
    
    
    //-------------------------------------------------------------------------
    // Name Entry (keyboard typing + on-screen letter selection)
    //-------------------------------------------------------------------------

    //-------------------------------------------------------------------------
    // Custom Name Edit window for Character Creation
    // - Avoids drawing the actor face (which looks squashed with short windows)
    // - Draws a clean underline + caret
    //-------------------------------------------------------------------------
    class Window_CCNameEdit extends Window_NameEdit {
        refresh() {
            this.contents.clear();
            const rect = this.innerRect;
            const pad = 12;

            // Name text (left-aligned)
            this.resetTextColor();
            const name = this._name || "";
            const x = rect.x + pad;
            const y = rect.y + 4;
            const w = rect.width - pad * 2;

            this.drawText(name, x, y, w, "left");

            // Underline
            const lineY = y + this.lineHeight();
            this.contents.paintOpacity = 72;
            this.contents.fillRect(x, lineY, w, 2);
            this.contents.paintOpacity = 255;

            // Caret
            const caretX = x + this.textWidth(name.slice(0, this._index || 0));
            const caretH = this.lineHeight();
            this.contents.fillRect(Math.min(caretX, x + w - 2), y, 2, caretH);
        }
    }


    Scene_CharacterCreation.prototype.createNameWindows = function() {
        // Layout tuned for thick windowskins / wide borders
        const margin = 18;
        const x = 40;
        const y = 88;

        const w = 440;

        // Name edit (shows current name; no face)
        const editH = this.calcWindowHeight(2, false);
        const editRect = new Rectangle(x, y, w, editH);
        this._nameEditWindow = new Window_CCNameEdit(editRect);
        this._nameEditWindow.hide();
        this.addWindow(this._nameEditWindow);

        // On-screen keyboard (letters)
        const inputY = editRect.y + editRect.height + margin;
        const maxH = Graphics.boxHeight - 60 - margin - inputY; // keep instruction window at bottom
        const idealH = this.calcWindowHeight(10, true); // matches Window_NameInput table fairly well
        const inputH = Math.max(this.calcWindowHeight(8, true), Math.min(maxH, idealH));
        const inputRect = new Rectangle(x, inputY, w, inputH);

        this._nameInputWindow = new Window_NameInput(inputRect);
        this._nameInputWindow.setHandler("ok", this.onNameOk.bind(this));
        this._nameInputWindow.setHandler("cancel", this.onNameCancel.bind(this));
        this._nameInputWindow.hide();
        this._nameInputWindow.deactivate();
        this.addWindow(this._nameInputWindow);
    };

    Scene_CharacterCreation.prototype.startNameEntry = function() {
        const actor = $gameActors.actor(1);
        if (!actor) return;

        // Setup windows
        this._nameEditWindow.setup(actor, NAME_MAX_LENGTH);

        // Prefer whatever the player already typed in this scene; otherwise start blank.
        const dbName = (actor && typeof actor.actor === 'function' && actor.actor()) ? String(actor.actor().name || '').trim() : '';
        const currentName = (actor && typeof actor.name === 'function') ? String(actor.name()).trim() : '';
        const existingName = (currentName && dbName && currentName !== dbName) ? currentName : '';
        const startName = (this._selectedName || existingName || "").trim();
        this._nameEditWindow._name = startName;
        this._nameEditWindow._index = this._nameEditWindow._name.length;
        this._nameEditWindow.refresh();

        this._nameInputWindow.setEditWindow(this._nameEditWindow);

        this._nameEditWindow.show();
        this._nameInputWindow.show();
        this._nameInputWindow.activate();
        this._nameInputWindow.select(0);

        // Keyboard typing support (prevents Z/X from firing OK/Cancel while typing)
        MMO_TextEntry.attach(this._nameInputWindow, (key) => {
            // Only handle while name input is active/visible
            if (!this._nameInputWindow || !this._nameInputWindow.active) return false;

            // Always swallow typed characters so they don't become OK/Cancel
            if (key === "Backspace" || key === "Delete") {
                this._nameEditWindow.back();
                SoundManager.playCancel();
                return true;
            }

            if (key.length === 1) {
                // Allow letters, numbers, and spaces
                if (/^[a-zA-Z0-9]$/.test(key)) {
                    this._nameEditWindow.add(key);
                    SoundManager.playCursor();
                } else if (key === " ") {
                    this._nameEditWindow.add(" ");
                    SoundManager.playCursor();
                }
                return true; // swallow all single-char keys (including Z/X)
            }

            return false;
        });
    };

    Scene_CharacterCreation.prototype.endNameEntry = function() {
        MMO_TextEntry.detach(this);
        if (this._nameInputWindow) {
            this._nameInputWindow.deactivate();
            this._nameInputWindow.hide();
        }
        if (this._nameEditWindow) {
            this._nameEditWindow.hide();
        }
    };

    Scene_CharacterCreation.prototype.onNameOk = function() {
        const name = (this._nameEditWindow ? this._nameEditWindow.name() : "").trim();
        if (!name) {
            SoundManager.playBuzzer();
            this.showError("Please enter a character name.");
            this._nameInputWindow.activate();
            return;
        }

        this._selectedName = name;
        this.endNameEntry();

        this._phase = "confirm";
        this.hideError();

        this._confirmWindow.show();
        this._confirmWindow.select(0);
        this._confirmWindow.activate();

        this.updateInstructions();
    };

    Scene_CharacterCreation.prototype.onNameCancel = function() {
        // Go back to color selection (cannot exit the scene)
        this.endNameEntry();
        this._phase = "color";
        this.hideError();

        this._colorWindow.show();
        this._colorWindow.activate();

        this.updateInstructions();
    };

//-------------------------------------------------------------------------
    // Confirm Window
    //-------------------------------------------------------------------------
    
    Scene_CharacterCreation.prototype.createConfirmWindow = function() {
        const rect = new Rectangle(50, 80, 300, 150);
        this._confirmWindow = new Window_ConfirmCreation(rect);
        this._confirmWindow.setHandler("confirm", this.onConfirmOk.bind(this));
        this._confirmWindow.setHandler("cancel", this.onConfirmCancel.bind(this));
        this._confirmWindow.hide();
        this._confirmWindow.deactivate();
        this.addWindow(this._confirmWindow);
    };
    
    Scene_CharacterCreation.prototype.onConfirmOk = function() {
        const success = this.applyCharacterCreation();
        if (success) {
            $gameSwitches.setValue(20, true);
            SceneManager.pop();
        } else {
            this._confirmWindow.activate();
        }
    };
    
    Scene_CharacterCreation.prototype.onConfirmCancel = function() {
        this._phase = "name";
        this._confirmWindow.deactivate();
        this._confirmWindow.hide();
        this.hideError();
        
        Input.clear();
        
        this.startNameEntry();
        
        this.updateInstructions();
    };
    
    //-------------------------------------------------------------------------
    // Character Preview Sprite (for hairstyle/color phases)
    //-------------------------------------------------------------------------
    
    Scene_CharacterCreation.prototype.createPreviewSprite = function() {
        // Single preview sprite for color selection
        this._previewSprite = new Sprite_CharacterPreview();
        this._previewSprite.x = PREVIEW_X;
        this._previewSprite.y = PREVIEW_Y;
        this._previewSprite.scale.x = PREVIEW_SCALE;
        this._previewSprite.scale.y = PREVIEW_SCALE;
        this._previewSprite.visible = false;
        this.addChild(this._previewSprite);
        
        // Dual preview sprites for hairstyle selection (male left, female right)
        this._maleHairPreview = new Sprite_CharacterPreview();
        this._maleHairPreview.x = PREVIEW_X - 40;
        this._maleHairPreview.y = PREVIEW_Y;
        this._maleHairPreview.scale.x = PREVIEW_SCALE;
        this._maleHairPreview.scale.y = PREVIEW_SCALE;
        this._maleHairPreview.visible = false;
        this.addChild(this._maleHairPreview);
        
        this._femaleHairPreview = new Sprite_CharacterPreview();
        this._femaleHairPreview.x = PREVIEW_X + 40;
        this._femaleHairPreview.y = PREVIEW_Y;
        this._femaleHairPreview.scale.x = PREVIEW_SCALE;
        this._femaleHairPreview.scale.y = PREVIEW_SCALE;
        this._femaleHairPreview.visible = false;
        this.addChild(this._femaleHairPreview);
    };
    
    Scene_CharacterCreation.prototype.updatePreviewWithValidation = function() {
        if (!this._previewSprite) return;
        
        if (this._phase === "hairstyle") {
            // Hairstyle preview: show male and female side by side
            // Each page has 4 hairstyles: indexes 0&1, 2&3, 4&5, 6&7
            this._previewSprite.visible = false;
            this._maleHairPreview.visible = true;
            this._femaleHairPreview.visible = true;
            
            const hsInfo = getHairstylePageAndIndexes(this._selectedHairstyle);
            const filename = this._selectedClassName + "_hairstyles_" + hsInfo.page;
            
            const self = this;
            imageValidator.checkCharacterImage(filename, (exists, fname) => {
                if (exists) {
                    self.hideError();
                    self._maleHairPreview.setCharacterDirect(fname, hsInfo.maleIndex);
                    self._femaleHairPreview.setCharacterDirect(fname, hsInfo.femaleIndex);
                } else {
                    self.showError("Hairstyle image not found: " + fname);
                    self._maleHairPreview.setCharacterDirect(FALLBACK_CHARACTER, 0);
                    self._femaleHairPreview.setCharacterDirect(FALLBACK_CHARACTER, 1);
                }
            });
        } else if (this._phase === "color" || this._phase === "confirm") {
            // Color preview: single sprite
            this._previewSprite.visible = true;
            this._maleHairPreview.visible = false;
            this._femaleHairPreview.visible = false;
            
            const pageInfo = getPageAndIndex(this._selectedColor);
            const filename = this._selectedClassName + "_hair_" + this._selectedHairstyle + "_colors_" + pageInfo.page;
            const index = pageInfo.index;
            
            const self = this;
            imageValidator.checkCharacterImage(filename, (exists, fname) => {
                if (exists) {
                    self.hideError();
                    self._previewSprite.setCharacterDirect(fname, index);
                } else {
                    self.showError("Hair color image not found: " + fname);
                    self._previewSprite.setCharacterDirect(FALLBACK_CHARACTER, 0);
                }
            });
        }
    };
    
    Scene_CharacterCreation.prototype.clearPreview = function() {
        if (this._previewSprite) {
            this._previewSprite.bitmap = null;
            this._previewSprite.visible = false;
        }
        if (this._maleHairPreview) {
            this._maleHairPreview.bitmap = null;
            this._maleHairPreview.visible = false;
        }
        if (this._femaleHairPreview) {
            this._femaleHairPreview.bitmap = null;
            this._femaleHairPreview.visible = false;
        }
    };
    
    //-------------------------------------------------------------------------
    // Apply Character Creation
    //-------------------------------------------------------------------------
    
    Scene_CharacterCreation.prototype.applyCharacterCreation = function() {
        const actor = $gameActors.actor(1);
        if (!actor) {
            this.showError("Error: Actor 1 not found in database!");
            return false;
        }
        
        const finalName = (this._selectedName || "").trim();
        if (!finalName) {
            this.showError("Please enter a character name.");
            return false;
        }
        
        // Calculate page and index for the selected color
        const colorPageInfo = getPageAndIndex(this._selectedColor);
        
        // Character file: [ClassName]_hair_[hairstyle]_colors_[page].png
        const characterFile = this._selectedClassName + "_hair_" + this._selectedHairstyle + "_colors_" + colorPageInfo.page;
        
        // Face file: [ClassName]_face_colors_[page].png
        const faceFile = this._selectedClassName + "_face_colors_" + colorPageInfo.page;
        
        // Index within the page (0-7)
        const colorIndex = colorPageInfo.index;
        
        try {
            actor.setName(finalName);
            actor.setCharacterImage(characterFile, colorIndex);
            actor.setFaceImage(faceFile, colorIndex);
            actor.changeClass(this._selectedClassId, false);
            $gamePlayer.refresh();
            
            console.log("Character Created:");
            console.log("  Class:", this._selectedClassName, "(ID:", this._selectedClassId, ")");
            console.log("  Hairstyle:", this._selectedHairstyle);
            console.log("  Color:", this._selectedColor, "(Page:", colorPageInfo.page, "Index:", colorIndex, ")");
            console.log("  Character File:", characterFile);
            console.log("  Face File:", faceFile);
            
            return true;
        } catch (e) {
            console.error("Character_Creation: Error applying character creation", e);
            this.showError("Error creating character: " + e.message);
            return false;
        }
    };
    
    //=========================================================================
    // Window_ClassSelect - Shows ALL classes from database
    //=========================================================================
    
    function Window_ClassSelect() {
        this.initialize(...arguments);
    }
    
    Window_ClassSelect.prototype = Object.create(Window_Selectable.prototype);
    Window_ClassSelect.prototype.constructor = Window_ClassSelect;
    
    Window_ClassSelect.prototype.initialize = function(rect) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._data = [];
        this._selectCallback = null;
        this.refresh();
        this.select(0);
    };
    
    Window_ClassSelect.prototype.setSelectCallback = function(callback) {
        this._selectCallback = callback;
    };
    
    Window_ClassSelect.prototype.maxItems = function() {
        return this._data.length;
    };
    
    Window_ClassSelect.prototype.item = function() {
        return this._data[this.index()];
    };
    
    Window_ClassSelect.prototype.currentClassId = function() {
        const item = this.item();
        return item ? item.classId : 1;
    };
    
    Window_ClassSelect.prototype.refresh = function() {
        this._data = [];
        
        // Get ALL classes from database (skip index 0 which is null)
        for (let i = 1; i < $dataClasses.length; i++) {
            const classData = $dataClasses[i];
            if (classData && classData.name) {
                const config = getClassConfig(i);
                this._data.push({
                    classId: i,
                    name: classData.name,
                    hasConfig: config !== null,
                    hasHairstyles: config && config.hairstylePages > 0
                });
            }
        }
        
        Window_Selectable.prototype.refresh.call(this);
    };
    
    Window_ClassSelect.prototype.drawItem = function(index) {
        const item = this._data[index];
        if (!item) return;
        
        const rect = this.itemLineRect(index);
        
        // Gray out classes without hairstyles
        if (!item.hasHairstyles) {
            this.changeTextColor("#888888");
        } else {
            this.resetTextColor();
        }
        
        this.drawText(item.name, rect.x, rect.y, rect.width);
        this.resetTextColor();
    };
    
    Window_ClassSelect.prototype.select = function(index) {
        Window_Selectable.prototype.select.call(this, index);
        if (this._selectCallback && index >= 0) {
            const item = this._data[index];
            if (item) {
                this._selectCallback(item.classId);
            }
        }
    };
    
    //=========================================================================
    // Window_HairstyleSelect
    //=========================================================================
    
    function Window_HairstyleSelect() {
        this.initialize(...arguments);
    }
    
    Window_HairstyleSelect.prototype = Object.create(Window_Base.prototype);
    Window_HairstyleSelect.prototype.constructor = Window_HairstyleSelect;
    
    Window_HairstyleSelect.prototype.initialize = function(rect, scene) {
        Window_Base.prototype.initialize.call(this, rect);
        this._scene = scene;
        this._classId = null;
        this._className = "";
        this._currentHairstyle = 0;
        this._maxHairstyles = 8;
        this._changeCallback = null;
        this._handlers = {};
        this._active = false;
        this._inputDelay = 0;
        this.refresh();
    };
    
    Window_HairstyleSelect.prototype.setClass = function(classId, className) {
        this._classId = classId;
        this._className = className;
        this._currentHairstyle = 0;
        this._maxHairstyles = getTotalHairstyles(classId);
        this.refresh();
    };
    
    Window_HairstyleSelect.prototype.setChangeCallback = function(callback) {
        this._changeCallback = callback;
    };
    
    Window_HairstyleSelect.prototype.currentHairstyle = function() {
        return this._currentHairstyle;
    };
    
    Window_HairstyleSelect.prototype.setHandler = function(symbol, method) {
        this._handlers[symbol] = method;
    };
    
    Window_HairstyleSelect.prototype.callHandler = function(symbol) {
        if (this._handlers[symbol]) {
            this._handlers[symbol]();
        }
    };
    
    Window_HairstyleSelect.prototype.activate = function() {
        this._active = true;
        this._inputDelay = 10;
    };
    
    Window_HairstyleSelect.prototype.deactivate = function() {
        this._active = false;
    };
    
    Window_HairstyleSelect.prototype.isActive = function() {
        return this._active && this.visible;
    };
    
    Window_HairstyleSelect.prototype.refresh = function() {
        this.contents.clear();
        
        this.contents.fontSize = 20;
        this.drawText("Class: " + this._className, 0, 0, this.contentsWidth());
        this.drawText("Hairstyle: " + (this._currentHairstyle + 1) + " / " + this._maxHairstyles, 0, 30, this.contentsWidth());
        this.drawText("◄  Use Left/Right  ►", 0, 70, this.contentsWidth(), "center");
    };
    
    Window_HairstyleSelect.prototype.update = function() {
        Window_Base.prototype.update.call(this);
        if (this._inputDelay > 0) {
            this._inputDelay--;
            return;
        }
        if (this.isActive()) {
            this.processInput();
        }
    };
    
    Window_HairstyleSelect.prototype.processInput = function() {
        if (Input.isRepeated("left")) {
            this.cursorLeft();
        } else if (Input.isRepeated("right")) {
            this.cursorRight();
        } else if (Input.isTriggered("ok")) {
            SoundManager.playOk();
            Input.clear();
            this.callHandler("ok");
        } else if (Input.isTriggered("cancel")) {
            SoundManager.playCancel();
            Input.clear();
            this.callHandler("cancel");
        }
    };
    
    Window_HairstyleSelect.prototype.cursorLeft = function() {
        this._currentHairstyle--;
        if (this._currentHairstyle < 0) {
            this._currentHairstyle = this._maxHairstyles - 1;
        }
        SoundManager.playCursor();
        this.refresh();
        if (this._changeCallback) {
            this._changeCallback(this._currentHairstyle);
        }
    };
    
    Window_HairstyleSelect.prototype.cursorRight = function() {
        this._currentHairstyle++;
        if (this._currentHairstyle >= this._maxHairstyles) {
            this._currentHairstyle = 0;
        }
        SoundManager.playCursor();
        this.refresh();
        if (this._changeCallback) {
            this._changeCallback(this._currentHairstyle);
        }
    };
    
    //=========================================================================
    // Window_ColorSelect
    //=========================================================================
    
    function Window_ColorSelect() {
        this.initialize(...arguments);
    }
    
    Window_ColorSelect.prototype = Object.create(Window_Base.prototype);
    Window_ColorSelect.prototype.constructor = Window_ColorSelect;
    
    Window_ColorSelect.prototype.initialize = function(rect, scene) {
        Window_Base.prototype.initialize.call(this, rect);
        this._scene = scene;
        this._classId = null;
        this._className = "";
        this._hairstyle = 0;
        this._currentColor = 0;
        this._maxColors = 8;
        this._changeCallback = null;
        this._handlers = {};
        this._active = false;
        this._inputDelay = 0;
        this.refresh();
    };
    
    Window_ColorSelect.prototype.setHairstyle = function(classId, className, hairstyle) {
        this._classId = classId;
        this._className = className;
        this._hairstyle = hairstyle;
        this._currentColor = 0;
        this._maxColors = getTotalColors(classId);
        this.refresh();
    };
    
    Window_ColorSelect.prototype.setChangeCallback = function(callback) {
        this._changeCallback = callback;
    };
    
    Window_ColorSelect.prototype.currentColor = function() {
        return this._currentColor;
    };
    
    Window_ColorSelect.prototype.setHandler = function(symbol, method) {
        this._handlers[symbol] = method;
    };
    
    Window_ColorSelect.prototype.callHandler = function(symbol) {
        if (this._handlers[symbol]) {
            this._handlers[symbol]();
        }
    };
    
    Window_ColorSelect.prototype.activate = function() {
        this._active = true;
        this._inputDelay = 10;
    };
    
    Window_ColorSelect.prototype.deactivate = function() {
        this._active = false;
    };
    
    Window_ColorSelect.prototype.isActive = function() {
        return this._active && this.visible;
    };
    
    Window_ColorSelect.prototype.refresh = function() {
        this.contents.clear();
        
        this.contents.fontSize = 20;
        this.drawText("Hairstyle: " + (this._hairstyle + 1), 0, 0, this.contentsWidth());
        this.drawText("Color: " + (this._currentColor + 1) + " / " + this._maxColors, 0, 30, this.contentsWidth());
        this.drawText("◄  Use Left/Right  ►", 0, 70, this.contentsWidth(), "center");
    };
    
    Window_ColorSelect.prototype.update = function() {
        Window_Base.prototype.update.call(this);
        if (this._inputDelay > 0) {
            this._inputDelay--;
            return;
        }
        if (this.isActive()) {
            this.processInput();
        }
    };
    
    Window_ColorSelect.prototype.processInput = function() {
        if (Input.isRepeated("left")) {
            this.cursorLeft();
        } else if (Input.isRepeated("right")) {
            this.cursorRight();
        } else if (Input.isTriggered("ok")) {
            SoundManager.playOk();
            Input.clear();
            this.callHandler("ok");
        } else if (Input.isTriggered("cancel")) {
            SoundManager.playCancel();
            Input.clear();
            this.callHandler("cancel");
        }
    };
    
    Window_ColorSelect.prototype.cursorLeft = function() {
        this._currentColor--;
        if (this._currentColor < 0) {
            this._currentColor = this._maxColors - 1;
        }
        SoundManager.playCursor();
        this.refresh();
        if (this._changeCallback) {
            this._changeCallback(this._currentColor);
        }
    };
    
    Window_ColorSelect.prototype.cursorRight = function() {
        this._currentColor++;
        if (this._currentColor >= this._maxColors) {
            this._currentColor = 0;
        }
        SoundManager.playCursor();
        this.refresh();
        if (this._changeCallback) {
            this._changeCallback(this._currentColor);
        }
    };
    
    //=========================================================================
    // Window_ConfirmCreation
    //=========================================================================
    
    function Window_ConfirmCreation() {
        this.initialize(...arguments);
    }
    
    Window_ConfirmCreation.prototype = Object.create(Window_Command.prototype);
    Window_ConfirmCreation.prototype.constructor = Window_ConfirmCreation;
    
    Window_ConfirmCreation.prototype.initialize = function(rect) {
        Window_Command.prototype.initialize.call(this, rect);
        this._inputDelay = 0;
    };
    
    Window_ConfirmCreation.prototype.makeCommandList = function() {
        this.addCommand("Confirm", "confirm");
        this.addCommand("Go Back", "cancel");
    };
    
    Window_ConfirmCreation.prototype.activate = function() {
        Window_Command.prototype.activate.call(this);
        this._inputDelay = 10;
    };
    
    Window_ConfirmCreation.prototype.update = function() {
        if (this._inputDelay > 0) {
            this._inputDelay--;
            return;
        }
        Window_Command.prototype.update.call(this);
    };
    
    //=========================================================================
    // Sprite_CharacterPreview
    //=========================================================================
    
    function Sprite_CharacterPreview() {
        this.initialize(...arguments);
    }
    
    Sprite_CharacterPreview.prototype = Object.create(Sprite.prototype);
    Sprite_CharacterPreview.prototype.constructor = Sprite_CharacterPreview;
    
    Sprite_CharacterPreview.prototype.initialize = function() {
        Sprite.prototype.initialize.call(this);
        this._characterName = "";
        this._characterIndex = 0;
        this._animationCount = 0;
        this._pattern = 1;
        this._direction = 2;
    };
    
    Sprite_CharacterPreview.prototype.setCharacterDirect = function(filename, index) {
        this._characterName = filename;
        this._characterIndex = index;
        this._pattern = 1;
        
        if (filename) {
            this.bitmap = ImageManager.loadCharacter(filename);
            this.bitmap.addLoadListener(this.updateFrame.bind(this));
        } else {
            this.bitmap = null;
        }
    };
    
    Sprite_CharacterPreview.prototype.update = function() {
        Sprite.prototype.update.call(this);
        this.updateAnimation();
    };
    
    Sprite_CharacterPreview.prototype.updateAnimation = function() {
        this._animationCount++;
        if (this._animationCount >= 15) {
            this._animationCount = 0;
            this._pattern = (this._pattern + 1) % 4;
            if (this._pattern === 3) this._pattern = 1;
            this.updateFrame();
        }
    };
    
    Sprite_CharacterPreview.prototype.updateFrame = function() {
        if (!this.bitmap || !this.bitmap.isReady()) return;
        
        const isBig = ImageManager.isBigCharacter(this._characterName);
        const pw = this.bitmap.width / (isBig ? 3 : 12);
        const ph = this.bitmap.height / (isBig ? 4 : 8);
        
        const sx = ((this._characterIndex % 4) * 3 + this._pattern) * pw;
        const sy = (Math.floor(this._characterIndex / 4) * 4 + (this._direction / 2 - 1)) * ph;
        
        this.setFrame(sx, sy, pw, ph);
        this.anchor.x = 0.5;
        this.anchor.y = 1;
    };
    
    //=========================================================================
    // Export for global access
    //=========================================================================
    
    window.Scene_CharacterCreation = Scene_CharacterCreation;
    
})();