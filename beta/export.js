/* Beta export form. Synthesis/conversion/publication use the existing engine. */
var betaExport = { view: null, controller: null, job: null, starting: false, message: '' };

function betaExportBusy() { return !!(active || audioExport || voiceProbe || betaJob); }
function betaExportOwnsJob() { return !!audioExport && (betaExport.starting || betaExport.job === audioExport); }

function betaExportChoice(format, quality, voiceEngine) {
    if (format === 0) return {format: 'm4a', quality: [64000, 128000, 192000][quality], extension: 'm4a', saved: quality};
    if (format === 1) return {format: 'wav', quality: [16, 24][quality], extension: 'wav', saved: quality + 3};
    if (format === 2) return {format: 'original', extension: voiceEngine === 'ns' ? 'aiff' : 'caf', saved: 5};
    throw new Error(t('Неизвестный формат или качество аудио.'));
}

function betaExportFilename(name, extension) {
    name = String(name).trim();
    if (!name || /[\/\\:\x00-\x1f]/.test(name) || name === '.' || name === '..') {
        throw new Error(t('Введите имя файла без символов /, \\ и двоеточия.'));
    }
    name = name.replace(/\.(m4a|wav|aiff|aif|caf)$/i, '');
    if (!name || name === '.' || name === '..') throw new Error(t('Введите имя файла.'));
    return name + '.' + extension;
}

function betaExportVoiceIndex() {
    var view = betaExport.view, key = view.voiceKeys[Number(view.voice.indexOfSelectedItem)];
    for (var i = 0; i < voices.length; i++) if (voiceKey(voices[i]) === key) return i;
    return -1;
}

function betaExportOptions() {
    var view = betaExport.view;
    if (!view || betaExportOwnsJob()) return;
    var format = Number(view.format.selectedSegment), index = betaExportVoiceIndex();
    var raw = index >= 0 && voices[index].engine === 'ns' ? 'AIFF' : 'CAF';
    view.format.setLabelForSegment($(raw), 2);
    var previous = Number(view.quality.indexOfSelectedItem);
    if (view.qualityFormat !== format) {
        view.quality.removeAllItems;
        var titles = format === 0 ? [t('64 кбит/с'), t('128 кбит/с'), t('192 кбит/с')] :
            format === 1 ? [t('16 бит'), t('24 бита')] : [t('Исходное качество')];
        titles.forEach(function (title) { view.quality.addItemWithTitle($(title)); });
        view.quality.selectItemAtIndex(format === 0 ? 1 : 0);
        view.qualityFormat = format;
    } else if (previous >= 0) view.quality.selectItemAtIndex(previous);
    betaExportSync();
}

function betaExportSync() {
    var view = betaExport.view;
    if (!view) return;
    var busy = betaExportBusy(), owned = betaExportOwnsJob();
    [view.name, view.voice, view.format, view.folder].forEach(function (item) { item.enabled = !busy; });
    view.quality.enabled = !busy && Number(view.format.selectedSegment) !== 2;
    view.save.enabled = !busy && !!synth && voices.length > 0;
    view.save.contentTintColor = view.save.enabled ? betaAccentTextColor() : $.NSColor.disabledControlTextColor;
    view.cancel.title = $(owned ? t('Отмена') : t('Закрыть'));
    if (owned) {
        view.progress.startAnimation($());
        view.message.stringValue = $(audioExport.task ? t('Преобразование аудио…') : t('Синтез речи…'));
    } else {
        view.progress.stopAnimation($());
        var hint = t('Сохраняется весь текст или выделенный фрагмент.');
        var voiceIndex = betaExportVoiceIndex();
        if (voiceIndex >= 0 && voices[voiceIndex].engine !== 'ns') {
            hint += t('\nДля этого голоса нужны установленные Apple Command Line Tools или Xcode');
        }
        view.message.stringValue = $(betaExport.message || hint);
        if (!audioExport) betaExport.job = null;
    }
    view.message.toolTip = view.message.stringValue;
}

function betaExportCancel() {
    if (betaExportOwnsJob()) {
        stop();
        betaExport.message = t('Сохранение отменено.');
        betaExportSync();
    }
}

function betaExportClose() {
    betaExportCancel();
    if (betaExport.view) betaExport.view.window.orderOut($());
}

function betaExportChooseFolder() {
    if (betaExportBusy()) return;
    var panel = $.NSOpenPanel.openPanel;
    panel.canChooseFiles = false;
    panel.canChooseDirectories = true;
    panel.allowsMultipleSelection = false;
    panel.canCreateDirectories = true;
    panel.directoryURL = betaExport.view.directory;
    if (Number(panel.runModal) !== Number($.NSModalResponseOK)) return;
    if (betaExportBusy()) return;
    betaExport.view.directory = panel.URL;
    betaExport.view.folder.title = panel.URL.path;
    betaExport.view.folder.toolTip = panel.URL.path;
}

