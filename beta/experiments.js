/* Appended only to kasholkaTTS Beta. Stable source and its preferences stay separate. */
var betaController = null, betaJob = null, betaMenuItems = [];
var betaReport = { probe: null, say: null };

function betaUnavailable() {
    if (active || voiceProbe || betaJob) {
        status('Сначала остановите чтение или дождитесь окончания проверки.'); return true;
    }
    return false;
}

function betaDisposeJob() {
    if (!betaJob) return;
    var job = betaJob; betaJob = null;
    if (job.timer) job.timer.invalidate;
    try { if (job.task && job.task.running) job.task.terminate; } catch (exited) {}
    if (job.errorHandle) { try { job.errorHandle.closeFile; } catch (closed) {} }
    ['input.txt', 'result.json', 'stderr.txt'].forEach(function (name) {
        try { $.NSFileManager.defaultManager.removeItemAtPathError($(job.directory + '/' + name), Ref()); } catch (missing) {}
    });
    try { $.rmdir(job.directory); } catch (missing) {}
}

function betaStartJob(mode, text) {
    var directory = unwrap($.NSTemporaryDirectory(), '') + 'kasholkaTTS-Beta-' + unwrap($.NSUUID.UUID.UUIDString, '');
    var permissions = $.NSMutableDictionary.alloc.init;
    permissions.setObjectForKey($(448), $.NSFilePosixPermissions);
    if (!$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        $(directory), false, permissions, Ref())) throw new Error('Не удалось создать временную папку Beta.');
    var job = { mode: mode, directory: directory, deadline: Date.now() + 20000 };
    betaJob = job;
    try {
        job.task = $.NSTask.alloc.init;
        if (mode === 'probe') {
            var script = $.NSBundle.mainBundle.pathForResourceOfType($('beta-probe'), $('js'));
            if (!script || script.isNil()) throw new Error('Не найден beta-probe.js. Переустановите Beta.');
            job.task.launchPath = $('/usr/bin/osascript');
            job.task.arguments = $(['-l', 'JavaScript', unwrap(script, ''), directory]);
        } else if (mode === 'say') {
            if (!$(text).writeToFileAtomicallyEncodingError($(directory + '/input.txt'), true, $.NSUTF8StringEncoding, Ref())) {
                throw new Error('Не удалось подготовить текст для say.');
            }
            job.task.launchPath = $('/usr/bin/say');
            // No -v: let the OS use its configured system voice. No preference writes.
            job.task.arguments = $(['-f', directory + '/input.txt']);
        } else throw new Error('Неизвестная проверка Beta.');
        job.task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
        job.task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
        job.errorHandle = createHostLog(directory + '/stderr.txt');
        job.task.standardError = job.errorHandle;
        job.task.launch;
        job.timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
            0.2, betaController, 'betaTick:', null, true);
        $.NSRunLoop.mainRunLoop.addTimerForMode(job.timer, $.NSRunLoopCommonModes);
        updateControls();
    } catch (error) { betaDisposeJob(); throw error; }
}

function betaProbe() {
    if (betaUnavailable()) return;
    stopSynth();
    active = true; paused = false;
    betaReport.probe = { state: 'running' };
    try { betaStartJob('probe'); }
    catch (error) { active = false; betaReport.probe = { error: String(error) }; updateControls(); throw error; }
    status('Beta: проверяю Siri ID из настроек и голоса по языкам, до 20 секунд…');
}

