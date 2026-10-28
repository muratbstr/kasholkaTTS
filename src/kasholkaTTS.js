/* kasholkaTTS 1.7.2 Release 2 — macOS 12+, JavaScript for Automation / AppKit.
 * Compiled as a stay-open applet by the installer using macOS osacompile.
 * Speech stays local. Optional update checks contact GitHub only.
 */
ObjC.import('Cocoa');
ObjC.import('AVFoundation');

var VERSION = '1.7.2 Release 2';
var ui = {};
var controller = null;
var synth = null;
var voices = [];
var active = false;
var paused = false;
var voiceBaseRate = 180;
var defaults = null;
var engine = 'ns';
var currentUtterance = null;
var scale = 1;
var about = {};
var avFoundationBundle = null;
var voiceProbe = null;
var hostSpeech = null;
var hostTimer = null;
var hostVoices = [];
var voiceDiagnostics = {};
var voiceInventories = {};
var debugPitchOffsets = {};
var reading = null, highlightedRange = null;
var autoScroll = true;
var audioExport = null;
var startup = null;
var wordDiagnostics = { armed: false, recording: false, header: null, events: [] };

// Russian fallback also keeps the standalone source usable in native tests.
function t(text, parameters) {
    if (typeof translateText === 'function') return translateText(text, parameters);
    return String(text).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, function (match, key) {
        return parameters && Object.prototype.hasOwnProperty.call(parameters, key) ? String(parameters[key]) : match;
    });
}
function helperError(text) { return typeof translateHelperError === 'function' ? translateHelperError(text) : text; }

function armWordDiagnostics() {
    if (active) { status(t('Сначала остановите чтение, затем включите диагностику подсветки.')); return; }
    wordDiagnostics = { armed: true, recording: false, header: null, events: [] };
    status(t('Диагностика включена для следующего чтения. Выберите проблемный фрагмент и нажмите «Читать».'));
}

function beginWordDiagnostics(text) {
    if (!wordDiagnostics.armed) return;
    var voice = selectedVoice() || {};
    wordDiagnostics.armed = false;
    wordDiagnostics.recording = true;
    wordDiagnostics.started = Date.now();
    wordDiagnostics.header = {
        version: VERSION,
        os: unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString, ''),
        engine: engine, voice: voice.id || '', voiceName: voice.name || '',
        speedPosition: Number(ui.rate.doubleValue),
        selection: { location: Number(reading.selection.location), length: Number(reading.selection.length) },
        offset: reading.offset, spokenUTF16Length: text.length,
        editorUTF16Length: unwrap(ui.editor.string, '').length,
        spokenStart: text.slice(0, 160)
    };
}

function wordContext(text, location, length) {
    if (typeof text !== 'string' || !isFinite(location) || !isFinite(length) ||
        location < 0 || length < 0 || location + length > text.length) return null;
    return { before: text.slice(Math.max(0, location - 24), location),
        marked: text.substr(location, Math.min(length, 100)),
        after: text.substr(location + length, 24) };
}

function recordWordDiagnostic(range, aligned, callbackText, outcome) {
    if (!wordDiagnostics.recording || !reading) return;
    var location = Number(range.location), length = Number(range.length);
    var editor = unwrap(ui.editor.string, '');
    var event = {
        milliseconds: Date.now() - wordDiagnostics.started,
        raw: { location: location, length: length }, outcome: outcome,
        editorSliceEqualsSpoken: editor.substr(reading.offset, reading.length) === reading.text,
        spoken: wordContext(reading.text, location, length),
        editorRaw: wordContext(editor, reading.offset + location, length),
        callbackProvided: typeof callbackText === 'string'
    };
    if (typeof callbackText === 'string') {
        event.callbackUTF16Length = callbackText.length;
        event.callbackEqualsSpoken = callbackText === reading.text;
        event.callback = wordContext(callbackText, location, length);
    }
    if (aligned) {
        event.display = { location: reading.offset + aligned.location, length: aligned.length };
        event.editorDisplay = wordContext(editor, event.display.location, event.display.length);
    }
    wordDiagnostics.events.push(event);
    if (wordDiagnostics.events.length >= 80) wordDiagnostics.recording = false;
}

function wordDiagnosticText() {
    return JSON.stringify({ app: 'kasholkaTTS', version: VERSION,
        header: wordDiagnostics.header, events: wordDiagnostics.events }, null, 2);
}

function showWordDiagnostics() {
    if (active) { status(t('Сначала остановите чтение, затем откройте диагностику подсветки.')); return; }
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $(t('Диагностика подсветки'));
    dialog.informativeText = $(t('Записывает первые 80 событий следующего чтения: голос, позиции и короткие фрагменты вашего текста.\n') +
        t('Отчёт хранится только в памяти до выхода. Ничего не отправляется. Для проверки используйте тестовый TXT.\n\n') +
        t('Событий в текущем отчёте: ') + wordDiagnostics.events.length + '.');
    dialog.addButtonWithTitle($(t('Записать следующее чтение')));
    dialog.addButtonWithTitle($(t('Скопировать отчёт')));
    dialog.addButtonWithTitle($(t('Закрыть')));
    var result = Number(dialog.runModal);
    if (result === 1000) armWordDiagnostics();
    else if (result === 1001) {
        if (!wordDiagnostics.events.length) { status(t('Сначала запишите чтение с включённой диагностикой.')); return; }
        var pasteboard = $.NSPasteboard.generalPasteboard;
        pasteboard.clearContents;
        pasteboard.setStringForType($(wordDiagnosticText()), $.NSPasteboardTypeString);
        status(t('Отчёт подсветки скопирован. Он содержит фрагменты прочитанного текста.'));
    }
}

function clearWordHighlight() {
    if (highlightedRange && ui.editor) {
        ui.editor.layoutManager.removeTemporaryAttributeForCharacterRange(
            $.NSBackgroundColorAttributeName, highlightedRange);
        ui.editor.layoutManager.removeTemporaryAttributeForCharacterRange(
            $.NSForegroundColorAttributeName, highlightedRange);
    }
    highlightedRange = null;
}

function endReading() {
    wordDiagnostics.recording = false;
    clearWordHighlight();
    if (reading && reading.selection && ui.editor) {
        var caret = ui.editor.selectedRange;
        if (Number(caret.length) === 0 && Number(caret.location) === reading.offset) {
            ui.editor.setSelectedRange(reading.selection);
        }
    }
    reading = null;
}