function betaExportSave() {
    if (betaExportBusy()) return;
    var view = betaExport.view;
    try {
        var index = betaExportVoiceIndex();
        if (index < 0) throw new Error(t('Список голосов изменился. Откройте экспорт заново.'));
        var choice = betaExportChoice(Number(view.format.selectedSegment), Number(view.quality.indexOfSelectedItem), voices[index].engine);
        if (choice.format !== 'original') audioConversionArguments(choice.format, choice.quality, '', '');
        var filename = betaExportFilename(unwrap(view.name.stringValue, ''), choice.extension);
        var url = view.directory.URLByAppendingPathComponent($(filename));
        var fm = $.NSFileManager.defaultManager;
        var isDirectory = Ref();
        if (!fm.fileExistsAtPathIsDirectory(view.directory.path, isDirectory) || !isDirectory[0]) {
            throw new Error(t('Папка сохранения недоступна. Выберите другую.'));
        }
        if (fm.fileExistsAtPath(url.path)) {
            var alert = $.NSAlert.alloc.init;
            alert.messageText = $(t('Заменить существующий файл?'));
            alert.informativeText = url.path;
            alert.addButtonWithTitle($(t('Отмена')));
            alert.addButtonWithTitle($(t('Заменить')));
            if (Number(alert.runModal) !== 1001) return;
        }
        // Modal panels can process other app events. Recheck before starting.
        if (betaExportBusy()) return;
        index = betaExportVoiceIndex();
        if (index < 0) throw new Error(t('Список голосов изменился. Откройте экспорт заново.'));
        ui.voice.selectItemWithTag(index);
        selectVoice();
        betaExport.starting = true;
        betaExport.message = '';
        betaStartAudioExport(choice, url);
        betaExport.job = audioExport;
        if (audioExport) {
            defaults.setObjectForKey($(choice.saved), $('audioFormatChoice'));
            defaults.setObjectForKey(view.directory.path, $('betaExportFolder'));
        } else betaExport.message = unwrap(ui.status.stringValue, '');
    } catch (error) {
        betaExport.message = t('Аудио: ') + String(error);
    } finally {
        betaExport.starting = false;
        betaExportSync();
    }
}

function betaExportRegister() {
    if (betaExport.controller) return;
    ObjC.registerSubclass({name: 'KasholkaBetaExportWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function (sender) { betaExportClose(); }
    }});
    ObjC.registerSubclass({name: 'KasholkaBetaExportController', superclass: 'NSObject', methods: {
        'save:': {types: ['void', ['id']], implementation: guarded(betaExportSave)},
        'folder:': {types: ['void', ['id']], implementation: guarded(betaExportChooseFolder)},
        'options:': {types: ['void', ['id']], implementation: guarded(betaExportOptions)},
        'cancel:': {types: ['void', ['id']], implementation: guarded(function () {
            if (betaExportOwnsJob()) betaExportCancel(); else betaExportClose();
        })},
        'close:': {types: ['void', ['id']], implementation: guarded(betaExportClose)},
        'windowShouldClose:': {types: ['bool', ['id']], implementation: function () { betaExportClose(); return false; }}
    }});
    betaExport.controller = $.KasholkaBetaExportController.alloc.init;
}