function betaSay() {
    if (betaUnavailable()) return;
    var range = ui.editor.selectedRange;
    var text = textToRead(unwrap(ui.editor.string, ''), Number(range.location), Number(range.length));
    if (!text.trim()) { status('Введите текст или выделите фрагмент для проверки say.'); return; }
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $('Проверка системного голоса через say');
    dialog.informativeText = $('Используются голос и темп из «Универсальный доступ → Устный контент».\n' +
        'На Monterey Siri может заменяться обычным голосом. Успешное чтение не подтверждает Siri.\n' +
        'Кнопка «Стоп» остановит проверку; пауза и подсветка здесь недоступны.');
    dialog.addButtonWithTitle($('Прочитать'));
    dialog.addButtonWithTitle($('Отмена'));
    if (Number(dialog.runModal) !== 1000) return;
    stopSynth();
    active = true; paused = false;
    betaReport.say = { state: 'running', identity: 'System voice; Siri unverified' };
    try { betaStartJob('say', text); }
    catch (error) {
        active = false; betaReport.say = { error: String(error) }; updateControls(); throw error;
    }
    status('Beta: системный say читает. Какой голос звучит, нужно сравнить на слух.');
}

function betaTick() {
    var job = betaJob;
    if (!job) return;
    try {
        if (job.mode === 'probe') {
            var result = readHostJSON(job.directory + '/result.json');
            if (result && result.state === 'error') throw new Error(result.message);
            if (result && result.state === 'voices') {
                if (!Array.isArray(result.voices)) throw new Error('Некорректный ответ проверки Beta.');
                betaReport.probe = result.report;
                // The probe resolves exact IDs in osascript, so reading uses
                // that same host, not the applet's potentially filtered API.
                var found = result.voices.filter(function (voice) {
                    return voice && typeof voice.id === 'string' && isSiriVoice({ id: voice.id });
                });
                found.forEach(function (voice) {
                    if (!hostVoices.some(function (old) { return old.id === voice.id; })) {
                        hostVoices.push({ id: voice.id, name: String(voice.name || voice.id),
                            locale: String(voice.locale || ''), backend: 'osascript' });
                    }
                });
                betaDisposeJob();
                active = paused = false;
                var preferred = unwrap(defaults.stringForKey($('voice')), '');
                addHostVoices(hostVoices); populateVoices(preferred, false);
                status(found.length ? 'Beta: доступных Siri ID: ' + found.length + '. Проверьте «Прослушать».' :
                    'Beta: новые Siri ID недоступны. Попробуйте «Устный контент» в меню Beta.');
                return;
            }
            if (Date.now() > job.deadline) throw new Error('Проверка Beta не ответила за 20 секунд.');
        }
        if (job.task.running) return;
        if (job.mode === 'probe' || Number(job.task.terminationStatus) !== 0) {
            // say can echo an invalid embedded speech command from the input
            // text. Keep its stderr out of the copyable diagnostic report.
            throw new Error('Проверка завершилась с кодом ' + job.task.terminationStatus + '. ' +
                (job.mode === 'probe' ? readHostText(job.directory + '/stderr.txt').trim().slice(0, 1000) : ''));
        }
        betaReport.say = { state: 'finished', exitCode: 0, identity: 'System voice; Siri unverified' };
        betaDisposeJob(); active = paused = false; updateControls();
        status('Beta: say завершил чтение. Это не подтверждает, что прозвучал Siri.');
    } catch (error) {
        betaReport[job.mode] = { error: String(error) };
        betaDisposeJob(); active = paused = false; updateControls();
        status('Beta: ' + String(error));
    }
}

function betaPrepareSelection() {
    if (betaUnavailable()) return;
    var text = unwrap(ui.editor.string, '');
    if (!text.trim()) { status('Сначала введите текст для системного чтения.'); return; }
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $('Siri через «Устный контент»');
    dialog.informativeText = $('В настройках macOS откройте «Универсальный доступ → Устный контент».\n' +
        'Выберите голос Siri и включите «Проговаривать выбранный текст».\n\n' +
        'После «Подготовить текст» нажмите своё системное сочетание (обычно ⌥Esc). ' +
        'Повторное нажатие остановит речь. Управление и скорость — в системной панели; ' +
        'кнопка «Стоп» приложения и экспорт к этому чтению не относятся.');
    dialog.addButtonWithTitle($('Подготовить текст'));
    dialog.addButtonWithTitle($('Отмена'));
    if (Number(dialog.runModal) !== 1000) return;
    if (!Number(ui.editor.selectedRange.length)) ui.editor.setSelectedRange($.NSMakeRange(0, text.length));
    ui.window.makeKeyAndOrderFront(null);
    ui.window.makeFirstResponder(ui.editor);
    status('Нажмите ⌥Esc (или своё сочетание). Остановка — тем же сочетанием или в системной панели.');
}