function highlightWords(text) {
    // Correct word edges only for scripts whose boundaries we can recognize.
    // Keep UTF-16 offsets (including combining marks), hyphens and apostrophes.
    // Other scripts and emoji retain the engine's original ranges.
    var pattern = /[A-Za-z0-9_\u00c0-\u02af\u0300-\u036f\u0400-\u052f]+(?:[-'’][A-Za-z0-9_\u00c0-\u02af\u0300-\u036f\u0400-\u052f]+)*/g;
    var words = [], match;
    while ((match = pattern.exec(text)) !== null) {
        words.push({ location: match.index, length: match[0].length });
    }
    return words;
}

function alignHighlightRange(words, location, length) {
    var end = location + length, low = 0, high = words.length;
    // Locate the first overlapping word without scanning a long document on
    // every speech event. This is a display correction, not a timing estimate.
    while (low < high) {
        var mid = Math.floor((low + high) / 2);
        if (words[mid].location + words[mid].length <= location) low = mid + 1;
        else high = mid;
    }
    var first = null, last = null, best = null, overlap = 0;
    for (var i = low; i < words.length && words[i].location < end; i++) {
        var word = words[i];
        if (!first) first = word;
        last = word;
        var count = Math.min(end, word.location + word.length) - Math.max(location, word.location);
        if (count > overlap) { overlap = count; best = word; }
    }
    // Exact multiword units (numbers, phrases) remain intact. A confidently
    // overlapping word repairs a partial word/spill into its neighbour. Do not
    // guess when the event is ambiguous or belongs to a different script.
    if (first && first.location === location && last.location + last.length === end) {
        return { location: location, length: length };
    }
    return best && overlap > length / 2 ? best : { location: location, length: length };
}

function highlightWord(range, callbackText) {
    if (!active || paused || audioExport || !reading || !range) return;
    var location = Number(range.location), length = Number(range.length);
    if (!isFinite(location) || !isFinite(length) || location < 0 || length <= 0 ||
        Math.floor(location) !== location || Math.floor(length) !== length ||
        location + length > reading.length) {
        recordWordDiagnostic(range, null, callbackText, 'invalid-range');
        return;
    }
    var text = unwrap(ui.editor.string, '');
    if (!reading.words) reading.words = highlightWords(text.substr(reading.offset, reading.length));
    var aligned = alignHighlightRange(reading.words, location, length);
    recordWordDiagnostic(range, aligned, callbackText, 'mapped');
    var absolute = reading.offset + aligned.location;
    length = aligned.length;
    if (absolute + length > text.length) return;
    if (highlightedRange && Number(highlightedRange.location) === absolute &&
        Number(highlightedRange.length) === length) return;
    clearWordHighlight();
    highlightedRange = $.NSMakeRange(absolute, length);
    ui.editor.layoutManager.addTemporaryAttributeValueForCharacterRange(
        $.NSBackgroundColorAttributeName, $.NSColor.selectedTextBackgroundColor, highlightedRange);
    ui.editor.layoutManager.addTemporaryAttributeValueForCharacterRange(
        $.NSForegroundColorAttributeName, $.NSColor.selectedTextColor, highlightedRange);
    if (autoScroll) ui.editor.scrollRangeToVisible(highlightedRange);
}

function toggleAutoScroll() {
    autoScroll = !autoScroll;
    defaults.setObjectForKey($(autoScroll), $('autoScroll'));
    if (ui.autoScrollItem) ui.autoScrollItem.state = autoScroll ? 1 : 0;
    if (autoScroll && highlightedRange) ui.editor.scrollRangeToVisible(highlightedRange);
}

function discardAudioExport() {
    if (!audioExport) return;
    var job = audioExport;
    audioExport = null;
    if (job.timer) job.timer.invalidate;
    try { if (job.task && job.task.running) job.task.terminate; } catch (exited) {}
    if (job.errorHandle) { try { job.errorHandle.closeFile; } catch (closed) {} }
    [job.path, job.convertedPath, job.directory + '/convert.log'].forEach(function (path) {
        if (path) try { $.NSFileManager.defaultManager.removeItemAtPathError($(path), Ref()); } catch (missing) {}
    });
    try { $.rmdir(job.directory); } catch (missing) {}
}

function requireAudioFile(path) {
    var attrs = $.NSFileManager.defaultManager.attributesOfItemAtPathError($(path), Ref());
    if (!attrs || attrs.isNil() || Number(unwrap(attrs.objectForKey($.NSFileSize), 0)) <= 64) {
        throw new Error(t('Не удалось получить аудиоданные.'));
    }
}

function publishAudioExport() {
    var job = audioExport;
    if (!job) return;
    active = paused = false;
    try {
        var path = job.convertedPath || job.path;
        requireAudioFile(path);
        // Both paths are on the same volume. Only publish a complete file;
        // an existing destination survives cancellation or synthesis failure.
        if ($.rename(path, job.destination) !== 0) throw new Error(t('Не удалось переместить готовый файл в выбранную папку.'));
        status(t('Аудио сохранено: {path}', { path: job.destination }));
    } catch (error) { status(t('Аудио: ') + String(error)); }
    finally { discardAudioExport(); updateControls(); }
}

function failAudioExport(error) {
    active = paused = false;
    discardAudioExport();
    status(t('Аудио: ') + String(error));
    updateControls();
}

function audioConversionArguments(format, quality, source, destination) {
    var args;
    if (format === 'm4a' && [64000, 128000, 192000].indexOf(quality) >= 0) {
        args = ['-f', 'm4af', '-d', 'aac@44100', '-b', String(quality), '-q', '127', '-s', '2'];
    } else if (format === 'wav' && [16, 24].indexOf(quality) >= 0) {
        args = ['-f', 'WAVE', '-d', 'LEI' + quality];
    } else throw new Error(t('Неизвестный формат или качество аудио.'));
    return args.concat([source, destination]);
}

function finishAudioExport(success) {
    var job = audioExport;
    if (!job || job.task) return;
    try {
        if (!success) throw new Error(t('Сохранение отменено.'));
        requireAudioFile(job.path);
        if (!job.format || job.format === 'original') { publishAudioExport(); return; }
        job.convertedPath = job.directory + '/converted.' + job.format;
        job.task = $.NSTask.alloc.init;
        job.task.launchPath = $('/usr/bin/afconvert');
        job.task.arguments = $(audioConversionArguments(job.format, job.quality, job.path, job.convertedPath));
        job.task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
        job.task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
        job.errorHandle = createHostLog(job.directory + '/convert.log');
        job.task.standardError = job.errorHandle;
        job.task.launch;
        job.timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
            0.2, controller, 'exportTick:', null, true);
        $.NSRunLoop.mainRunLoop.addTimerForMode(job.timer, $.NSRunLoopCommonModes);
        status(t('Преобразую в ') + job.format.toUpperCase() + t('… «Стоп» отменяет сохранение.'));
    } catch (error) { failAudioExport(error); }
}

function exportTick() {
    var job = audioExport;
    if (!job || !job.task) return;
    try {
        if (job.task.running) return;
        if (Number(job.task.terminationStatus) !== 0) {
            throw new Error(t('Не удалось преобразовать аудио. ') + readHostText(job.directory + '/convert.log').trim().slice(0, 2000));
        }
        publishAudioExport();
    } catch (error) { failAudioExport(error); }
}

function chooseAudioExport() {
    var original = engine === 'ns' ? 'AIFF' : 'CAF';
    var choices = [
        { title: t('M4A · AAC 64 кбит/с — компактный'), format: 'm4a', quality: 64000 },
        { title: t('M4A · AAC 128 кбит/с — стандартный'), format: 'm4a', quality: 128000 },
        { title: t('M4A · AAC 192 кбит/с — высокий'), format: 'm4a', quality: 192000 },
        { title: t('WAV · PCM 16 бит'), format: 'wav', quality: 16 },
        { title: t('WAV · PCM 24 бита'), format: 'wav', quality: 24 },
        { title: original + t(' · исходное аудио голоса'), format: 'original' }
    ];
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $(t('Формат и качество аудио'));
    dialog.informativeText = $(t('Сохраняется весь текст или выделенный фрагмент.\n') +
        t('M4A — компактный файл; WAV — без сжатия. Более высокое качество не добавляет деталей исходному голосу.'));
    dialog.addButtonWithTitle($(t('Далее…')));
    dialog.addButtonWithTitle($(t('Отмена')));
    var popup = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 360, 30), false);
    choices.forEach(function (choice) { popup.addItemWithTitle($(choice.title)); });
    popup.selectItemAtIndex(Math.floor(clamp(unwrap(defaults.objectForKey($('audioFormatChoice')), 1), 0, 5, 1)));
    dialog.accessoryView = popup;
    if (Number(dialog.runModal) !== 1000) return null;
    var index = Number(popup.indexOfSelectedItem);
    defaults.setObjectForKey($(index), $('audioFormatChoice'));
    return choices[index];
}

function exportAudio() {
    if (active || !synth) return;
    var range = ui.editor.selectedRange;
    var text = textToRead(unwrap(ui.editor.string, ''), Number(range.location), Number(range.length));
    if (!text.trim()) { status(t('Введите текст или выделите фрагмент для сохранения.')); return; }
    var choice = chooseAudioExport();
    if (!choice) return;
    var sourceExtension = engine === 'ns' ? 'aiff' : 'caf';
    var extension = choice.format === 'original' ? sourceExtension : choice.format;
    var panel = $.NSSavePanel.savePanel;
    panel.title = $(t('Сохранить речь в аудиофайл'));
    panel.message = $(choice.title + (engine === 'ns' ? t(' • выбранный голос и скорость') :
        t('\nДля этого голоса нужны установленные Apple Command Line Tools или Xcode')));
    panel.allowedFileTypes = $([extension]);
    panel.allowsOtherFileTypes = false;
    panel.canCreateDirectories = true;
    panel.nameFieldStringValue = $('kasholkaTTS.' + extension);
    if (Number(panel.runModal) !== Number($.NSModalResponseOK)) return;
    selectVoice();
    if (!synth) return;
    var destination = unwrap(panel.URL.path, '');
    var parent = unwrap(panel.URL.URLByDeletingLastPathComponent.path, '');
    var directory = parent + '/.kasholkaTTS-' + unwrap($.NSUUID.UUID.UUIDString, '');
    var permissions = $.NSMutableDictionary.alloc.init;
    permissions.setObjectForKey($(448), $.NSFilePosixPermissions);
    if (!destination || !$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        $(directory), false, permissions, Ref())) throw new Error(t('Не удалось создать временный файл рядом с выбранным.'));
    audioExport = { destination: destination, directory: directory, path: directory + '/speech.' + sourceExtension,
        format: choice.format, quality: choice.quality };
    active = true;
    paused = false;
    updateControls();
    status(t('Сохраняю аудио… Кнопка «Стоп» отменяет сохранение.'));
    try {
        if (engine === 'ns') {
            applyNSPitch(synth, selectedPitchOffset());
            synth.setRate(voiceBaseRate * speedFactor(ui.rate.doubleValue));
            if (!synth.startSpeakingStringToURL($(text), $.NSURL.fileURLWithPath($(audioExport.path)))) {
                throw new Error(t('Голос не начал сохранение аудио.'));
            }
        } else {
            var voice = selectedVoice();
            hostSpeech = startHostJob('export', { id: voice.id, text: text,
                factor: speedFactor(ui.rate.doubleValue), pitch: Math.pow(2, selectedPitchOffset() / 12),
                output: audioExport.path }, 'swift');
        }
    } catch (error) {
        active = false;
        stopSynth();
        discardAudioExport();
        updateControls();
        throw error;
    }
}

function selectedPitchOffset() {
    var voice = selectedVoice();
    return voice ? clamp(debugPitchOffsets[voiceKey(voice)] || 0, -12, 12, 0) : 0;
}

function applyNSPitch(target, offset) {
    if (!offset) return; // Natural pitch never needs an optional property write.
    var base = Number(unwrap(target.objectForPropertyError($.NSSpeechPitchBaseProperty, Ref()), NaN));
    if (!isFinite(base) || base <= 0 || !target.setObjectForPropertyError(
        $(base + offset), $.NSSpeechPitchBaseProperty, Ref())) {
        throw new Error(t('Этот голос не поддерживает изменение высоты.'));
    }
}

function setDebugPitch(offset) {
    if (active || !synth) return;
    var voice = selectedVoice();
    if (!voice) return;
    offset = clamp(offset, -12, 12, 0);
    // Check support on a fresh synthesizer, without changing the selected one.
    if (engine === 'ns' && offset) {
        var probe = $.NSSpeechSynthesizer.alloc.initWithVoice($(voice.id));
        if (!probe || probe.isNil()) throw new Error(t('Голос недоступен.'));
        applyNSPitch(probe, offset);
    }
    debugPitchOffsets[voiceKey(voice)] = offset;
    status(offset ? t('Высота изменена для следующего чтения.') : t('Естественная высота восстановлена.'));
}