function betaExportShow() {
    if (betaExportOwnsJob()) { betaExport.view.window.makeKeyAndOrderFront($()); return; }
    if (betaExportBusy() || !synth) return;
    betaExportRegister();
    if (!betaExport.view) {
        var window = $.KasholkaBetaExportWindow.alloc.initWithContentRectStyleMaskBackingDefer(
            $.NSMakeRect(0, 0, 560, 420), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
        window.title = $(t('Экспорт аудио'));
        window.releasedWhenClosed = false;
        window.delegate = betaExport.controller;
        var close = window.standardWindowButton($.NSWindowCloseButton);
        close.target = betaExport.controller; close.action = 'close:';
        var content = window.contentView;
        function label(text, x, y, width, height) {
            var item = $.NSTextField.wrappingLabelWithString($(text));
            item.frame = $.NSMakeRect(x, y, width, height || 24);
            item.font = $.NSFont.systemFontOfSize(13);
            content.addSubview(item); return item;
        }
        function popup(y, action) {
            var item = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(154, y, 382, 30), false);
            item.target = betaExport.controller; item.action = action;
            content.addSubview(item); return item;
        }
        label(t('Имя файла'), 24, 365, 122);
        var name = $.NSTextField.alloc.initWithFrame($.NSMakeRect(154, 362, 382, 28));
        name.stringValue = $('kasholkaTTS'); name.setAccessibilityLabel($(t('Имя файла'))); content.addSubview(name);
        label(t('Голос'), 24, 320, 122);
        var voice = popup(314, 'options:');
        voice.setAccessibilityLabel($(t('Голос'))); voice.menu.autoenablesItems = false;
        label(t('Формат'), 24, 274, 122);
        var format = $.NSSegmentedControl.alloc.initWithFrame($.NSMakeRect(154, 268, 382, 32));
        format.setAccessibilityLabel($(t('Формат')));
        format.segmentCount = 3; format.trackingMode = $.NSSegmentSwitchTrackingSelectOne;
        ['M4A', 'WAV', 'AIFF'].forEach(function (title, i) { format.setLabelForSegment($(title), i); format.setWidthForSegment(124, i); });
        try { format.selectedSegmentBezelColor = betaAccentColor(); } catch (unavailable) {}
        format.target = betaExport.controller; format.action = 'options:'; content.addSubview(format);
        label(t('Качество'), 24, 228, 122);
        var quality = popup(222, 'options:');
        quality.setAccessibilityLabel($(t('Качество')));
        label(t('Сохранить в'), 24, 182, 122);
        var folder = betaDesignMakeButton(content, '', 'folder:', betaExport.controller, $.NSMakeRect(154, 176, 382, 34));
        folder.setAccessibilityLabel($(t('Сохранить в')));
        folder.cell.lineBreakMode = $.NSLineBreakByTruncatingMiddle;
        var message = label('', 24, 102, 512, 56);
        message.textColor = $.NSColor.secondaryLabelColor;
        var progress = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24, 82, 512, 12));
        progress.style = $.NSProgressIndicatorStyleBar;
        progress.indeterminate = true; progress.displayedWhenStopped = false;
        content.addSubview(progress);
        var cancel = betaDesignMakeButton(content, t('Закрыть'), 'cancel:', betaExport.controller, $.NSMakeRect(274, 24, 126, 34));
        var save = betaDesignMakeButton(content, t('Сохранить'), 'save:', betaExport.controller, $.NSMakeRect(410, 24, 126, 34));
        save.tag = 1001; save.keyEquivalent = $('\r');
        betaExport.view = {window: window, name: name, voice: voice, format: format, quality: quality,
            folder: folder, message: message, progress: progress, cancel: cancel, save: save, qualityFormat: -1};
        betaDesignWindow(window);
        window.center;
    }
    var view = betaExport.view;
    view.voice.removeAllItems; view.voiceKeys = [];
    var selected = selectedVoice(), selectedIndex = 0;
    voices.forEach(function (voice, i) {
        var item = view.voice.menu.addItemWithTitleActionKeyEquivalent(
            $((isSiriVoice(voice) ? '[Siri] ' : '') + voice.name + ' · ' + voice.locale), 'options:', $(''));
        item.target = betaExport.controller;
        view.voiceKeys.push(voiceKey(voice));
        if (selected && voiceKey(selected) === voiceKey(voice)) selectedIndex = i;
    });
    view.voice.selectItemAtIndex(selectedIndex);
    var saved = Math.floor(clamp(unwrap(defaults.objectForKey($('audioFormatChoice')), 1), 0, 5, 1));
    view.format.selectedSegment = saved < 3 ? 0 : saved < 5 ? 1 : 2;
    view.qualityFormat = -1;
    betaExportOptions();
    view.quality.selectItemAtIndex(saved < 3 ? saved : saved < 5 ? saved - 3 : 0);
    var folderPath = unwrap(defaults.objectForKey($('betaExportFolder')), '') || unwrap($.NSHomeDirectory(), '') + '/Downloads';
    view.directory = $.NSURL.fileURLWithPath($(folderPath));
    view.folder.title = $(folderPath); view.folder.toolTip = $(folderPath);
    betaExport.message = '';
    betaExportSync();
    view.window.makeKeyAndOrderFront($());
}

exportAudio = betaExportShow;
var betaExportOldControls = updateControls;
updateControls = function () { betaExportOldControls(); betaExportSync(); };
var betaExportOldStatus = status;
status = function (message) {
    betaExportOldStatus(message);
    if (betaExport.starting || betaExport.job) { betaExport.message = String(message); betaExportSync(); }
};
var betaExportOldStop = stop;
stop = function () {
    var owned = betaExportOwnsJob();
    betaExportOldStop();
    if (owned) { betaExport.message = t('Сохранение отменено.'); betaExportSync(); }
};
