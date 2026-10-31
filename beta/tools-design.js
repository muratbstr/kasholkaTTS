/* Beta utilities: explicit experiments and local, opt-in diagnostic reports. */
var betaTools = {controller: null};
var betaSiri = {view: null, session: null, message: ''};
var betaDiagnostic = {view: null, tab: 0, snapshot: '', copied: false};

function betaToolsBusy() { return !!(active || audioExport || voiceProbe || betaJob); }
function betaToolsLabel(parent, text, x, y, width, height) {
    var label = $.NSTextField.wrappingLabelWithString($(text));
    label.frame = $.NSMakeRect(x, y, width, height);
    label.font = $.NSFont.systemFontOfSize(13); parent.addSubview(label); return label;
}
function betaToolsReportView(parent, x, y, width, height) {
    var scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(x, y, width, height));
    scroll.hasVerticalScroller = true; scroll.hasHorizontalScroller = false;
    scroll.autohidesScrollers = true; scroll.borderType = $.NSBezelBorder;
    var report = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height));
    report.editable = false; report.selectable = true; report.richText = false;
    report.font = $.NSFont.systemFontOfSize(12);
    report.textColor = $.NSColor.textColor; report.backgroundColor = $.NSColor.textBackgroundColor;
    report.verticallyResizable = true; report.horizontallyResizable = false;
    report.minSize = $.NSMakeSize(0, height); report.maxSize = $.NSMakeSize(1000000, 1000000);
    report.autoresizingMask = $.NSViewWidthSizable;
    report.textContainerInset = $.NSMakeSize(10, 10);
    report.textContainer.containerSize = $.NSMakeSize(width, 1000000);
    report.textContainer.widthTracksTextView = true;
    scroll.documentView = report; parent.addSubview(scroll); return report;
}
function betaToolsRegister() {
    if (betaTools.controller) return;
    ObjC.registerSubclass({name: 'KasholkaBetaSiriWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function () { betaSiriClose(); }
    }});
    ObjC.registerSubclass({name: 'KasholkaBetaDiagnosticWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function () { betaDiagnosticClose(); }
    }});
    ObjC.registerSubclass({name: 'KasholkaBetaToolsController', superclass: 'NSObject', methods: {
        'siriOptions:': {types: ['void', ['id']], implementation: guarded(function () { betaSiri.message = ''; betaSiriSync(); })},
        'siriFilter:': {types: ['void', ['id']], implementation: guarded(betaSiriSync)},
        'siriRun:': {types: ['void', ['id']], implementation: guarded(betaSiriRun)},
        'siriCancel:': {types: ['void', ['id']], implementation: guarded(betaSiriCancel)},
        'siriClose:': {types: ['void', ['id']], implementation: guarded(betaSiriClose)},
        'diagnostics:': {types: ['void', ['id']], implementation: guarded(function () { betaDiagnosticShow(2); })},
        'diagnosticTab:': {types: ['void', ['id']], implementation: guarded(function () {
            betaDiagnostic.tab = Number(betaDiagnostic.view.tabs.selectedSegment); betaDiagnosticSync(true);
        })},
        'diagnosticRefresh:': {types: ['void', ['id']], implementation: guarded(function () { betaDiagnosticSync(true); })},
        'diagnosticCopy:': {types: ['void', ['id']], implementation: guarded(betaDiagnosticCopy)},
        'diagnosticRecord:': {types: ['void', ['id']], implementation: guarded(betaDiagnosticRecord)},
        'diagnosticClear:': {types: ['void', ['id']], implementation: guarded(betaDiagnosticClear)},
        'diagnosticClose:': {types: ['void', ['id']], implementation: guarded(betaDiagnosticClose)},
        'windowShouldClose:': {types: ['bool', ['id']], implementation: function (window) {
            if (betaSiri.view && window.isEqual(betaSiri.view.window)) betaSiriClose();
            else if (betaDiagnostic.view && window.isEqual(betaDiagnostic.view.window)) betaDiagnosticClose();
            return false;
        }}
    }});
    betaTools.controller = $.KasholkaBetaToolsController.alloc.init;
}
function betaToolsWindow(klass, title, width, height, closeAction) {
    var window = klass.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, width, height),
        $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
    window.title = $(title); window.releasedWhenClosed = false; window.delegate = betaTools.controller;
    var close = window.standardWindowButton($.NSWindowCloseButton);
    close.target = betaTools.controller; close.action = closeAction;
    betaDesignWindow(window); window.center; return window;
}
function betaToolsButton(parent, title, action, x, y, width, primary) {
    var button = betaDesignMakeButton(parent, title, action, betaTools.controller, $.NSMakeRect(x, y, width, 34));
    if (primary) button.tag = 1001;
    return button;
}

