/* UI_CATALOGS is embedded by scripts/localization.py. No runtime downloads. */
var uiLanguage = 'ru';
var languageSettings = { preference: 'system', controller: null, items: [], options: [] };

function supportedUILanguage(code) {
    return code === 'ru' || Object.prototype.hasOwnProperty.call(UI_CATALOGS, code);
}

function resolveUILanguage(preference, preferred) {
    if (supportedUILanguage(preference)) return preference;
    var code = String((preferred || [])[0] || 'en').split(/[-_]/)[0].toLowerCase();
    return supportedUILanguage(code) ? code : 'en';
}

function translateText(text, parameters) {
    if (typeof text !== 'string') return text;
    var catalog = (UI_CATALOGS[uiLanguage] || {}).messages || {};
    var english = UI_CATALOGS.en.messages;
    // Beta changes display names in the base source. Catalogs use the base name.
    var beta = text.indexOf('kasholkaTTS Beta') !== -1;
    var key = beta ? text.replace(/kasholkaTTS Beta/g, 'kasholkaTTS') : text;
    var value = uiLanguage === 'ru' ? key : Object.prototype.hasOwnProperty.call(catalog, key) ? catalog[key] :
        Object.prototype.hasOwnProperty.call(english, key) ? english[key] : key;
    if (beta) value = value.replace(/kasholkaTTS/g, 'kasholkaTTS Beta');
    return value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (match, name) {
        return parameters && Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match;
    });
}

function translateHelperError(message) {
    // Exact helper errors only. Never perform translation over user text/paths.
    var value = String(message || '');
    var prefix = /^(Error: |JXAError: )/.exec(value);
    return prefix ? prefix[0] + translateText(value.slice(prefix[0].length)) : translateText(value);
}

function initLocalization() {
    var preference = unwrap(defaults.objectForKey($('uiLanguage')), 'system');
    languageSettings.preference = supportedUILanguage(preference) ? preference : 'system';
    var preferred = ObjC.deepUnwrap($.NSLocale.preferredLanguages);
    uiLanguage = resolveUILanguage(languageSettings.preference, preferred);
}

function chooseUILanguage(preference) {
    if (preference !== 'system' && !supportedUILanguage(preference)) return;
    if (languageSettings.preference === preference) return;
    defaults.setObjectForKey($(preference), $('uiLanguage'));
    defaults.synchronize;
    languageSettings.preference = preference;
    languageSettings.items.forEach(function (item, index) {
        item.state = languageSettings.options[index] === preference ? 1 : 0;
    });
    // Keep the current session intact. Do not rebuild menus/windows during speech.
    alertUser(t('Язык интерфейса'), t('Новый язык применится при следующем запуске. Перед выходом сохраните нужный текст.'));
}

function installLanguageMenu(appMenu) {
    ObjC.registerSubclass({ name: 'KasholkaLanguageController', superclass: 'NSObject', methods: {
        'uiLanguage:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () { chooseUILanguage(languageSettings.options[Number(sender.tag)]); })();
        } }
    } });
    languageSettings.controller = $.KasholkaLanguageController.alloc.init;
    var menu = $.NSMenu.alloc.initWithTitle($(t('Язык / Language')));
    menu.autoenablesItems = false;
    var choices = [{ code: 'system', name: t('Как в macOS') }, { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' }];
    Object.keys(UI_CATALOGS).sort().forEach(function (code) {
        if (code !== 'ru') choices.push({ code: code, name: UI_CATALOGS[code].name });
    });
    languageSettings.items = []; languageSettings.options = [];
    choices.forEach(function (choice, index) {
        var item = menu.addItemWithTitleActionKeyEquivalent($(choice.name), 'uiLanguage:', $(''));
        item.target = languageSettings.controller; item.tag = index;
        item.state = languageSettings.preference === choice.code ? 1 : 0;
        languageSettings.items.push(item); languageSettings.options.push(choice.code);
    });
    var parent = $.NSMenuItem.alloc.init;
    parent.title = $(t('Язык / Language')); parent.submenu = menu; appMenu.addItem(parent);
}