function showDebugPitch() {
    if (active || voiceProbe) { status(t('Дождитесь окончания поиска и остановите чтение.')); return; }
    if (!synth) { status(t('Сначала выберите голос.')); return; }
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $(t('Высота голоса — экспериментально'));
    dialog.informativeText = $(t('Слева ниже, справа выше, в середине — естественная высота.\nДля выбранного голоса, со следующего чтения. Эффект зависит от голоса.'));
    var slider = $.NSSlider.alloc.initWithFrame($.NSMakeRect(0, 0, 320, 28));
    slider.minValue = -12;
    slider.maxValue = 12;
    slider.doubleValue = selectedPitchOffset();
    slider.numberOfTickMarks = 5;
    slider.allowsTickMarkValuesOnly = false;
    dialog.accessoryView = slider;
    dialog.addButtonWithTitle($(t('Применить')));
    dialog.addButtonWithTitle($(t('Сбросить')));
    dialog.addButtonWithTitle($(t('Отмена')));
    var result = Number(dialog.runModal);
    if (result === 1000) setDebugPitch(slider.doubleValue);
    else if (result === 1001) setDebugPitch(0);
}

function searchSiriVoices() {
    if (active) { status(t('Для поиска Siri сначала остановите чтение.')); return; }
    if (voiceProbe) { status(t('Поиск Siri уже выполняется.')); return; }
    hostVoices = [];
    ['osascript', 'swift'].forEach(function (name) {
        delete voiceDiagnostics[name];
        delete voiceInventories[name];
    });
    refreshVoices();
    beginVoiceProbe();
}

function readHostText(path) {
    return unwrap($.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, Ref()), '');
}

function voiceDiagnosticText() {
    var os = unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString, 'macOS');
    var lines = ['kasholkaTTS ' + VERSION, os];
    ['app', 'osascript', 'swift'].forEach(function (name) {
        lines.push('\n' + name + ': ' + (voiceDiagnostics[name] || t('Пока не проверено')));
        (voiceInventories[name] || []).forEach(function (voice) {
            lines.push(voice.id + ' | ' + voice.name + ' | ' + voice.locale);
        });
    });
    return lines.join('\n');
}

function showVoiceDiagnostics() {
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $(t('Диагностика голосов'));
    dialog.informativeText = $(['app', 'osascript', 'swift'].map(function (name) {
        return name + ': ' + (voiceDiagnostics[name] || t('Пока не проверено'));
    }).join('\n\n').slice(0, 2000) + t('\n\nВ отчёте — версия macOS, ошибки и идентификаторы голосов. Вашего текста там нет.'));
    dialog.addButtonWithTitle($(t('Скопировать отчёт')));
    dialog.addButtonWithTitle($(t('Закрыть')));
    if (Number(dialog.runModal) === 1000) {
        var pasteboard = $.NSPasteboard.generalPasteboard;
        pasteboard.clearContents;
        pasteboard.setStringForType($(voiceDiagnosticText()), $.NSPasteboardTypeString);
        status(t('Отчёт о голосах скопирован.'));
    }
}

function recordVoiceInventory(backend, list) {
    voiceInventories[backend] = list;
    var siri = list.filter(isSiriVoice);
    voiceDiagnostics[backend] = t('Всего: ') + list.length + ', Siri: ' + siri.length +
        t('\nSiri по языкам: ') + ['en-GB', 'en-US', 'ru-RU'].map(function (locale) {
            return locale + ': ' + siri.filter(function (voice) {
                return String(voice.locale || '').replace(/_/g, '-').toLowerCase() === locale.toLowerCase();
            }).length;
        }).join(', ');
}

function writeHostJSON(path, value) {
    if (!$(JSON.stringify(value)).writeToFileAtomicallyEncodingError($(path), true, $.NSUTF8StringEncoding, Ref())) {
        throw new Error(t('Не удалось записать данные речевого помощника.'));
    }
}

function readHostJSON(path) {
    var data = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, Ref());
    return !data || data.isNil() ? null : JSON.parse(ObjC.unwrap(data));
}

function sendHostCommand(job, command) {
    if (command) job.command = command;
    job.heartbeat = Date.now();
    writeHostJSON(job.directory + '/control.json', { command: job.command, time: job.heartbeat });
}

function disposeHostJob(job) {
    if (!job) return;
    // Kill only our own NSTask, never another osascript or a system service.
    try { if (job.task && job.task.running) job.task.terminate; } catch (exited) {}
    // Individual known files only. The child never recreates its directory.
    if (job.errorHandle) { try { job.errorHandle.closeFile; } catch (closed) {} }
    ['request.json', 'control.json', 'result.json', 'stderr.txt'].forEach(function (name) {
        try { $.NSFileManager.defaultManager.removeItemAtPathError($(job.directory + '/' + name), Ref()); } catch (missing) {}
    });
    // rmdir is nonrecursive and refuses an unexpectedly nonempty directory.
    try { $.rmdir(job.directory); } catch (missing) {}
}

function createHostLog(path) {
    // JS null can bridge to NSNull, which is neither NSData nor NSDictionary.
    // Pass concrete Foundation objects even for an empty file/default attrs.
    if (!$.NSFileManager.defaultManager.createFileAtPathContentsAttributes(
        $(path), $.NSData.data, $.NSDictionary.dictionary)) {
        throw new Error(t('Не удалось создать журнал речевого помощника.'));
    }
    var handle = $.NSFileHandle.fileHandleForWritingAtPath($(path));
    if (!handle || handle.isNil()) throw new Error(t('Не удалось открыть журнал речевого помощника.'));
    return handle;
}

function startHostJob(mode, request, backend) {
    backend = backend || 'osascript';
    var path = $.NSBundle.mainBundle.pathForResourceOfType($('voice-host'), $(backend === 'swift' ? 'swift' : 'js'));
    if (!path || path.isNil()) throw new Error(t('Не найден речевой помощник. Переустановите приложение.'));
    var launcher = null;
    if (backend === 'swift') {
        launcher = $.NSBundle.mainBundle.pathForResourceOfType($('voice-host-swift'), $('sh'));
        if (!launcher || launcher.isNil()) throw new Error(t('Не найден запускатель Swift. Переустановите приложение.'));
    }
    var directory = unwrap($.NSTemporaryDirectory(), '') + 'kasholkaTTS-' + unwrap($.NSUUID.UUID.UUIDString, '');
    var permissions = $.NSMutableDictionary.alloc.init;
    permissions.setObjectForKey($(448), $.NSFilePosixPermissions); // 0700
    if (!$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        $(directory), false, permissions, Ref())) throw new Error(t('Не удалось создать папку речевого помощника.'));
    var timeout = backend === 'swift' ? 60 : 15;
    var job = { directory: directory, mode: mode, backend: backend, timeout: timeout,
        command: 'play', deadline: Date.now() + timeout * 1000, ready: false };
    try {
        writeHostJSON(directory + '/request.json', request || {});
        sendHostCommand(job);
        job.task = $.NSTask.alloc.init;
        job.task.launchPath = $(backend === 'swift' ? '/bin/bash' : '/usr/bin/osascript');
        job.task.arguments = $(backend === 'swift' ?
            [unwrap(launcher, ''), unwrap(path, ''), mode, directory] :
            ['-l', 'JavaScript', unwrap(path, ''), mode, directory]);
        job.task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
        job.task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
        job.errorHandle = createHostLog(directory + '/stderr.txt');
        job.task.standardError = job.errorHandle;
        job.task.launch;
        if (!hostTimer) {
            hostTimer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
                0.2, controller, 'hostTick:', null, true);
            $.NSRunLoop.mainRunLoop.addTimerForMode(hostTimer, $.NSRunLoopCommonModes);
        }
        return job;
    } catch (error) { disposeHostJob(job); throw error; }
}

function voiceKey(voice) {
    return (voice.engine === 'host' ? (voice.backend === 'swift' ? 'swift:' : 'host:') : voice.engine === 'av' ? 'av:' : '') + voice.id;
}

function addHostVoices(list) {
    var seen = {};
    voices.forEach(function (voice) { seen[voice.id] = true; });
    list.forEach(function (voice) {
        if (!voice || typeof voice.id !== 'string' || !voice.id || seen[voice.id]) return;
        seen[voice.id] = true;
        voices.push({ id: voice.id, name: String(voice.name || voice.id),
            locale: String(voice.locale || ''), engine: 'host', backend: voice.backend || 'osascript' });
    });
}

function beginVoiceProbe(backend) {
    backend = backend || 'osascript';
    disposeHostJob(voiceProbe);
    voiceProbe = null;
    try {
        voiceDiagnostics[backend] = t('Проверяется…');
        voiceProbe = startHostJob('list', null, backend);
        if (!active) status(backend === 'swift' ? t('Проверяю Siri через Swift (до 60 с)…') : t('Проверяю Siri через osascript…'));
    } catch (error) {
        voiceDiagnostics[backend] = String(error);
        finishVoiceProbe(backend, false);
    }
}

function finishVoiceProbe(backend, succeeded) {
    var preferred = unwrap(defaults.stringForKey($('voice')), '');
    if (backend === 'osascript' && (!voices.some(isSiriVoice) || preferred.indexOf('swift:') === 0)) {
        beginVoiceProbe('swift');
        return;
    }
    if (backend === 'osascript') voiceDiagnostics.swift = t('Не запускался: Siri уже найдены.');
    if (active) return;
    var count = voices.filter(isSiriVoice).length;
    if (count) status(t('Найдено голосов Siri: ') + count + t('. Выберите [Siri] в списке.'));
    else status(succeeded ? t('Siri не найдены. Дебаг → Диагностика голосов.') :
        t('Проверка Siri не завершена. Дебаг → Диагностика голосов.'));
}

function pollHostJob(job) {
    var result = readHostJSON(job.directory + '/result.json');
    if (result && result.state === 'error') throw new Error(helperError(result.message));
    if (result && (result.state === 'voices' || result.state === 'finished')) return result;
    if (!job.task.running) {
        var detail = helperError(readHostText(job.directory + '/stderr.txt').trim().slice(0, 4000));
        throw new Error(t('Помощник ') + job.backend + t(' завершился (код ') + job.task.terminationStatus + '). ' + detail);
    }
    if (result && (result.state === 'speaking' || result.state === 'paused' || result.state === 'exporting')) job.ready = true;
    if (!job.ready && Date.now() > job.deadline) throw new Error(t('Речевой помощник не ответил за ') + job.timeout + t(' секунд.'));
    if (Date.now() - job.heartbeat > 2000) sendHostCommand(job);
    return result;
}