function betaSiriOwnsJob() {
    var session = betaSiri.session;
    return !!session && !!session.job && session.job === (session.kind === 'inventory' ? voiceProbe : betaJob);
}
function betaSiriVoices(locale) {
    var seen = {};
    return voices.filter(function (voice) {
        if (!isSiriVoice({id: voice.id}) || seen[voice.id]) return false;
        seen[voice.id] = true;
        return !locale || String(voice.locale || '').replace(/_/g, '-').toLowerCase() === locale.toLowerCase();
    });
}
function betaSiriHint(mode) {
    return [
        t('Проверяет голоса приложения, osascript и при необходимости Swift. Настройки macOS не меняются.'),
        t('Проверяет Siri ID из настроек и голоса по языкам. Найденный ID не гарантирует звук Siri: сравните через «Прослушать».'),
        t('Читает текст или выделение системным say. Голос может быть обычным; успешное чтение не подтверждает Siri. Паузы и подсветки здесь нет.'),
        t('В macOS выберите Siri в «Универсальный доступ → Устный контент» и включите проговаривание выделения. После подготовки нажмите своё сочетание (обычно ⌥Esc). Остановка — системной панелью или тем же сочетанием.')
        , t('Передайте текст своей команде с действием «Произнести текст». Голос выбирается в «Командах»; наличие Siri нужно проверить на этом Mac.')
    ][mode];
}
function betaSiriSync() {
    var view = betaSiri.view;
    if (!view) return;
    var session = betaSiri.session, owns = betaSiriOwnsJob();
    if (session && !session.starting && !owns) {
        if (session.kind !== 'inventory') {
            var result = betaReport[session.kind] || {};
            betaSiri.message = result.error ? String(result.error) : result.state === 'cancelled' ? t('Проверка отменена.') :
                session.kind === 'say' ? t('Beta: say завершил чтение. Это не подтверждает, что прозвучал Siri.') : t('Проверка завершена. Доступные Siri ID показаны ниже.');
        } else betaSiri.message = session.result || t('Проверка завершена. Подробности доступны в диагностике.');
        betaSiri.session = null;
    }
    var mode = Number(view.mode.indexOfSelectedItem), busy = betaToolsBusy();
    view.hint.stringValue = $(betaSiriHint(mode));
    view.mode.enabled = !owns && !(session && session.starting);
    view.run.title = $([t('Найти голоса'), t('Проверить ID'), t('Прочитать'), t('Подготовить текст'), t('Настроить запуск')][mode]);
    view.run.enabled = !busy;
    view.run.contentTintColor = busy ? $.NSColor.disabledControlTextColor : betaAccentTextColor();
    view.cancel.enabled = owns;
    var stage = owns ? session.kind === 'inventory' ? (voiceProbe.backend === 'swift' ?
        t('Проверяю Siri через Swift (до 60 с)…') : t('Проверяю Siri через osascript…')) :
        session.kind === 'probe' ? t('Проверка Siri ID, до 20 секунд…') : t('Системный say читает…') :
        betaSiri.message || (busy ? t('Дождитесь завершения текущей операции.') : t('Выберите способ и запустите проверку.'));
    if (owns) stage += '\n' + t('Закрытие окна не прерывает проверку. Для остановки нажмите «Отменить».');
    view.stage.stringValue = $(stage); view.stage.toolTip = view.stage.stringValue;
    if (owns) view.progress.startAnimation($()); else view.progress.stopAnimation($());
    var locale = ['', 'ru-RU', 'en-US', 'en-GB'][Number(view.language.indexOfSelectedItem)];
    var list = betaSiriVoices(locale), all = betaSiriVoices('');
    view.summary.stringValue = $(t('Siri ID в списке: {total}. По фильтру: {count}.', {total: all.length, count: list.length}));
    var report = list.length ? list.map(function (voice) { return voice.name + ' · ' + voice.locale + '\n' + voice.id; }).join('\n\n') :
        t('Доступных Siri ID по этому фильтру нет. Скачанные в macOS голоса могут быть недоступны приложению.');
    if (view.lastReport !== report) { view.report.string = $(report); view.lastReport = report; }
}
var betaSiriSearchEngine = searchSiriVoices;
function betaSiriRun() {
    if (betaToolsBusy()) { betaSiri.message = t('Дождитесь завершения текущей операции.'); betaSiriSync(); return; }
    var mode = Number(betaSiri.view.mode.indexOfSelectedItem);
    betaSiri.message = '';
    if (mode === 4) { betaShortcutShow(); return; }
    var session = {kind: ['inventory','probe','say','selection'][mode], starting: true, job: null};
    betaSiri.session = session;
    try {
        if (mode === 0) betaSiriSearchEngine();
        else if (mode === 1) betaProbe();
        else if (mode === 2) {
            var range = ui.editor.selectedRange;
            betaSayStart(textToRead(unwrap(ui.editor.string, ''), Number(range.location), Number(range.length)));
        } else {
            betaPrepareSelectionNow(); betaSiri.session = null;
            betaSiri.message = unwrap(ui.status.stringValue, '');
        }
        session.job = mode === 0 ? voiceProbe : betaJob;
        if (mode !== 0 && mode !== 1 && !session.job) {
            betaSiri.session = null; betaSiri.message = unwrap(ui.status.stringValue, '');
        }
    } catch (error) { betaSiri.session = null; betaSiri.message = String(error); }
    finally { session.starting = false; betaSiriSync(); betaDiagnosticSync(false); }
}
function betaSiriCancel() {
    if (!betaSiriOwnsJob()) { betaSiriSync(); return; }
    var session = betaSiri.session;
    betaSiri.session = null;
    if (session.kind === 'inventory') {
        voiceDiagnostics[voiceProbe.backend] = t('Проверка отменена.');
        var job = voiceProbe; voiceProbe = null; disposeHostJob(job);
        if (!hostSpeech && hostTimer) { hostTimer.invalidate; hostTimer = null; }
    } else {
        betaReport[session.kind] = {state: 'cancelled'};
        betaDisposeJob(); active = paused = false;
    }
    betaSiri.message = t('Проверка отменена.'); updateControls(); betaSiriSync();
}
function betaSiriClose() { if (betaSiri.view) betaSiri.view.window.orderOut($()); }
function betaSiriShow(mode) {
    betaToolsRegister();
    if (!betaSiri.view) {
        var window = betaToolsWindow($.KasholkaBetaSiriWindow, t('Поиск Siri и эксперименты'), 600, 532, 'siriClose:');
        var content = window.contentView;
        betaToolsLabel(content, t('Способ'), 24, 485, 90, 24);
        var method = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(122, 480, 454, 30), false);
        [t('Системные движки'), t('Siri ID из настроек'), t('Системный say'), t('Устный контент macOS'), t('Команды macOS')].forEach(function (title) { method.addItemWithTitle($(title)); });
        method.target = betaTools.controller; method.action = 'siriOptions:'; content.addSubview(method);
        method.setAccessibilityLabel($(t('Способ проверки')));
        var hint = betaToolsLabel(content, '', 24, 380, 552, 88); hint.textColor = $.NSColor.secondaryLabelColor;
        betaToolsLabel(content, t('Язык результатов'), 24, 340, 174, 24);
        var language = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(204, 335, 372, 30), false);
        [t('Все языки'), t('Русский'), t('Английский (США)'), t('Английский (Великобритания)')].forEach(function (title) { language.addItemWithTitle($(title)); });
        language.target = betaTools.controller; language.action = 'siriFilter:'; content.addSubview(language);
        language.setAccessibilityLabel($(t('Язык результатов')));
        var summary = betaToolsLabel(content, '', 24, 302, 552, 24);
        var report = betaToolsReportView(content, 24, 154, 552, 140);
        var stage = betaToolsLabel(content, '', 24, 94, 552, 48);
        var progress = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24, 78, 552, 10));
        progress.style = $.NSProgressIndicatorStyleBar; progress.indeterminate = true; progress.displayedWhenStopped = false;
        content.addSubview(progress);
        var diagnostics = betaToolsButton(content, t('Диагностика'), 'diagnostics:', 24, 24, 128);
        var cancel = betaToolsButton(content, t('Отменить'), 'siriCancel:', 162, 24, 112);
        var close = betaToolsButton(content, t('Закрыть'), 'siriClose:', 284, 24, 112);
        var run = betaToolsButton(content, t('Найти голоса'), 'siriRun:', 406, 24, 170, true);
        // No default Enter action: launching a test is always explicit.
        betaSiri.view = {window: window, mode: method, language: language, hint: hint, summary: summary,
            report: report, stage: stage, progress: progress, run: run, cancel: cancel};
    }
    if (!betaSiriOwnsJob() && typeof mode === 'number') betaSiri.view.mode.selectItemAtIndex(mode);
    betaSiriSync(); betaSiri.view.window.makeKeyAndOrderFront($());
}
searchSiriVoices = function () { betaSiriShow(0); };

