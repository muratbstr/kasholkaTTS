function localCheck(name, action) {
    check(name, function () {
        uiLanguage = 'ru';
        languageSettings = { preference: 'system', controller: null, items: [], options: [] };
        action();
    });
}

localCheck('system language handles region codes, overrides and unsupported languages', function () {
    assert(resolveUILanguage('system', ['ru-RU', 'en-US']) === 'ru');
    assert(resolveUILanguage('system', ['en_GB', 'ru']) === 'en');
    assert(resolveUILanguage('system', ['de-DE', 'ru']) === 'en');
    assert(resolveUILanguage('ru', ['en-US']) === 'ru');
    assert(resolveUILanguage('en', ['ru-RU']) === 'en');
    assert(resolveUILanguage('invalid', []) === 'en');
});

localCheck('translation fallback and placeholders never translate supplied text or paths', function () {
    uiLanguage = 'en';
    assert(t('Читать') === 'Read');
    assert(t('unknown key') === 'unknown key');
    assert(t('О kasholkaTTS Beta') === 'About kasholkaTTS Beta');
    assert(t('Аудио сохранено: {path}', {path: '/tmp/Читать {total} 😀.wav'}) === 'Audio saved: /tmp/Читать {total} 😀.wav');
    assert(t('Загрузка обновления: {downloaded} / {total} МБ. Отмена — в меню «Обновления».',
        {downloaded: 0, total: 3}) === 'Downloading update: 0 / 3 MB. Cancel in the Updates menu.');
    assert(t('Аудио сохранено: {path}') === 'Audio saved: {path}');
    uiLanguage = 'ru'; assert(t('Читать') === 'Читать');
    assert(t('Аудио сохранено: {path}', {path: '/tmp/test.wav'}) === 'Аудио сохранено: /tmp/test.wav');
    UI_CATALOGS.fr = {name: 'Français', messages: {'Читать': 'Lire'}};
    uiLanguage = 'fr'; assert(t('Читать') === 'Lire' && t('Стоп') === 'Stop');
    delete UI_CATALOGS.fr;
});

localCheck('voice language and region headings translate but voice names remain intact', function () {
    uiLanguage = 'en';
    assert(voiceGroup({id: 'normal', locale: 'en_GB'}).title === 'English (United Kingdom)');
    assert(voiceGroup({id: 'normal', locale: 'ru_RU'}).title === 'Russian (Russia)');
    assert(voiceGroup({id: 'com.apple.speech.synthesis.voice.Bells', locale: 'en_US'}).title === 'English (United States) — Novelty');
    voices = [{id: 'ru', name: 'Юрий', locale: 'ru_RU', engine: 'ns'},
        {id: 'en', name: 'Daniel', locale: 'en_GB', engine: 'ns'}];
    populateVoices('ru', false);
    assert(voices[0].id === 'en');
    assert(selectedVoice().id === 'ru' && selectedVoice().name === 'Юрий');
});

localCheck('speech controls and preview language stay independent of UI language', function () {
    uiLanguage = 'en';
    active = true; paused = true; updateControls();
    assert(ui.pause.title === 'Resume');
    paused = false; updateControls(); assert(ui.pause.title === 'Pause');
    active = false; applyRate(); assert(/ wpm$/.test(ui.rateValue.stringValue));
    assert(voicePreviewText('ru_RU') === 'Привет! Так звучит мой голос. Один, два, три. Приятного прослушивания!');
    uiLanguage = 'ru'; assert(voicePreviewText('en_GB').indexOf('Hello') === 0);
});

localCheck('known helper failures translate without replacing arbitrary substrings', function () {
    uiLanguage = 'en';
    assert(helperError('Error: Приложение больше не отвечает.') === 'Error: The app is no longer responding.');
    assert(helperError('/tmp/Приложение больше не отвечает.') === '/tmp/Приложение больше не отвечает.');
    assert(helperError('Нет текста для чтения.') === 'No text to read.');
});

localCheck('menu action persists preference, preserves active session and applies next launch', function () {
    $.KasholkaLanguageController = {alloc: {init: {}}};
    var menu = {items: [], addItemWithTitleActionKeyEquivalent: function (title, selector, key) {
        var item = {title: title, selector: selector}; this.items.push(item); return item;
    }};
    $.NSMenu = {alloc: {initWithTitle: function () { return menu; }}};
    $.NSMenuItem = {alloc: {init: {}}};
    var parent;
    installLanguageMenu({addItem: function (item) {parent = item;}});
    assert(parent.title === 'Язык / Language');
    assert(menu.items[1].title === 'Русский' && menu.items[2].title === 'English');
    var alert;
    alertUser = function (title, message) { alert = message; };
    ui.editor.string = 'Не потеряй 😀'; active = true;
    registered.methods['uiLanguage:'].implementation(menu.items[2]);
    assert(defaults.objectForKey('uiLanguage') === 'en');
    assert(uiLanguage === 'ru' && active && ui.editor.string === 'Не потеряй 😀');
    assert(menu.items[2].state === 1 && menu.items[0].state === 0);
    assert(alert.indexOf('следующем запуске') !== -1);
    $.NSLocale = {preferredLanguages: ['ru-RU']}; ObjC.deepUnwrap = function (value) {return value;};
    initLocalization(); assert(uiLanguage === 'en');
    chooseUILanguage('system'); initLocalization(); assert(uiLanguage === 'ru');
});