function hostTick() {
    if (voiceProbe) {
        var probeBackend = voiceProbe.backend;
        try {
            var inventory = pollHostJob(voiceProbe);
            // Keep the current voice menu stable until a reading finishes.
            if (inventory && inventory.state === 'voices' && !active) {
                if (!Array.isArray(inventory.voices)) throw new Error(t('Некорректный список голосов.'));
                recordVoiceInventory(probeBackend, inventory.voices);
                hostVoices = hostVoices.filter(function (voice) { return (voice.backend || 'osascript') !== probeBackend; });
                hostVoices = hostVoices.concat(inventory.voices.map(function (voice) {
                    return { id: voice.id, name: voice.name, locale: voice.locale, backend: probeBackend };
                }));
                disposeHostJob(voiceProbe);
                voiceProbe = null;
                var preferred = unwrap(defaults.stringForKey($('voice')), '');
                voices = voices.filter(function (voice) { return voice.engine !== 'host'; });
                addHostVoices(hostVoices);
                populateVoices(preferred, false);
                finishVoiceProbe(probeBackend, true);
            }
        } catch (error) {
            disposeHostJob(voiceProbe);
            voiceProbe = null;
            voiceDiagnostics[probeBackend] = String(error);
            finishVoiceProbe(probeBackend, false);
        }
    }
    if (hostSpeech) {
        try {
            var result = pollHostJob(hostSpeech);
            if (result && result.state === 'finished') {
                disposeHostJob(hostSpeech);
                hostSpeech = null;
                if (audioExport) { finishAudioExport(true); return; }
                active = false;
                paused = false;
                endReading();
                status(t('Прочитано'));
                updateControls();
            } else if (result && (result.state === 'speaking' || result.state === 'paused')) {
                paused = result.state === 'paused';
                if (result.range) highlightWord(result.range);
                status(paused ? t('Пауза') : t('Читаю текст…'));
                updateControls();
            }
        } catch (error) {
            var operation = audioExport ? t('Сохранение аудио: ') : t('Чтение: ');
            disposeHostJob(hostSpeech);
            hostSpeech = null;
            active = false;
            paused = false;
            endReading();
            discardAudioExport();
            status(operation + String(error));
            updateControls();
        }
    }
    if (!voiceProbe && !hostSpeech && hostTimer) {
        hostTimer.invalidate;
        hostTimer = null;
    }
}

function closeHosts() {
    disposeHostJob(voiceProbe);
    disposeHostJob(hostSpeech);
    voiceProbe = hostSpeech = null;
    if (hostTimer) hostTimer.invalidate;
    hostTimer = null;
}

function avFoundationClass(name) {
    var klass = $[name];
    if (klass && !(klass.isNil && klass.isNil())) return klass;
    var bundle = $.NSBundle.bundleWithPath($('/System/Library/Frameworks/AVFoundation.framework'));
    if (!bundle || bundle.isNil() || !bundle.load) {
        throw new Error(t('Не удалось загрузить системный мультимедийный движок.'));
    }
    // Keep the loaded bundle alive for as long as its classes are in use.
    avFoundationBundle = bundle;
    klass = $.NSClassFromString($(name));
    if (!klass || klass.isNil && klass.isNil()) {
        throw new Error(t('Системный класс недоступен: ') + name);
    }
    return klass;
}

function stopSynth() {
    currentUtterance = null;
    endReading();
    if (hostSpeech) {
        disposeHostJob(hostSpeech);
        hostSpeech = null;
    }
    if (engine === 'host') return;
    if (!synth) return;
    synth.delegate = null;
    if (engine === 'av') synth.stopSpeakingAtBoundary(0);
    else synth.stopSpeaking;
}

function finishAV(sender, utterance, finished) {
    if (!synth || !sender.isEqual(synth) || !active || !currentUtterance ||
        !utterance.isEqual(currentUtterance)) return;
    active = false;
    paused = false;
    currentUtterance = null;
    endReading();
    status(finished ? t('Прочитано') : t('Чтение прервано'));
    updateControls();
}

function unwrap(value, fallback) {
    if (value === undefined || value === null || value.isNil && value.isNil()) return fallback;
    var result = ObjC.unwrap(value);
    return result === undefined || result === null ? fallback : result;
}

function clamp(value, low, high, fallback) {
    value = Number(value);
    return isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
}

function textToRead(text, location, length) {
    // NSString/NSTextView ranges and JS strings both count UTF-16 code units.
    return length > 0 ? text.substr(location, length) : text;
}

function status(message) {
    if (ui.status) {
        ui.status.stringValue = $(message);
        ui.status.toolTip = $(message);
    }
}

function alertUser(title, message) {
    var alert = $.NSAlert.alloc.init;
    alert.messageText = $(title);
    alert.informativeText = $(message);
    alert.addButtonWithTitle($('OK'));
    alert.runModal;
}

function guarded(action) {
    return function () {
        try { action(); }
        catch (error) {
            status(t('Ошибка. Попробуйте другой голос или перезапустите приложение.'));
            alertUser('kasholkaTTS', String(error));
        }
    };
}

function updateControls() {
    var ready = !!synth && voices.length > 0;
    ui.play.enabled = ready && !active;
    if (ui.preview) ui.preview.enabled = ready && !active;
    ui.pause.enabled = active && !audioExport;
    ui.pause.title = $(paused ? t('Продолжить') : t('Пауза'));
    ui.stop.enabled = active;
    ui.voice.enabled = !active && voices.length > 0;
    ui.refresh.enabled = !active;
    ui.rate.enabled = ready && !active;
    ui.reset.enabled = ready && !active;
    ui.open.enabled = !active;
    ui.editor.editable = !active;
    if (ui.exportItem) ui.exportItem.enabled = ready && !active;
}

function speedFactor(position) {
    // Smooth, monotonic setting: slow / natural / fast, with natural at center.
    return Math.pow(2, 2 * clamp(position, 0, 1, 0.5) - 1);
}

function applyRate() {
    var position = clamp(ui.rate.doubleValue, 0, 1, 0.5);
    var factor = speedFactor(position);
    // Never write back to the knob from its action while the user is dragging.
    ui.rateValue.stringValue = $(engine !== 'ns' ? factor.toFixed(2) + '×' :
        Math.round(voiceBaseRate * factor) + t(' сл/мин'));
    defaults.setDoubleForKey(position, $('speedPosition'));
}

function selectVoice(savePreference) {
    if (active || !voices.length) return;
    var item = selectedVoice();
    if (!item) return;
    // Each new synthesizer starts with the voice's natural pitch and rate.
    stopSynth();
    engine = item.engine || 'ns';
    synth = engine === 'host' ? { isNil: function () { return false; } } :
        engine === 'av' ? avFoundationClass('AVSpeechSynthesizer').alloc.init :
        $.NSSpeechSynthesizer.alloc.initWithVoice($(item.id));
    if (!synth || synth.isNil()) {
        synth = null;
        status(t('Голос недоступен. Выберите другой или обновите список.'));
        updateControls();
        return;
    }
    synth.delegate = controller;
    voiceBaseRate = engine === 'ns' ? clamp(synth.rate, 80, 400, 180) : 180;
    if (savePreference !== false) defaults.setObjectForKey($(voiceKey(item)), $('voice'));
    applyRate();
    status(t('Готово • ') + item.name);
    updateControls();
}

function isSiriVoice(voice) {
    // Both com.apple.siri.* and older com.apple.ttsbundle.siri_* identifiers
    // occur in system voice inventories. A display name explicitly saying Siri
    // is also valid; ordinary human names alone are not evidence of Siri.
    return /(^|[._-])siri([._-]|$)/i.test(voice.id || '') || /\bsiri\b/i.test(voice.name || '');
}

function refreshVoices() {
    if (active) return;
    var preferred = unwrap(defaults.stringForKey($('voice')), '');
    if (!preferred) preferred = unwrap($.NSSpeechSynthesizer.defaultVoice, '');
    var available = $.NSSpeechSynthesizer.availableVoices;
    voices = [];
    for (var i = 0; i < Number(available.count); i++) {
        var id = available.objectAtIndex(i);
        var attrs = $.NSSpeechSynthesizer.attributesForVoice(id);
        voices.push({
            engine: 'ns',
            id: unwrap(id, ''),
            name: unwrap(attrs.objectForKey($.NSVoiceName), unwrap(id, t('Голос'))),
            locale: unwrap(attrs.objectForKey($.NSVoiceLocaleIdentifier), '')
        });
    }
    // Public AVFoundation API exposes additional voices on some Macs, including
    // Siri when the OS makes them available. Never fabricate hidden identifiers.
    var avFailed = false;
    try {
        var modern = avFoundationClass('AVSpeechSynthesisVoice').speechVoices;
        var seen = {};
        voices.forEach(function (voice) { seen[voice.id] = true; });
        for (var j = 0; j < Number(modern.count); j++) {
            var nativeVoice = modern.objectAtIndex(j);
            var identifier = unwrap(nativeVoice.identifier, '');
            if (!identifier || seen[identifier]) continue;
            seen[identifier] = true;
            voices.push({ id: identifier, engine: 'av',
                name: unwrap(nativeVoice.name, identifier),
                locale: unwrap(nativeVoice.language, '') });
        }
    } catch (error) { avFailed = true; }
    recordVoiceInventory('app', voices.slice());
    // Normal refresh never starts helpers; preserve results of a manual search.
    addHostVoices(hostVoices);
    populateVoices(preferred, avFailed);
}

function selectedVoice() {
    var item = ui.voice.selectedItem;
    if (!item || item.isNil && item.isNil()) return undefined;
    var index = Number(item.tag);
    return isFinite(index) && Math.floor(index) === index && index >= 0 ? voices[index] : undefined;
}

