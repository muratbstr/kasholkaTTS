/* Shortcuts bridge: explicit user-selected workflow, argv only, private text file. */
var betaShortcut = {view: null, controller: null, names: [], job: null, message: ''};
function betaShortcutOwnsJob() { return !!betaShortcut.job && betaShortcut.job === betaJob; }
function betaShortcutParseList(text) {
    var names = String(text).split('\n').map(function (name) {return name.replace(/\r$/, '');}).filter(function (name) {return name.length > 0;});
    if (names.some(function (name) {return /[\x00-\x1f]/.test(name);})) throw new Error(t('Некорректный список команд.'));
    var seen = Object.create(null);
    names.forEach(function (name) {
        if (seen[name]) throw new Error(t('Есть команды с одинаковыми именами. Переименуйте их в «Командах» и обновите список.'));
        seen[name] = true;
    });
    return names;
}
function betaShortcutName() {
    if (!betaShortcut.view) return '';
    var index = Number(betaShortcut.view.choice.indexOfSelectedItem) - 1;
    return index >= 0 && index < betaShortcut.names.length ? betaShortcut.names[index] : '';
}
function betaShortcutSync() {
    var view = betaShortcut.view;
    if (!view) return;
    var owned = betaShortcutOwnsJob(), busy = betaToolsBusy();
    if (betaShortcut.job && !owned) {
        var result = betaReport[betaShortcut.job.mode] || {};
        betaShortcut.message = result.error || (result.state === 'cancelled' ? t('Ожидание прервано. Если речь продолжается, остановите её в «Командах».') : betaShortcut.message);
        betaShortcut.job = null;
    }
    view.choice.enabled = view.refresh.enabled = !busy;
    view.run.enabled = !busy && !!betaShortcutName();
    view.run.contentTintColor = view.run.enabled ? betaAccentTextColor() : $.NSColor.disabledControlTextColor;
    view.cancel.enabled = owned;
    if (owned) {
        view.progress.startAnimation($());
        view.status.stringValue = $(betaJob.mode === 'shortcuts-list' ? t('Получаю список команд…') :
            t('Команда выполняется. Если появилось подтверждение macOS, ответьте в «Командах».'));
    } else {
        view.progress.stopAnimation($());
        view.status.stringValue = $(betaShortcut.message || t('Создайте команду, затем нажмите «Обновить список».'));
    }
    view.status.toolTip = view.status.stringValue;
}
function betaShortcutLaunch(mode, name, text) {
    if (betaToolsBusy()) return;
    if (!$.NSFileManager.defaultManager.isExecutableFileAtPath($('/usr/bin/shortcuts'))) {
        betaShortcut.message = t('Утилита shortcuts недоступна. Нужна macOS Monterey 12 или новее.'); betaShortcutSync(); return;
    }
    betaShortcut.message = '';
    betaReport[mode] = {state: 'running'};
    // Reuse the existing Beta ownership slot, timer and cleanup, without changing the voice.
    active = true; paused = false;
    try { betaStartJob(mode, text, name); betaShortcut.job = betaJob; }
    catch (error) {
        active = false;
        // Avoid raw stderr or exceptions containing shortcut input in copyable reports.
        betaReport[mode] = {state: 'error', error: t('Не удалось запустить «Команды».')};
        betaShortcut.message = betaReport[mode].error;
    }
    updateControls(); betaShortcutSync();
}
function betaShortcutRefresh() {
    if (betaToolsBusy()) return;
    betaShortcutLaunch('shortcuts-list');
}
function betaShortcutRun() {
    if (betaToolsBusy()) return;
    var name = betaShortcutName();
    if (!name) { betaShortcut.message = t('Сначала выберите команду из списка.'); betaShortcutSync(); return; }
    if (name.charAt(0) === '-' || /[\x00-\x1f]/.test(name)) {
        betaShortcut.message = t('Переименуйте команду: имя не должно начинаться с дефиса или содержать управляющие символы.'); betaShortcutSync(); return;
    }
    var range = ui.editor.selectedRange;
    var text = textToRead(unwrap(ui.editor.string, ''), Number(range.location), Number(range.length));
    if (!text.trim()) { betaShortcut.message = t('Сначала введите текст или выделите фрагмент.'); betaShortcutSync(); return; }
    defaults.setObjectForKey($(name), $('betaShortcutName'));
    betaShortcutLaunch('shortcuts-run', name, text);
}
function betaShortcutTick() {
    var job = betaJob;
    if (!job || (job.mode !== 'shortcuts-list' && job.mode !== 'shortcuts-run')) return;
    var mode = job.mode;
    try {
        if (job.task.running) {
            if (mode === 'shortcuts-list' && Date.now() > job.deadline) throw new Error(t('Список команд не получен за 20 секунд. Откройте «Команды» и повторите.'));
            return;
        }
        var code = Number(job.task.terminationStatus);
        if (code !== 0) throw new Error(t('«Команды» завершились с кодом {code}. Проверьте запуск и разрешения внутри приложения «Команды».', {code: code}));
        if (mode === 'shortcuts-list') {
            var names = betaShortcutParseList(readHostText(job.directory + '/shortcuts.txt'));
            betaShortcut.names = names;
            var popup = betaShortcut.view.choice, preferred = unwrap(defaults.objectForKey($('betaShortcutName')), 'kasholkaTTS Siri');
            popup.removeAllItems; popup.addItemWithTitle($(t('Выберите команду…')));
            names.forEach(function (name) {popup.addItemWithTitle($(name));});
            var selected = names.indexOf(preferred); popup.selectItemAtIndex(selected < 0 ? 0 : selected + 1);
            betaReport[mode] = {state: 'finished', count: names.length};
            betaShortcut.message = names.length ? t('Список обновлён. Выберите свою команду для чтения.') : t('Команд пока нет. Создайте команду и обновите список.');
        } else {
            betaReport[mode] = {state: 'finished', exitCode: 0, identity: 'Shortcut completed; Siri unverified'};
            betaShortcut.message = t('Команда завершилась. Это не подтверждает голос Siri — сравните звучание с системной пробой.');
        }
    } catch (error) {
        betaReport[mode] = {state: 'error', error: String(error)};
        betaShortcut.message = String(error);
        if (mode === 'shortcuts-list') {
            betaShortcut.names = []; betaShortcut.view.choice.removeAllItems;
            betaShortcut.view.choice.addItemWithTitle($(t('Выберите команду…')));
            betaShortcut.view.choice.selectItemAtIndex(0);
        }
    }
    betaShortcut.job = null; betaDisposeJob(); active = paused = false; updateControls(); betaShortcutSync();
}
function betaShortcutCancel() {
    if (!betaShortcutOwnsJob()) return;
    betaReport[betaJob.mode] = {state: 'cancelled'};
    betaShortcut.job = null; betaDisposeJob(); active = paused = false;
    betaShortcut.message = t('Ожидание прервано. Если речь продолжается, остановите её в «Командах».');
    updateControls(); betaShortcutSync();
}
function betaShortcutOpenApp() {
    if (!$.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($('shortcuts://')))) {
        betaShortcut.message = t('Откройте приложение «Команды» вручную.'); betaShortcutSync();
    }
}
function betaShortcutClose() { if (betaShortcut.view) betaShortcut.view.window.orderOut($()); }
function betaShortcutRegister() {
    if (betaShortcut.controller) return;
    ObjC.registerSubclass({name: 'KasholkaBetaShortcutWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function () { betaShortcutClose(); }
    }});
    ObjC.registerSubclass({name: 'KasholkaBetaShortcutController', superclass: 'NSObject', methods: {
        'refresh:': {types: ['void', ['id']], implementation: guarded(betaShortcutRefresh)},
        'choose:': {types: ['void', ['id']], implementation: guarded(betaShortcutSync)},
        'run:': {types: ['void', ['id']], implementation: guarded(betaShortcutRun)},
        'cancel:': {types: ['void', ['id']], implementation: guarded(betaShortcutCancel)},
        'open:': {types: ['void', ['id']], implementation: guarded(betaShortcutOpenApp)},
        'close:': {types: ['void', ['id']], implementation: guarded(betaShortcutClose)},
        'windowShouldClose:': {types: ['bool', ['id']], implementation: function () {betaShortcutClose(); return false;}}
    }});
    betaShortcut.controller = $.KasholkaBetaShortcutController.alloc.init;
}
function betaShortcutShow() {
    betaShortcutRegister();
    if (!betaShortcut.view) {
        var window = $.KasholkaBetaShortcutWindow.alloc.initWithContentRectStyleMaskBackingDefer(
            $.NSMakeRect(0, 0, 620, 490), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
        window.title = $(t('Siri через «Команды»')); window.releasedWhenClosed = false; window.delegate = betaShortcut.controller;
        var close = window.standardWindowButton($.NSWindowCloseButton); close.target = betaShortcut.controller; close.action = 'close:';
        var content = window.contentView;
        betaToolsLabel(content, t('Настройте один раз в приложении «Команды»'), 24, 444, 572, 24);
        var instructions = betaToolsLabel(content, t('1. Создайте команду «kasholkaTTS Siri».\n2. Добавьте «Получить текст из входных данных» → «Произнести текст».\n3. Источник текста — «Входные данные команды»; речь получает результат первого действия.\n4. Выберите Siri, если он доступен в действии, и проверьте звучание.'), 24, 306, 572, 128);
        instructions.textColor = $.NSColor.secondaryLabelColor;
        function button(title, action, x, y, width) {
            return betaDesignMakeButton(content, title, action, betaShortcut.controller, $.NSMakeRect(x, y, width, 34));
        }
        button(t('Открыть «Команды»'), 'open:', 24, 260, 244);
        var refresh = button(t('Обновить список'), 'refresh:', 278, 260, 318);
        var choice = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(24, 214, 572, 30), false);
        choice.addItemWithTitle($(t('Выберите команду…'))); choice.target = betaShortcut.controller; choice.action = 'choose:';
        choice.setAccessibilityLabel($(t('Команда для чтения'))); content.addSubview(choice);
        var note = betaToolsLabel(content, t('Запускаются все действия выбранной команды. Выберите свою команду только для чтения. Голос и скорость задаются в ней; результат Siri не гарантирован.'), 24, 146, 572, 60);
        note.textColor = $.NSColor.secondaryLabelColor;
        var statusLabel = betaToolsLabel(content, '', 24, 82, 572, 56);
        var progress = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24, 66, 572, 10));
        progress.style = $.NSProgressIndicatorStyleBar; progress.indeterminate = true; progress.displayedWhenStopped = false; content.addSubview(progress);
        var cancel = button(t('Прервать ожидание'), 'cancel:', 24, 20, 210);
        button(t('Закрыть'), 'close:', 244, 20, 132);
        var run = button(t('Запустить команду'), 'run:', 386, 20, 210); run.tag = 1001;
        betaShortcut.view = {window: window, choice: choice, refresh: refresh, status: statusLabel, progress: progress, run: run, cancel: cancel};
        betaDesignWindow(window); window.center;
    }
    betaShortcutSync(); betaShortcut.view.window.makeKeyAndOrderFront($());
}
var betaShortcutOldControls = updateControls;
updateControls = function () {betaShortcutOldControls(); betaShortcutSync();};
var betaShortcutOldTick = betaTick;
betaTick = function () {
    if (betaJob && (betaJob.mode === 'shortcuts-list' || betaJob.mode === 'shortcuts-run')) betaShortcutTick();
    else betaShortcutOldTick();
};