function betaDiagnosticReport(tab) {
    if (tab === 0) return voiceDiagnosticText();
    if (tab === 1) return wordDiagnosticText();
    return JSON.stringify({app: 'kasholkaTTS Beta', version: VERSION,
        os: unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString, ''), experiments: betaReport}, null, 2);
}
function betaDiagnosticSync(refresh) {
    var view = betaDiagnostic.view;
    if (!view) return;
    var words = betaDiagnostic.tab === 1;
    var capturing = wordDiagnostics.armed || wordDiagnostics.recording;
    view.record.hidden = view.clear.hidden = !words;
    view.record.title = $(capturing ? t('Остановить запись') : t('Записать чтение'));
    view.record.enabled = capturing || !betaToolsBusy();
    view.record.contentTintColor = view.record.enabled ? betaAccentTextColor() : $.NSColor.disabledControlTextColor;
    view.clear.enabled = !wordDiagnostics.recording;
    var hint = words ? t('Запись первых 80 событий включает фрагменты текста. Только в памяти; ничего не отправляется.') :
        t('Версии, голоса и результаты проверок. Текста редактора в этом разделе нет.');
    if (words) hint += '\n' + (wordDiagnostics.armed ? t('Ожидается следующее чтение.') : wordDiagnostics.recording ? t('Идёт запись подсветки.') :
        t('Запись выключена.')) + ' ' + t('Событий: {count}.', {count: wordDiagnostics.events.length});
    view.hint.stringValue = $(hint);
    if (refresh) {
        betaDiagnostic.snapshot = betaDiagnosticReport(betaDiagnostic.tab);
        view.report.string = $(betaDiagnostic.snapshot);
        betaDiagnostic.copied = false;
        view.copy.enabled = !words || wordDiagnostics.events.length > 0 || !!wordDiagnostics.header;
    }
    view.note.stringValue = $(betaDiagnostic.copied ? t('Скопирован показанный отчёт.') : t('«Обновить» показывает текущий отчёт; «Копировать» копирует показанный снимок.'));
}
function betaDiagnosticCopy() {
    if (!betaDiagnostic.view || !betaDiagnostic.view.copy.enabled) return;
    var pasteboard = $.NSPasteboard.generalPasteboard;
    pasteboard.clearContents;
    if (!pasteboard.setStringForType($(betaDiagnostic.snapshot), $.NSPasteboardTypeString)) {
        betaDiagnostic.view.note.stringValue = $(t('Не удалось скопировать отчёт.')); return;
    }
    betaDiagnostic.copied = true; betaDiagnosticSync(false);
}
function betaDiagnosticRecord() {
    if (betaDiagnostic.tab !== 1) return;
    if (wordDiagnostics.armed || wordDiagnostics.recording) {
        wordDiagnostics.armed = wordDiagnostics.recording = false;
    } else if (!betaToolsBusy()) armWordDiagnostics();
    betaDiagnosticSync(true);
}
function betaDiagnosticClear() {
    if (betaDiagnostic.tab !== 1 || wordDiagnostics.recording) return;
    wordDiagnostics = {armed: false, recording: false, header: null, events: []};
    betaDiagnosticSync(true);
}
function betaDiagnosticClose() { if (betaDiagnostic.view) betaDiagnostic.view.window.orderOut($()); }
function betaDiagnosticShow(tab) {
    betaToolsRegister();
    if (!betaDiagnostic.view) {
        var window = betaToolsWindow($.KasholkaBetaDiagnosticWindow, t('Диагностика'), 680, 550, 'diagnosticClose:');
        var content = window.contentView;
        var tabs = $.NSSegmentedControl.alloc.initWithFrame($.NSMakeRect(24, 496, 632, 30));
        tabs.segmentCount = 3; tabs.trackingMode = $.NSSegmentSwitchTrackingSelectOne;
        [t('Голоса'), t('Подсветка'), t('Эксперименты')].forEach(function (name, i) {
            tabs.setLabelForSegment($(name), i); tabs.setWidthForSegment(209, i);
        });
        tabs.target = betaTools.controller; tabs.action = 'diagnosticTab:'; content.addSubview(tabs);
        tabs.setAccessibilityLabel($(t('Раздел диагностики')));
        try { tabs.selectedSegmentBezelColor = betaAccentColor(); } catch (unavailable) {}
        var hint = betaToolsLabel(content, '', 24, 424, 632, 60); hint.textColor = $.NSColor.secondaryLabelColor;
        var report = betaToolsReportView(content, 24, 156, 632, 256);
        var record = betaToolsButton(content, t('Записать чтение'), 'diagnosticRecord:', 24, 106, 202, true);
        var clear = betaToolsButton(content, t('Очистить запись'), 'diagnosticClear:', 236, 106, 196);
        var note = betaToolsLabel(content, '', 24, 65, 632, 34); note.textColor = $.NSColor.secondaryLabelColor;
        var refresh = betaToolsButton(content, t('Обновить'), 'diagnosticRefresh:', 24, 24, 140);
        var copy = betaToolsButton(content, t('Копировать'), 'diagnosticCopy:', 174, 24, 180);
        betaToolsButton(content, t('Закрыть'), 'diagnosticClose:', 516, 24, 140);
        betaDiagnostic.view = {window: window, tabs: tabs, hint: hint, report: report, record: record,
            clear: clear, note: note, copy: copy, refresh: refresh};
    }
    betaDiagnostic.tab = typeof tab === 'number' ? tab : 0;
    betaDiagnostic.view.tabs.selectedSegment = betaDiagnostic.tab;
    betaDiagnosticSync(true); betaDiagnostic.view.window.makeKeyAndOrderFront($());
}
showVoiceDiagnostics = function () { betaDiagnosticShow(0); };
showWordDiagnostics = function () { betaDiagnosticShow(1); };
betaShowReport = function () { betaDiagnosticShow(2); };

var betaToolsOldControls = updateControls;
updateControls = function () {
    betaToolsOldControls();
    // These menu actions now open the window, so users can reopen a running check.
    betaMenuItems.forEach(function (item) { item.enabled = true; });
    betaSiriSync(); betaDiagnosticSync(false);
};
var betaToolsOldHostTick = hostTick;
hostTick = function () {
    var session = betaSiri.session, owned = betaSiriOwnsJob() && session.kind === 'inventory';
    // The inventory engine can replace osascript with Swift within this call.
    if (owned) session.starting = true;
    try { betaToolsOldHostTick(); }
    finally {
        if (owned && betaSiri.session === session) {
            session.job = voiceProbe; session.starting = false;
            if (!voiceProbe) session.result = unwrap(ui.status.stringValue, '');
        }
        betaSiriSync(); betaDiagnosticSync(false);
    }
};
var betaToolsOldBetaTick = betaTick;
betaTick = function () { try { betaToolsOldBetaTick(); } finally { betaSiriSync(); betaDiagnosticSync(false); } };