function voiceLanguage(voice) {
    var code = String(voice.locale || '').replace(/_/g, '-').split('-')[0].toLowerCase();
    var names = { ar: t('Арабский'), bg: t('Болгарский'), ca: t('Каталанский'), cs: t('Чешский'),
        da: t('Датский'), de: t('Немецкий'), el: t('Греческий'), en: t('Английский'), es: t('Испанский'),
        fi: t('Финский'), fr: t('Французский'), he: t('Иврит'), hi: t('Хинди'), hr: t('Хорватский'),
        hu: t('Венгерский'), id: t('Индонезийский'), it: t('Итальянский'), ja: t('Японский'),
        ko: t('Корейский'), ms: t('Малайский'), nb: t('Норвежский'), nl: t('Нидерландский'),
        pl: t('Польский'), pt: t('Португальский'), ro: t('Румынский'), ru: t('Русский'),
        sk: t('Словацкий'), sv: t('Шведский'), ta: t('Тамильский'), th: t('Тайский'),
        tr: t('Турецкий'), uk: t('Украинский'), vi: t('Вьетнамский'), zh: t('Китайский') };
    if (code === 'iw') code = 'he';
    if (code === 'in') code = 'id';
    return { code: code || 'und', name: names[code] || (code ? t('Язык: ') + code : t('Язык не указан')) };
}

function voiceGroup(voice) {
    var language = voiceLanguage(voice);
    var parts = String(voice.locale || '').replace(/_/g, '-').split('-');
    var region = parts.slice(1).join('-').toUpperCase();
    var regions = { RU: t('Россия'), US: t('Соединённые Штаты Америки'), GB: t('Великобритания'),
        SCOTLAND: t('Англо-шотландский'), AU: t('Австралия'), IE: t('Ирландия'), IN: t('Индия'),
        ZA: t('Южная Африка'), CA: t('Канада'), FR: t('Франция'), DE: t('Германия'), IT: t('Италия'),
        ES: t('Испания'), MX: t('Мексика'), AR: t('Аргентина'), PT: t('Португалия'), BR: t('Бразилия'),
        CN: t('Китай'), TW: t('Тайвань'), HK: t('Гонконг'), JP: t('Япония'), KR: t('Южная Корея'),
        AT: t('Австрия'), BE: t('Бельгия'), CH: t('Швейцария'), NL: t('Нидерланды'), SE: t('Швеция'),
        NO: t('Норвегия'), DK: t('Дания'), FI: t('Финляндия'), PL: t('Польша'), CZ: t('Чехия'),
        SK: t('Словакия'), HU: t('Венгрия'), RO: t('Румыния'), GR: t('Греция'), TR: t('Турция'),
        IL: t('Израиль'), SA: t('Саудовская Аравия'), TH: t('Таиланд'), ID: t('Индонезия'),
        VN: t('Вьетнам'), UA: t('Украина'), MY: t('Малайзия') };
    var funny = /^com\.apple\.speech\.synthesis\.voice\.(albert|badnews|bahh|bells|boing|bubbles|cellos|deranged|goodnews|hysterical|organ|trinoids|whisper|zarvox)$/i.test(voice.id || '');
    var title = language.name + (region ? ' (' + (regions[region] || region) + ')' : '');
    if (funny) title += t(' — Забавные');
    return { key: language.code + ':' + region + ':' + (funny ? '1' : '0'),
        language: language.code, region: region, funny: funny, title: title };
}

function populateVoices(preferred, avFailed) {
    var firstLanguage = typeof uiLanguage === 'string' ? uiLanguage : 'ru';
    voices.sort(function (a, b) {
        var left = voiceGroup(a), right = voiceGroup(b);
        if (left.key !== right.key) {
            if (left.language === firstLanguage && right.language !== firstLanguage) return -1;
            if (right.language === firstLanguage && left.language !== firstLanguage) return 1;
            if (left.language === right.language && left.region === right.region) return left.funny ? 1 : -1;
            return left.title.localeCompare(right.title);
        }
        return (a.name + a.id).localeCompare(b.name + b.id);
    });
    ui.voice.removeAllItems;
    ui.voice.menu.autoenablesItems = false;
    var selected = 1, siriCount = 0, menuIndex = 0, lastLanguage = null;
    voices.forEach(function (voice, index) {
        var group = voiceGroup(voice);
        if (group.key !== lastLanguage) {
            if (lastLanguage !== null) {
                var separator = $.NSMenuItem.separatorItem;
                separator.tag = -1;
                ui.voice.menu.addItem(separator);
                menuIndex++;
            }
            var heading = ui.voice.menu.addItemWithTitleActionKeyEquivalent($(group.title), 'voice:', $(''));
            heading.enabled = false;
            heading.tag = -1;
            lastLanguage = group.key;
            menuIndex++;
        }
        // Add directly to NSMenu: NSPopUpButton's convenience method coalesces
        // equal titles. Native menu items keep distinct identities without numbers.
        var siri = isSiriVoice(voice);
        if (siri) siriCount++;
        var menuItem = ui.voice.menu.addItemWithTitleActionKeyEquivalent($((siri ? '[Siri] ' : '') + voice.name), 'voice:', $(''));
        menuItem.target = controller;
        menuItem.tag = index;
        menuItem.toolTip = $(voice.locale);
        menuItem.indentationLevel = 0;
        if (voiceKey(voice) === preferred) selected = menuIndex;
        menuIndex++;
    });
    if (voices.length) {
        ui.voice.selectItemAtIndex(selected);
        selectVoice(false);
    } else {
        stopSynth();
        synth = null;
        status(t('Нет доступных голосов. Добавьте голос в настройках macOS и нажмите «Обновить».'));
        updateControls();
    }
    if (!active && avFailed) status(t('Дополнительные голоса недоступны. Обычные голоса можно использовать.'));
    ui.voice.toolTip = $(t('Голосов Siri в списке: ') + siriCount);
}

function voicePreviewText(locale) {
    var language = String(locale || '').toLowerCase().split(/[-_]/)[0];
    var phrases = {
        ru: 'Привет! Так звучит мой голос. Один, два, три. Приятного прослушивания!',
        en: 'Hello! This is my voice. One, two, three. Thanks for listening!',
        de: 'Hallo! So klingt meine Stimme. Eins, zwei, drei. Viel Spaß beim Zuhören!',
        fr: 'Bonjour ! Voici ma voix. Un, deux, trois. Bonne écoute !',
        es: '¡Hola! Así suena mi voz. Uno, dos, tres. ¡Gracias por escuchar!',
        it: 'Ciao! Questa è la mia voce. Uno, due, tre. Buon ascolto!',
        pt: 'Olá! Esta é a minha voz. Um, dois, três. Obrigado por ouvir!',
        zh: '你好！这是我的声音。一，二，三。谢谢收听！',
        ja: 'こんにちは。これが私の声です。一、二、三。聞いてくれてありがとう。',
        ko: '안녕하세요! 이것이 제 목소리입니다. 하나, 둘, 셋. 들어 주셔서 감사합니다!'
    };
    return phrases[language] || phrases.en;
}

function previewVoice() { play(true); }

function play(preview) {
    if (active || !synth) return;
    preview = preview === true;
    var range = ui.editor.selectedRange;
    var text = preview ? voicePreviewText((selectedVoice() || {}).locale) :
        textToRead(unwrap(ui.editor.string, ''), Number(range.location), Number(range.length));
    if (!text.trim()) { status(t('Введите текст или выделите фрагмент для чтения.')); return; }
    // Recreate the synthesizer for EVERY reading, including after a natural
    // finish. Apply the final slider position explicitly to this new instance.
    selectVoice();
    if (!synth) return;
    active = true;
    paused = false;
    if (!preview) {
        reading = { offset: Number(range.length) > 0 ? Number(range.location) : 0, length: text.length,
            selection: $.NSMakeRange(Number(range.location), Number(range.length)), words: highlightWords(text), text: text };
        beginWordDiagnostics(text);
        // Remove selection paint so the temporary highlight is visible.
        ui.editor.setSelectedRange($.NSMakeRange(reading.offset, 0));
    }
    status(preview ? t('Прослушивание голоса…') : range.length > 0 ? t('Читаю выделенный фрагмент…') : t('Читаю текст…'));
    updateControls();
    var started;
    try {
        var pitchOffset = selectedPitchOffset();
        var pitchFactor = Math.pow(2, pitchOffset / 12);
        if (engine === 'host') {
            var hostVoice = selectedVoice();
            hostSpeech = startHostJob('speak', { id: hostVoice.id, text: text,
                factor: speedFactor(ui.rate.doubleValue), pitch: pitchFactor }, hostVoice.backend);
            status(t('Запускаю выбранный голос…'));
            started = true;
        } else if (engine === 'av') {
            var item = selectedVoice();
            var avVoice = avFoundationClass('AVSpeechSynthesisVoice').voiceWithIdentifier($(item.id));
            if (!avVoice || avVoice.isNil()) throw new Error(t('Выбранный голос больше недоступен. Обновите список.'));
            currentUtterance = avFoundationClass('AVSpeechUtterance').speechUtteranceWithString($(text));
            currentUtterance.voice = avVoice;
            var naturalRate = clamp(currentUtterance.rate, 0.1, 1, 0.5);
            currentUtterance.rate = clamp(naturalRate * speedFactor(ui.rate.doubleValue), 0.1, 1, 0.5);
            if (pitchOffset) currentUtterance.pitchMultiplier = pitchFactor;
            synth.speakUtterance(currentUtterance);
            started = true;
        } else {
            applyNSPitch(synth, pitchOffset);
            synth.setRate(voiceBaseRate * speedFactor(ui.rate.doubleValue));
            started = synth.startSpeakingString($(text));
        }
    }
    catch (error) {
        active = false;
        currentUtterance = null;
        endReading();
        updateControls();
        throw error;
    }
    if (!started) {
        active = false;
        endReading();
        status(t('Не удалось начать чтение. Попробуйте другой голос.'));
        updateControls();
    }
}