function betaShowReport() {
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $('Результаты экспериментов Beta');
    dialog.informativeText = $('Отчёт содержит версии, голосовые ID, результаты проверок и ошибки. Текста редактора в отчёте нет.\n' +
        'Найденный ID не гарантирует воспроизведение голосом Siri; сравните звук с системной пробой.');
    dialog.addButtonWithTitle($('Скопировать отчёт'));
    dialog.addButtonWithTitle($('Закрыть'));
    if (Number(dialog.runModal) === 1000) {
        var pasteboard = $.NSPasteboard.generalPasteboard;
        pasteboard.clearContents;
        pasteboard.setStringForType($(JSON.stringify({ app: 'kasholkaTTS Beta', version: VERSION,
            os: unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString, ''), experiments: betaReport }, null, 2)), $.NSPasteboardTypeString);
        status('Отчёт Beta скопирован.');
    }
}

var betaOriginalUpdateControls = updateControls;
updateControls = function () {
    betaOriginalUpdateControls();
    if (betaJob) {
        ['play', 'preview', 'refresh', 'voice', 'rate', 'reset', 'open', 'exportItem', 'pause'].forEach(function (key) {
            if (ui[key]) ui[key].enabled = false;
        });
        ui.editor.editable = false;
        ui.stop.enabled = true;
    }
    betaMenuItems.forEach(function (item) { item.enabled = !active && !voiceProbe && !betaJob; });
};

var betaOriginalStopSynth = stopSynth;
stopSynth = function () {
    if (betaJob) {
        betaReport[betaJob.mode] = { state: 'cancelled' };
        betaDisposeJob();
    }
    betaOriginalStopSynth();
};

// A probe must not be interrupted by a stale enabled Debug menu action.
var betaOriginalSearch = searchSiriVoices;
searchSiriVoices = function () { if (!betaUnavailable()) betaOriginalSearch(); };

var betaOriginalInstallMenus = installMenus;
installMenus = function () {
    betaOriginalInstallMenus();
    ObjC.registerSubclass({ name: 'KasholkaBetaController', superclass: 'NSObject', methods: {
        'betaProbe:': { types: ['void', ['id']], implementation: guarded(betaProbe) },
        'betaSay:': { types: ['void', ['id']], implementation: guarded(betaSay) },
        'betaSelection:': { types: ['void', ['id']], implementation: guarded(betaPrepareSelection) },
        'betaReport:': { types: ['void', ['id']], implementation: guarded(betaShowReport) },
        'betaTick:': { types: ['void', ['id']], implementation: betaTick }
    } });
    betaController = $.KasholkaBetaController.alloc.init;
    var menu = $.NSMenu.alloc.initWithTitle($('Beta'));
    menu.autoenablesItems = false;
    [['Проверить Siri ID из настроек', 'betaProbe:'], ['Прочитать системным say…', 'betaSay:'],
        ['Siri через «Устный контент»…', 'betaSelection:']].forEach(function (entry) {
        var item = menu.addItemWithTitleActionKeyEquivalent($(entry[0]), entry[1], $(''));
        item.target = betaController; betaMenuItems.push(item);
    });
    menu.addItem($.NSMenuItem.separatorItem);
    var report = menu.addItemWithTitleActionKeyEquivalent($('Отчёт экспериментов…'), 'betaReport:', $(''));
    report.target = betaController;
    var item = $.NSMenuItem.alloc.init;
    item.title = $('Beta'); item.submenu = menu;
    $.NSApplication.sharedApplication.mainMenu.addItem(item);
};