function pauseOrResume() {
    if (!active || !synth || audioExport) return;
    if (engine === 'host') {
        if (hostSpeech) sendHostCommand(hostSpeech, hostSpeech.command === 'pause' ? 'play' : 'pause');
        return; // UI follows the helper's acknowledgement, including refusal.
    }
    if (paused) {
        var resumed = synth.continueSpeaking;
        if (engine === 'av' && !resumed) return;
        paused = false;
        status(t('Читаю текст…'));
    } else {
        var didPause = synth.pauseSpeakingAtBoundary(engine === 'av' ? 0 : $.NSSpeechImmediateBoundary);
        if (engine === 'av' && !didPause) return;
        paused = true;
        status(t('Пауза'));
    }
    updateControls();
}

function stop() {
    // Detach before stopping: late completion callbacks must not finish a new run.
    active = false;
    paused = false;
    stopSynth();
    discardAudioExport();
    selectVoice();
    status(t('Остановлено'));
    updateControls();
}

function reset() {
    if (active) return;
    var voice = selectedVoice();
    if (voice) delete debugPitchOffsets[voiceKey(voice)];
    ui.rate.doubleValue = 0.5;
    applyRate();
    status(t('Параметры голоса сброшены'));
}

function openText() {
    if (active) return;
    var panel = $.NSOpenPanel.openPanel;
    panel.title = $(t('Открыть текст'));
    panel.allowedFileTypes = $(['txt', 'text', 'md']);
    panel.allowsMultipleSelection = false;
    panel.canChooseDirectories = false;
    if (panel.runModal !== $.NSModalResponseOK) return;
    var error = Ref();
    var text = $.NSString.stringWithContentsOfURLUsedEncodingError(panel.URL, Ref(), error);
    if (!text || text.isNil()) {
        alertUser(t('Не удалось открыть файл'), t('Сохраните его как обычный текст UTF-8 или UTF-16 и попробуйте снова.'));
        return;
    }
    ui.editor.string = text;
    ui.editor.setSelectedRange($.NSMakeRange(0, 0));
    ui.editor.scrollRangeToVisible($.NSMakeRange(0, 0));
    status(t('Файл открыт. Нажмите «Читать».'));
}

function registerController() {
    ObjC.registerSubclass({
        name: 'KasholkaController',
        superclass: 'NSObject',
        // Do not resolve delegate protocols through JXA: their metadata may be
        // unavailable on Monterey ("protocol does not exist"). Cocoa dispatches
        // these optional callbacks by selector. Explicit types below provide
        // the signatures without requiring protocol lookup by the bridge.
        methods: {
            'play:': { types: ['void', ['id']], implementation: guarded(play) },
            'previewVoice:': { types: ['void', ['id']], implementation: guarded(previewVoice) },
            'pause:': { types: ['void', ['id']], implementation: guarded(pauseOrResume) },
            'stop:': { types: ['void', ['id']], implementation: guarded(stop) },
            'voice:': { types: ['void', ['id']], implementation: function (sender) {
                guarded(function () {
                    // Direct NSMenu actions carry the item, not the popup.
                    // Resolve its tag before reading the selection on all OS versions.
                    if (sender && sender.isKindOfClass && sender.isKindOfClass($.NSMenuItem)) {
                        if (Number(sender.tag) < 0) return;
                        ui.voice.selectItemWithTag(Number(sender.tag));
                    }
                    selectVoice();
                })();
            } },
            'refresh:': { types: ['void', ['id']], implementation: guarded(refreshVoices) },
            'rate:': { types: ['void', ['id']], implementation: guarded(applyRate) },
            'reset:': { types: ['void', ['id']], implementation: guarded(reset) },
            'openText:': { types: ['void', ['id']], implementation: guarded(openText) },
            'exportAudio:': { types: ['void', ['id']], implementation: guarded(exportAudio) },
            'exportTick:': { types: ['void', ['id']], implementation: exportTick },
            'autoScroll:': { types: ['void', ['id']], implementation: guarded(toggleAutoScroll) },
            'about:': { types: ['void', ['id']], implementation: guarded(showAbout) },
            'hostTick:': { types: ['void', ['id']], implementation: hostTick },
            'voiceDiagnostics:': { types: ['void', ['id']], implementation: guarded(showVoiceDiagnostics) },
            'wordDiagnostics:': { types: ['void', ['id']], implementation: guarded(showWordDiagnostics) },
            'startupTick:': { types: ['void', ['id']], implementation: startupTick },
            'searchSiri:': { types: ['void', ['id']], implementation: guarded(searchSiriVoices) },
            'debugPitch:': { types: ['void', ['id']], implementation: guarded(showDebugPitch) },
            'quitApp:': { types: ['void', ['id']], implementation: guarded(terminateApp) },
            'zoomIn:': { types: ['void', ['id']], implementation: guarded(function () { setScale(scale + 0.1); }) },
            'zoomOut:': { types: ['void', ['id']], implementation: guarded(function () { setScale(scale - 0.1); }) },
            'zoomReset:': { types: ['void', ['id']], implementation: guarded(function () { setScale(1); }) },
            'speechSynthesizer:willSpeakWord:ofString:': {
                types: ['void', ['id', 'NSRange', 'id']],
                implementation: function (sender, range, text) {
                    if (synth && sender.isEqual(synth)) highlightWord(range,
                        wordDiagnostics.recording ? unwrap(text, undefined) : undefined);
                }
            },
            'speechSynthesizer:willSpeakRangeOfSpeechString:utterance:': {
                types: ['void', ['id', 'NSRange', 'id']],
                implementation: function (sender, range, utterance) {
                    if (synth && sender.isEqual(synth) && currentUtterance &&
                        utterance.isEqual(currentUtterance)) highlightWord(range,
                            wordDiagnostics.recording ? unwrap(utterance.speechString, undefined) : undefined);
                }
            },
            'speechSynthesizer:didFinishSpeechUtterance:': {
                types: ['void', ['id', 'id']], implementation: function (sender, utterance) { finishAV(sender, utterance, true); }
            },
            'speechSynthesizer:didCancelSpeechUtterance:': {
                types: ['void', ['id', 'id']], implementation: function (sender, utterance) { finishAV(sender, utterance, false); }
            },
            'speechSynthesizer:didFinishSpeaking:': {
                types: ['void', ['id', 'bool']],
                implementation: function (sender, finished) {
                    if (!synth || !sender.isEqual(synth) || !active) return;
                    if (audioExport) { finishAudioExport(finished); return; }
                    active = false;
                    paused = false;
                    endReading();
                    status(finished ? t('Прочитано') : t('Чтение прервано'));
                    updateControls();
                }
            },
            'windowWillClose:': {
                types: ['void', ['id']],
                implementation: function (notification) {
                    if (notification && about.window && notification.object.isEqual(about.window)) {
                        if (about.player) about.player.pause;
                        return;
                    }
                    terminateApp();
                }
            },
            'windowDidResize:': {
                types: ['void', ['id']], implementation: function (notification) {
                    if (ui.window && notification.object.isEqual(ui.window)) layoutUI();
                }
            }
        }
    });
    controller = $.KasholkaController.alloc.init;
}

function addLabel(text, size, secondary) {
    var label = $.NSTextField.labelWithString($(text));
    label.font = $.NSFont.systemFontOfSize(size || 13);
    label.textColor = secondary ? $.NSColor.secondaryLabelColor : $.NSColor.labelColor;
    ui.content.addSubview(label);
    return label;
}

function addButton(title, selector) {
    var button = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 0, 100, 32));
    button.title = $(title);
    button.bezelStyle = $.NSBezelStyleRounded;
    button.target = controller;
    button.action = selector;
    ui.content.addSubview(button);
    return button;
}

function addSlider(min, max, value, selector) {
    var slider = $.NSSlider.alloc.initWithFrame($.NSMakeRect(0, 0, 100, 24));
    slider.minValue = min;
    slider.maxValue = max;
    slider.doubleValue = value;
    slider.continuous = false;
    slider.target = controller;
    slider.action = selector;
    ui.content.addSubview(slider);
    return slider;
}

function layoutFrames(width, height, factor) {
    var w = width / factor, h = height / factor;
    var frames = {
        voiceLabel: [16, h - 39, 50, 22], voice: [74, h - 43, w - 310, 30],
        preview: [w - 228, h - 44, 112, 32],
        refresh: [w - 112, h - 44, 100, 32],
        rateLabel: [16, h - 78, 65, 22], rate: [80, h - 79, w - 200, 24],
        rateValue: [w - 106, h - 78, 90, 22],
        textLabel: [16, h - 117, 160, 22], open: [w - 144, h - 122, 132, 32],
        scroll: [16, 92, w - 32, h - 220],
        play: [12, 47, 100, 32], pause: [116, 47, 120, 32], stop: [240, 47, 88, 32],
        reset: [w - 170, 47, 158, 32], status: [16, 14, w - 32, 24]
    };
    Object.keys(frames).forEach(function (key) {
        frames[key] = frames[key].map(function (value) { return value * factor; });
    });
    return frames;
}

function layoutUI() {
    if (!ui.scroll) return;
    var size = ui.content.bounds.size;
    var frames = layoutFrames(Number(size.width), Number(size.height), scale);
    Object.keys(frames).forEach(function (key) {
        var frame = frames[key];
        ui[key].frame = $.NSMakeRect(frame[0], frame[1], frame[2], frame[3]);
        if (key !== 'scroll' && key !== 'rate') {
            ui[key].font = $.NSFont.systemFontOfSize(13 * scale);
        }
    });
    ui.editor.font = $.NSFont.systemFontOfSize(18 * scale);
    ui.editor.textContainerInset = $.NSMakeSize(12 * scale, 12 * scale);
    var width = Number(ui.scroll.contentSize.width);
    var editorFrame = ui.editor.frame;
    ui.editor.setFrameSize($.NSMakeSize(width, Math.max(Number(editorFrame.size.height), Number(ui.scroll.contentSize.height))));
    ui.editor.textContainer.containerSize = $.NSMakeSize(width, 1000000);
}

function setScale(requested) {
    if (!ui.window) return;
    var screen = ui.window.screen;
    if (!screen || screen.isNil()) screen = $.NSScreen.mainScreen;
    var available = screen.visibleFrame.size;
    var maxScale = Math.min(1.5, (Number(available.width) - 24) / 680, (Number(available.height) - 60) / 400);
    var next = clamp(Math.round(requested * 10) / 10, 0.8, maxScale, 1);
    var size = ui.content.bounds.size;
    var width = Math.max(680, Number(size.width) / scale);
    var height = Math.max(400, Number(size.height) / scale);
    scale = next;
    ui.window.contentMinSize = $.NSMakeSize(680 * scale, 400 * scale);
    ui.window.setContentSize($.NSMakeSize(Math.min(width * scale, Number(available.width) - 24),
        Math.min(height * scale, Number(available.height) - 60)));
    defaults.setDoubleForKey(scale, $('uiScale'));
    layoutUI();
}

function videoClasses() {
    // ObjC.import loads bridge metadata, but $.AVQueuePlayer can still be
    // undefined in an applet. Load the framework binary and resolve its
    // Objective-C classes directly instead of relying on those JS bindings.
    var result = {};
    ['AVQueuePlayer', 'AVPlayerItem', 'AVPlayerLooper', 'AVPlayerLayer'].forEach(function (name) {
        result[name] = avFoundationClass(name);
    });
    result.bundle = avFoundationBundle;
    return result;
}

function aboutVideoLayout(width, height) {
    // The bundled about.mp4 has a 854 x 480 video track. Give the player a
    // matching rectangle that COVERS the window, then clip the excess. This
    // also works when JXA doesn't expose AVFoundation's gravity constants.
    var factor = Math.max(width / 854, height / 480);
    var videoWidth = 854 * factor, videoHeight = 480 * factor;
    return [(width - videoWidth) / 2, (height - videoHeight) / 2, videoWidth, videoHeight];
}

function startAboutVideo() {
    if (about.player) { about.player.play; return; }
    var player = null, looper = null, background = null;
    try {
        var path = $.NSBundle.mainBundle.pathForResourceOfType($('about'), $('mp4'));
        if (!path || path.isNil()) throw new Error(t('Не найдено видео About. Переустановите приложение из нового архива.'));
        var classes = videoClasses();
        player = classes.AVQueuePlayer.alloc.initWithItems($([]));
        player.muted = true;
        var item = classes.AVPlayerItem.playerItemWithURL($.NSURL.fileURLWithPath(path));
        // Objective-C exposes this two-argument API as a CLASS factory.
        // The Swift convenience initializer is not an Objective-C selector.
        looper = classes.AVPlayerLooper.playerLooperWithPlayerTemplateItem(player, item);
        var videoLayer = classes.AVPlayerLayer.playerLayerWithPlayer(player);
        var content = about.window.contentView;
        var size = content.bounds.size;
        var frame = aboutVideoLayout(Number(size.width), Number(size.height));
        content.wantsLayer = true;
        content.layer.masksToBounds = true;
        background = $.NSView.alloc.initWithFrame($.NSMakeRect(frame[0], frame[1], frame[2], frame[3]));
        background.layer = videoLayer;
        background.wantsLayer = true;
        videoLayer.frame = $.NSMakeRect(0, 0, frame[2], frame[3]);
        // The text is already present; always insert video UNDER the labels.
        about.window.contentView.addSubviewPositionedRelativeTo(background, $.NSWindowBelow, null);
        player.play;
        about.player = player;
        about.looper = looper;
        about.layer = videoLayer;
        about.background = background;
        about.framework = classes.bundle;
    } catch (error) {
        // Do not leave a half-created player/window behind or stop TTS.
        if (player) { try { player.pause; } catch (ignored) {} }
        if (looper) { try { looper.disableLooping; } catch (ignored) {} }
        if (background) { try { background.removeFromSuperview; } catch (ignored) {} }
        status(t('About открыто без видео: ') + String(error));
    }
}

function darkPanel(parent, frame, opacity, radius) {
    var panel = $.NSView.alloc.initWithFrame(frame);
    panel.wantsLayer = true;
    panel.layer.backgroundColor = $.NSColor.colorWithCalibratedWhiteAlpha(0, opacity).CGColor;
    panel.layer.cornerRadius = radius;
    parent.addSubview(panel);
    return panel;
}

function aboutLayout(width, height) {
    var cardWidth = Math.min(512, width - 48);
    return { card: [(width - cardWidth) / 2, (height - 176) / 2, cardWidth, 176],
        version: [width - 132, 12, 120, 24] };
}

function aboutCard(parent, frame) {
    var card;
    try {
        card = $.NSVisualEffectView.alloc.initWithFrame(frame);
        card.material = $.NSVisualEffectMaterialHUDWindow;
        card.blendingMode = $.NSVisualEffectBlendingModeWithinWindow;
        card.state = $.NSVisualEffectStateActive;
        card.appearance = $.NSAppearance.appearanceNamed($.NSAppearanceNameVibrantDark);
        // Only the material fades; the text is a separate sibling and stays
        // fully opaque. HUD material alone can look solid on Monterey.
        card.alphaValue = 0.5;
        card.wantsLayer = true;
        card.layer.cornerRadius = 20;
        card.layer.masksToBounds = true;
        card.layer.borderWidth = 1;
        card.layer.borderColor = $.NSColor.colorWithCalibratedWhiteAlpha(1, 0.8).CGColor;
        parent.addSubview(card);
    } catch (unavailable) {
        // Readable fallback if an older bridge cannot create the visual effect.
        card = darkPanel(parent, frame, 0.35, 20);
        card.layer.borderWidth = 1;
        card.layer.borderColor = $.NSColor.colorWithCalibratedWhiteAlpha(1, 0.45).CGColor;
    }
    return card;
}

function showAbout() {
    if (!about.window) {
        var window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
            $.NSMakeRect(0, 0, 560, 400), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable |
                $.NSWindowStyleMaskFullSizeContentView,
            $.NSBackingStoreBuffered, false);
        window.title = $(t('О kasholkaTTS'));
        window.titlebarAppearsTransparent = true;
        window.titleVisibility = $.NSWindowTitleHidden;
        window.movableByWindowBackground = true;
        window.releasedWhenClosed = false;
        window.delegate = controller;
        window.backgroundColor = $.NSColor.blackColor;
        window.contentView.wantsLayer = true;
        var layout = aboutLayout(Number(window.contentView.bounds.size.width), Number(window.contentView.bounds.size.height));
        var cardFrame = layout.card, versionFrame = layout.version;
        aboutCard(window.contentView, $.NSMakeRect(cardFrame[0], cardFrame[1], cardFrame[2], cardFrame[3]));
        darkPanel(window.contentView, $.NSMakeRect(versionFrame[0], versionFrame[1], versionFrame[2], versionFrame[3]), 0.4, 14);
        function overlay(text, y, height, size, bold) {
            var label = $.NSTextField.labelWithString($(text));
            label.frame = text === VERSION ? $.NSMakeRect(versionFrame[0] + 8, versionFrame[1] + 2, versionFrame[2] - 16, 20) :
                $.NSMakeRect(cardFrame[0] + 20, cardFrame[1] + y, cardFrame[2] - 40, height);
            label.alignment = text === VERSION ? $.NSTextAlignmentRight : $.NSTextAlignmentCenter;
            label.font = bold ? $.NSFont.boldSystemFontOfSize(size) : $.NSFont.systemFontOfSize(size);
            label.textColor = $.NSColor.whiteColor;
            window.contentView.addSubview(label);
        }
        overlay('kasholkaTTS', 110, 48, 38, true);
        overlay('coded by gpt-6 astra (vs code + codex)', 61, 24, 15, false);
        overlay('prompting by strch', 33, 24, 15, false);
        overlay(VERSION, 0, 20, 11, false);
        about = { window: window };
        window.center;
    }
    about.window.makeKeyAndOrderFront(null);
    startAboutVideo();
}

function installMenus() {
    var menu = $.NSMenu.alloc.init;
    var appItem = $.NSMenuItem.alloc.init;
    var appMenu = $.NSMenu.alloc.initWithTitle($('kasholkaTTS'));
    var aboutItem = appMenu.addItemWithTitleActionKeyEquivalent($(t('О kasholkaTTS')), 'about:', $(''));
    aboutItem.target = controller;
    if (typeof installLanguageMenu === 'function') installLanguageMenu(appMenu);
    if (typeof installUpdateMenu === 'function') installUpdateMenu(appMenu);
    appMenu.addItem($.NSMenuItem.separatorItem);
    appMenu.addItemWithTitleActionKeyEquivalent($(t('Скрыть kasholkaTTS')), 'hide:', $('h'));
    var quitItem = appMenu.addItemWithTitleActionKeyEquivalent($(t('Завершить kasholkaTTS')), 'quitApp:', $('q'));
    quitItem.target = controller;
    appItem.submenu = appMenu;
    menu.addItem(appItem);
    var fileItem = $.NSMenuItem.alloc.init;
    var fileMenu = $.NSMenu.alloc.initWithTitle($(t('Файл')));
    fileMenu.autoenablesItems = false;
    var openItem = fileMenu.addItemWithTitleActionKeyEquivalent($(t('Открыть текст…')), 'openText:', $('o'));
    openItem.target = controller;
    ui.exportItem = fileMenu.addItemWithTitleActionKeyEquivalent($(t('Сохранить речь в аудиофайл…')), 'exportAudio:', $('s'));
    ui.exportItem.target = controller;
    fileItem.submenu = fileMenu;
    menu.addItem(fileItem);
    var editItem = $.NSMenuItem.alloc.init;
    var editMenu = $.NSMenu.alloc.initWithTitle($(t('Правка')));
    [[t('Отменить'), 'undo:', 'z'], [t('Вырезать'), 'cut:', 'x'], [t('Копировать'), 'copy:', 'c'],
        [t('Вставить'), 'paste:', 'v'], [t('Выделить всё'), 'selectAll:', 'a']].forEach(function (entry) {
        editMenu.addItemWithTitleActionKeyEquivalent($(entry[0]), entry[1], $(entry[2]));
    });
    editItem.submenu = editMenu;
    menu.addItem(editItem);
    var viewItem = $.NSMenuItem.alloc.init;
    var viewMenu = $.NSMenu.alloc.initWithTitle($(t('Вид')));
    ui.autoScrollItem = viewMenu.addItemWithTitleActionKeyEquivalent($(t('Автопрокрутка при чтении')), 'autoScroll:', $(''));
    ui.autoScrollItem.target = controller;
    ui.autoScrollItem.state = autoScroll ? 1 : 0;
    viewMenu.addItem($.NSMenuItem.separatorItem);
    [[t('Увеличить масштаб'), 'zoomIn:', '='], [t('Уменьшить масштаб'), 'zoomOut:', '-'],
        [t('Масштаб 100%'), 'zoomReset:', '0']].forEach(function (entry) {
        var item = viewMenu.addItemWithTitleActionKeyEquivalent($(entry[0]), entry[1], $(entry[2]));
        item.target = controller;
    });
    viewItem.submenu = viewMenu;
    menu.addItem(viewItem);
    var debugItem = $.NSMenuItem.alloc.init;
    var debugMenu = $.NSMenu.alloc.initWithTitle($(t('Дебаг')));
    [[t('Поиск голосов Siri'), 'searchSiri:'], [t('Высота голоса…'), 'debugPitch:'],
        [t('Диагностика голосов…'), 'voiceDiagnostics:'], [t('Диагностика подсветки…'), 'wordDiagnostics:']].forEach(function (entry) {
        var item = debugMenu.addItemWithTitleActionKeyEquivalent($(entry[0]), entry[1], $(''));
        item.target = controller;
    });
    debugItem.submenu = debugMenu;
    menu.addItem(debugItem);
    $.NSApplication.sharedApplication.mainMenu = menu;
}

function setStartupStage(text) {
    startup.label.stringValue = $(text);
}

function closeStartup() {
    if (!startup) return;
    var current = startup;
    startup = null;
    if (current.timer) current.timer.invalidate;
    if (current.window) current.window.orderOut(null);
}

function showStartup() {
    var window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 616, 393), $.NSWindowStyleMaskBorderless, $.NSBackingStoreBuffered, false);
    window.releasedWhenClosed = false;
    window.hasShadow = true;
    window.backgroundColor = $.NSColor.blackColor;
    var path = $.NSBundle.mainBundle.pathForResourceOfType($('loading'), $('png'));
    if (!path || path.isNil()) throw new Error(t('Не найден фон загрузки. Переустановите приложение из полного архива.'));
    var picture = $.NSImage.alloc.initWithContentsOfFile(path);
    if (!picture || picture.isNil()) throw new Error(t('Не удалось открыть фон загрузки.'));
    var imageView = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, 616, 393));
    imageView.image = picture;
    imageView.imageScaling = $.NSImageScaleAxesIndependently;
    window.contentView.addSubview(imageView);
    darkPanel(window.contentView, $.NSMakeRect(0, 0, 616, 64), 0.72, 0);
    var version = $.NSTextField.labelWithString($(VERSION));
    version.frame = $.NSMakeRect(20, 17, 190, 20);
    version.font = $.NSFont.systemFontOfSize(12);
    version.textColor = $.NSColor.whiteColor;
    window.contentView.addSubview(version);
    var label = $.NSTextField.labelWithString($(t('Подготовка интерфейса…')));
    label.frame = $.NSMakeRect(214, 17, 382, 20);
    label.alignment = $.NSTextAlignmentRight;
    label.font = $.NSFont.systemFontOfSize(12);
    label.textColor = $.NSColor.whiteColor;
    window.contentView.addSubview(label);
    startup = { window: window, label: label, stage: 0, shownAt: Date.now(), busy: false };
    window.center;
    window.orderFrontRegardless;
    startup.timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
        0.1, controller, 'startupTick:', null, true);
    $.NSRunLoop.mainRunLoop.addTimerForMode(startup.timer, $.NSRunLoopCommonModes);
}

function startupTick() {
    if (!startup || startup.busy) return;
    startup.busy = true;
    try {
        if (startup.stage === 0) {
            buildMainWindow();
            startup.stage = 1;
            setStartupStage(t('Загрузка системных голосов…'));
        } else if (startup.stage === 1) {
            refreshVoices();
            startup.stage = 2;
            setStartupStage(t('Применение настроек…'));
        } else if (startup.stage === 2) {
            setScale(clamp(unwrap(defaults.objectForKey($('uiScale')), 1), 0.8, 1.5, 1));
            ui.window.center;
            startup.stage = 3;
            setStartupStage(t('Готово'));
        } else if (Date.now() - startup.shownAt >= 1000) {
            ui.window.makeKeyAndOrderFront(null);
            ui.window.makeFirstResponder(ui.editor);
            closeStartup();
            if (typeof updateDidLaunch === 'function') updateDidLaunch();
        }
    } catch (error) {
        closeStartup();
        alertUser(t('Не удалось запустить kasholkaTTS'), String(error));
        terminateApp();
    } finally { if (startup) startup.busy = false; }
}

function run() {
    if (startup) { startup.window.orderFrontRegardless; return; }
    if (ui.window) { ui.window.makeKeyAndOrderFront(null); return; }
    defaults = $.NSUserDefaults.standardUserDefaults;
    if (typeof initLocalization === 'function') initLocalization();
    autoScroll = !!unwrap(defaults.objectForKey($('autoScroll')), true);
    ObjC.bindFunction('rmdir', ['int', ['char *']]);
    ObjC.bindFunction('rename', ['int', ['char *', 'char *']]);
    registerController();
    var app = $.NSApplication.sharedApplication;
    app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
    try { showStartup(); }
    catch (error) {
        closeStartup();
        alertUser(t('Не удалось запустить kasholkaTTS'), String(error));
        terminateApp();
        return;
    }
    app.activateIgnoringOtherApps(true);
}

function buildMainWindow() {
    var style = $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable |
        $.NSWindowStyleMaskMiniaturizable | $.NSWindowStyleMaskResizable;
    ui.window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 760, 500), style, $.NSBackingStoreBuffered, false);
    ui.window.title = $('kasholkaTTS');
    ui.window.contentMinSize = $.NSMakeSize(680, 400);
    ui.window.releasedWhenClosed = false;
    ui.window.delegate = controller;
    ui.content = ui.window.contentView;

    ui.voiceLabel = addLabel(t('Голос'), 13, false);
    ui.voice = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 500, 32), false);
    ui.voice.target = controller;
    ui.voice.action = 'voice:';
    ui.content.addSubview(ui.voice);
    ui.refresh = addButton(t('Обновить'), 'refresh:');
    ui.preview = addButton(t('Прослушать'), 'previewVoice:');
    ui.preview.toolTip = $(t('Короткая проба выбранного голоса с текущей скоростью. «Стоп» прерывает прослушивание.'));
    ui.rateLabel = addLabel(t('Скорость'), 13, false);
    ui.rate = addSlider(0, 1, clamp(unwrap(defaults.objectForKey($('speedPosition')), 0.5), 0, 1, 0.5),
        'rate:');
    ui.rate.toolTip = $(t('Слева медленнее, справа быстрее. Посередине — обычный темп. Применяется при новом чтении.'));
    ui.rateValue = addLabel('', 13, true);
    ui.textLabel = addLabel(t('ВАШ ТЕКСТ'), 12, true);
    ui.open = addButton(t('Открыть .txt…'), 'openText:');

    var scroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(16, 92, 728, 280));
    ui.scroll = scroll;
    scroll.borderType = $.NSBezelBorder;
    scroll.hasVerticalScroller = true;
    scroll.hasHorizontalScroller = false;
    scroll.autohidesScrollers = false;
    ui.editor = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, 820, 282));
    ui.editor.richText = false;
    ui.editor.allowsUndo = true;
    ui.editor.font = $.NSFont.systemFontOfSize(18);
    ui.editor.textColor = $.NSColor.textColor;
    ui.editor.backgroundColor = $.NSColor.textBackgroundColor;
    ui.editor.textContainerInset = $.NSMakeSize(16, 16);
    ui.editor.verticallyResizable = true;
    ui.editor.horizontallyResizable = false;
    ui.editor.minSize = $.NSMakeSize(0, 0);
    ui.editor.maxSize = $.NSMakeSize(1000000, 1000000);
    ui.editor.autoresizingMask = $.NSViewWidthSizable;
    ui.editor.textContainer.containerSize = $.NSMakeSize(820, 1000000);
    ui.editor.textContainer.widthTracksTextView = true;
    scroll.documentView = ui.editor;
    ui.content.addSubview(scroll);

    ui.play = addButton(t('Читать'), 'play:');
    ui.pause = addButton(t('Пауза'), 'pause:');
    ui.stop = addButton(t('Стоп'), 'stop:');
    ui.reset = addButton(t('Сброс параметров'), 'reset:');
    ui.status = addLabel(t('Загрузка голосов…'), 13, false);
    installMenus();
}

function reopen() {
    if (startup) { startup.window.orderFrontRegardless; return; }
    if (ui.window) ui.window.makeKeyAndOrderFront(null);
}

function idle() { return 30; }

function quit() {
    if (typeof updateWillQuit === 'function') updateWillQuit();
    closeStartup();
    if (about.player) about.player.pause;
    stopSynth();
    closeHosts();
    discardAudioExport();
}

function terminateApp() {
    quit();
    $.NSApplication.sharedApplication.terminate(null);
}
