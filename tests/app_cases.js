check('Regional menu separates UK, US, Scotland and known novelty voices without inventing Siri', function () {
    voices = [
        { id: 'com.apple.speech.synthesis.voice.Albert', name: 'Albert', locale: 'en_US', engine: 'ns' },
        { id: 'daniel', name: 'Daniel', locale: 'en_GB', engine: 'ns' },
        { id: 'fiona', name: 'Fiona', locale: 'en-scotland', engine: 'ns' },
        { id: 'alex', name: 'Alex', locale: 'en-US', engine: 'ns' }
    ];
    populateVoices('alex', false);
    var sections = ui.voice.items.filter(function (item) { return item.tag === -1 && !item.separator; });
    assert(sections.length === 4);
    assert(sections[0].title === 'Английский (Англо-шотландский)');
    assert(sections[1].title === 'Английский (Великобритания)');
    assert(sections[3].title === 'Английский (Соединённые Штаты Америки) — Забавные');
    assert(selectedVoice().id === 'alex');
    registerController();
    var daniel = voices.filter(function (voice) { return voice.id === 'daniel'; })[0];
    registered.methods['voice:'].implementation({ tag: voices.indexOf(daniel), isKindOfClass: function () { return true; } });
    assert(selectedVoice().id === 'daniel' && defaults.stringForKey('voice') === 'daniel');
    assert(ui.voice.items.filter(function (item) { return item.tag >= 0; }).every(function (item) {
        return !/^\d/.test(item.title) && item.title.indexOf(' · ') < 0 && item.title.indexOf('Siri') < 0;
    }));
    assert(!voiceGroup({id: 'another.Albert', name: 'Albert', locale: 'en_US'}).funny);
    assert(voiceGroup({locale: 'en_us'}).key === voiceGroup({locale: 'en-US'}).key);
});

function startupFixture(test) {
    var oldBuild = buildMainWindow, oldRefresh = refreshVoices, oldScale = setScale;
    var oldNow = Date.now, oldAlert = alertUser, oldTerminate = terminateApp;
    var fixture = { now: 0, built: 0, loaded: 0, scaled: 0, shown: 0, hidden: 0, cancelled: 0, errors: [] };
    var timer = {}, window = { orderOut: function () { fixture.hidden++; } };
    Object.defineProperty(timer, 'invalidate', { get: function () { fixture.cancelled++; } });
    Date.now = function () { return fixture.now; };
    buildMainWindow = function () {
        fixture.built++;
        ui.window = { makeKeyAndOrderFront: function () { fixture.shown++; }, makeFirstResponder: function () {} };
    };
    refreshVoices = function () { fixture.loaded++; if (fixture.fail) throw new Error('Voice failure'); };
    setScale = function () { fixture.scaled++; };
    alertUser = function (title, message) { fixture.errors.push(message); };
    terminateApp = function () { fixture.terminated = true; };
    startup = { window: window, timer: timer, label: {}, stage: 0, shownAt: 0, busy: false };
    try { test(fixture); }
    finally {
        buildMainWindow = oldBuild; refreshVoices = oldRefresh; setScale = oldScale;
        Date.now = oldNow; alertUser = oldAlert; terminateApp = oldTerminate; startup = null;
    }
}

check('Startup performs real stages, holds for one second and then releases its timer', function () {
    startupFixture(function (fixture) {
        startupTick(); assert(fixture.built === 1 && fixture.loaded === 0 && fixture.shown === 0);
        assert(startup.label.stringValue === 'Загрузка системных голосов…');
        startupTick(); assert(fixture.loaded === 1 && fixture.scaled === 0);
        startupTick(); assert(fixture.scaled === 1 && startup.label.stringValue === 'Готово');
        fixture.now = 999; startupTick(); assert(fixture.shown === 0);
        fixture.now = 1000; startupTick();
        assert(!startup && fixture.shown === 1 && fixture.hidden === 1 && fixture.cancelled === 1);
        startupTick(); assert(fixture.shown === 1);
    });
});

check('Slow startup does not add an extra second; cancellation and failure cannot reveal a partial window', function () {
    startupFixture(function (fixture) {
        startupTick(); fixture.now = 4000; startupTick(); startupTick(); startupTick();
        assert(fixture.shown === 1 && !startup);
    });
    startupFixture(function (fixture) {
        startupTick(); closeStartup(); startupTick();
        assert(!startup && fixture.loaded === 0 && fixture.shown === 0 && fixture.cancelled === 1);
    });
    startupFixture(function (fixture) {
        fixture.fail = true; startupTick(); startupTick();
        assert(!startup && fixture.terminated && fixture.errors[0].indexOf('Voice failure') >= 0);
        assert(fixture.shown === 0 && fixture.cancelled === 1);
    });
});

check('Regional sections normalize locale format, disable headings and preserve voice identity', function () {
    voices = [
        { id: 'en-b', name: 'Same', locale: 'en_GB', engine: 'ns' },
        { id: 'ru-b', name: 'Same', locale: 'ru-RU', engine: 'ns' },
        { id: 'en-a', name: 'Same', locale: 'en-US', engine: 'ns' },
        { id: 'ru-a', name: 'Same', locale: 'ru_RU', engine: 'ns' },
        { id: 'unknown', name: 'Unknown', locale: '', engine: 'ns' }
    ];
    populateVoices('en-b', false);
    var headings = ui.voice.items.filter(function (item) { return item.tag === -1 && !item.separator; });
    assert(headings.length === 4 && headings[0].title === 'Русский (Россия)');
    assert(headings[1].title === 'Английский (Великобритания)');
    assert(ui.voice.items.filter(function (item) { return item.separator; }).length === 3);
    assert(headings.every(function (item) { return !item.enabled; }));
    assert(ui.voice.menu.autoenablesItems === false && selectedVoice().id === 'en-b');
    var actual = ui.voice.items.filter(function (item) { return item.tag >= 0; });
    assert(actual.length === voices.length && actual.every(function (item) { return item.indentationLevel === 0; }));
    actual.forEach(function (item) {
        ui.voice.selectItemAtIndex(ui.voice.items.indexOf(item));
        selectVoice();
        assert(defaults.stringForKey('voice') === voices[item.tag].id);
        ui.editor.string = 'Test'; play();
        assert(active && synth.spoken === 'Test'); stop();
    });
    ui.voice.selectItemAtIndex(0);
    assert(selectedVoice() === undefined, 'A language heading must never resolve to a voice');
    assert(voiceLanguage({locale: 'en-scotland'}).code === 'en');
    assert(voiceLanguage({locale: 'zz-ZZ'}).name === 'Язык: zz');
});

check('Grouped menu keeps Siri, per-voice pitch and the restored 1.4.2 Yuri engine', function () {
    voices = [
        { id: 'com.apple.speech.synthesis.voice.yuri.premium', name: 'Yuri', locale: 'ru_RU', engine: 'ns' },
        { id: 'com.apple.siri.test', name: 'Voice 1', locale: 'en_US', engine: 'av' }
    ];
    populateVoices(voices[0].id, false);
    assert(engine === 'ns' && selectedVoice().name === 'Yuri');
    setDebugPitch(3);
    assert(selectedPitchOffset() === 3);
    var siriIndex = ui.voice.items.map(function (item) { return item.title; }).join('|');
    assert(siriIndex.indexOf('[Siri] Voice 1') !== -1);
    populateVoices('av:com.apple.siri.test', false);
    assert(engine === 'av' && selectedVoice().id === 'com.apple.siri.test' && selectedPitchOffset() === 0);
    populateVoices('com.apple.speech.synthesis.voice.yuri.premium', false);
    assert(selectedPitchOffset() === 3 && engine === 'ns');
});

check('Highlight diagnostics are opt-in and retain raw, displayed and callback text separately', function () {
    ui.editor.string = 'До чтения, подсветки';
    ui.editor.selectedRange = $.NSMakeRange(3, ui.editor.string.length - 3);
    registerController(); play();
    var callback = registered.methods['speechSynthesizer:willSpeakWord:ofString:'].implementation;
    callback(synth, $.NSMakeRange(1, 6), 'чтения, подсветки');
    assert(!wordDiagnostics.header && wordDiagnostics.events.length === 0);
    stop(); armWordDiagnostics(); play();
    callback(synth, $.NSMakeRange(1, 6), 'чтения, подсветки');
    var report = JSON.parse(wordDiagnosticText());
    assert(report.header.offset === 3 && report.header.voice === 'voice-1');
    assert(report.events[0].spoken.marked === 'тения,');
    assert(report.events[0].callbackEqualsSpoken && report.events[0].callback.marked === 'тения,');
    assert(report.events[0].editorDisplay.marked === 'чтения');
    callback(synth, $.NSMakeRange(0, 3), 'Иной текст');
    callback(synth, $.NSMakeRange(999, 3), 'чтения, подсветки');
    assert(!wordDiagnostics.events[1].callbackEqualsSpoken);
    assert(wordDiagnostics.events[2].outcome === 'invalid-range');
    stop();
    assert(wordDiagnostics.events.length === 3 && !wordDiagnostics.recording);
    play(); callback(synth, $.NSMakeRange(0, 6), 'чтения, подсветки');
    assert(wordDiagnostics.events.length === 3, 'Must capture only the explicitly armed run');
});

check('Highlight diagnostics cap events, reject arming during reading and clear on new capture', function () {
    ui.editor.string = 'чтения, подсветки';
    registerController(); armWordDiagnostics(); play();
    var callback = registered.methods['speechSynthesizer:willSpeakWord:ofString:'].implementation;
    for (var i = 0; i < 100; i++) callback(synth, $.NSMakeRange(0, 6), ui.editor.string);
    assert(wordDiagnostics.events.length === 80 && !wordDiagnostics.recording);
    armWordDiagnostics();
    assert(wordDiagnostics.events.length === 80 && !wordDiagnostics.armed);
    stop(); armWordDiagnostics();
    assert(wordDiagnostics.events.length === 0 && wordDiagnostics.armed && !wordDiagnostics.header);
});

check('Russian sample header selection corrects a one-character shifted word without swallowing its neighbour', function () {
    ui.editor.string = 'kasholkaTTS. Большой текст для проверки чтения, подсветки, прокрутки и сохранения аудио';
    var start = ui.editor.string.indexOf('Большой');
    ui.editor.selectedRange = $.NSMakeRange(start, ui.editor.string.length - start);
    registerController(); play();
    var callback = registered.methods['speechSynthesizer:willSpeakWord:ofString:'].implementation;
    var wordStart = ui.editor.string.indexOf('проверки');
    // Synthetic reproduction of the screenshot: "роверки ч" instead of "проверки".
    callback(synth, $.NSMakeRange(wordStart - start + 1, 9));
    assert(highlightedRange.location === wordStart && highlightedRange.length === 8);
    assert(ui.editor.string.substr(highlightedRange.location, highlightedRange.length) === 'проверки');
    var next = ui.editor.string.indexOf('чтения');
    callback(synth, $.NSMakeRange(next - start + 1, 6));
    assert(highlightedRange.location === next && highlightedRange.length === 6);
    assert(ui.editor.scrolled.location === next && reading.offset === start);
});

check('Word-edge correction handles left shifts, partial words, punctuation and valid multiword units', function () {
    var text = 'Для проверки чтения: двадцать один, по-русски, don’t, cafe\u0301.';
    var words = highlightWords(text);
    function actual(location, length) {
        var range = alignHighlightRange(words, location, length);
        return text.substr(range.location, range.length);
    }
    assert(actual(text.indexOf('проверки') - 1, 8) === 'проверки');
    assert(actual(text.indexOf('чтения') + 1, 3) === 'чтения');
    assert(actual(text.indexOf('двадцать'), 'двадцать один'.length) === 'двадцать один');
    assert(actual(text.indexOf('по-русски') + 1, 8) === 'по-русски');
    assert(actual(text.indexOf('don’t') + 1, 4) === 'don’t');
    assert(actual(text.indexOf('cafe'), 4) === 'cafe\u0301');
});

check('Word-edge correction preserves emoji, other scripts, selection edges and exact engine ranges', function () {
    var text = '😀 世界 тест';
    var words = highlightWords(text);
    [$.NSMakeRange(0, 2), $.NSMakeRange(3, 1), $.NSMakeRange(6, 4)].forEach(function (range) {
        var result = alignHighlightRange(words, range.location, range.length);
        assert(result.location === range.location && result.length === range.length);
    });
    ui.editor.string = 'предпроверка потом';
    ui.editor.selectedRange = $.NSMakeRange(4, 5); // Only "прове" was selected.
    play(); highlightWord($.NSMakeRange(1, 3));
    assert(highlightedRange.location === 4 && highlightedRange.length === 5);
    assert(highlightedRange.location + highlightedRange.length <= reading.offset + reading.length);
});

check('Word tracking uses UTF-16 selection offset, scrolls and restores selection after completion', function () {
    ui.editor.string = 'До 😀 первый второй конец';
    ui.editor.selectedRange = $.NSMakeRange(3, 16);
    registerController();
    play();
    var callback = registered.methods['speechSynthesizer:willSpeakWord:ofString:'].implementation;
    callback(synth, $.NSMakeRange(3, 6));
    assert(highlightedRange.location === 6 && highlightedRange.length === 6);
    assert(ui.editor.scrolled.location === 6 && ui.editor.selectedRange.length === 0);
    callback(synth, $.NSMakeRange(10, 6));
    assert(highlightedRange.location === 13 && ui.editor.layoutManager.removed.length === 2);
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, true);
    assert(!reading && !highlightedRange && ui.editor.selectedRange.length === 16);
    play();
    assert(synth.spoken === '😀 первый второй', 'Repeated reading lost the original selected fragment');
});

check('Invalid ranges and old callbacks cannot highlight new speech; pause holds the word', function () {
    ui.editor.string = 'one two three';
    registerController(); play();
    var old = synth;
    var callback = registered.methods['speechSynthesizer:willSpeakWord:ofString:'].implementation;
    callback(synth, $.NSMakeRange(0, 3));
    pauseOrResume();
    callback(synth, $.NSMakeRange(4, 3));
    assert(highlightedRange.location === 0);
    pauseOrResume();
    [-1, NaN, Infinity, 999, 0.5].forEach(function (offset) { callback(synth, $.NSMakeRange(offset, 3)); });
    assert(highlightedRange.location === 0);
    stop(); play();
    callback(old, $.NSMakeRange(4, 3));
    assert(!highlightedRange);
    callback(synth, $.NSMakeRange(4, 3));
    assert(highlightedRange.location === 4);
});

check('Disabling autoscroll preserves highlighting and manual reading position', function () {
    ui.editor.string = 'one two';
    play();
    toggleAutoScroll();
    highlightWord($.NSMakeRange(4, 3));
    assert(highlightedRange.location === 4 && !ui.editor.scrolled);
    assert(defaults.objectForKey('autoScroll') === false);
    toggleAutoScroll();
    assert(ui.editor.scrolled.location === 4);
    ui.editor.setSelectedRange($.NSMakeRange(2, 0));
    stop();
    assert(ui.editor.selectedRange.location === 2, 'Stop should not discard a manually moved cursor');
});

check('AV word callback rejects stale utterances', function () {
    voices[0].engine = 'av';
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    ui.editor.string = 'one two';
    registerController(); play();
    var callback = registered.methods['speechSynthesizer:willSpeakRangeOfSpeechString:utterance:'].implementation;
    callback(synth, $.NSMakeRange(0, 3), { isEqual: function () { return false; } });
    assert(!highlightedRange);
    callback(synth, $.NSMakeRange(4, 3), currentUtterance);
    assert(highlightedRange.location === 4);
    finishAV(synth, currentUtterance, true);
    assert(!highlightedRange && !reading);
});

function setupExportFixture() {
    var fixture = setupHostFixture();
    fixture.choice = 5; // Preserve coverage of the original AIFF/CAF route.
    var popup = { addItemWithTitle: function () {}, selectItemAtIndex: function (index) {
        this.indexOfSelectedItem = index;
    } };
    $.NSPopUpButton = { alloc: { initWithFramePullsDown: function () { return popup; } } };
    var dialog = { addButtonWithTitle: function () {} };
    Object.defineProperty(dialog, 'runModal', { get: function () {
        popup.indexOfSelectedItem = fixture.choice; return fixture.cancelOptions ? 1001 : 1000;
    } });
    $.NSAlert = { alloc: { init: dialog } };
    fixture.destination = '/Users/test/Текст с пробелом.aiff';
    fixture.files[fixture.destination] = 'original audio';
    $.NSModalResponseOK = 1;
    $.NSSavePanel = { savePanel: { runModal: 1, URL: { path: fixture.destination,
        URLByDeletingLastPathComponent: { path: '/Users/test' } } } };
    $.NSURL = { fileURLWithPath: function (path) { return path; } };
    $.NSFileSize = 'size';
    $.NSFileManager.defaultManager.attributesOfItemAtPathError = function (path) {
        return { isNil: function () { return false; }, objectForKey: function () { return fixture.files[path] ? 100 : 0; } };
    };
    $.rename = function (from, to) {
        fixture.renames = (fixture.renames || 0) + 1;
        if (fixture.renameFails) return -1;
        fixture.files[to] = fixture.files[from]; delete fixture.files[from]; return 0;
    };
    $.NSSpeechSynthesizer.alloc.initWithVoice = function () {
        var value = fakeSynth(48);
        value.startSpeakingStringToURL = function (text, path) {
            value.spoken = text; value.output = path;
            if (fixture.startFails) return false;
            fixture.files[path] = 'new audio'; return true;
        };
        return value;
    };
    ui.editor.string = 'До 😀 тест после';
    ui.editor.selectedRange = $.NSMakeRange(3, 7);
    return fixture;
}

check('NS export uses selected text and settings, publishes only after successful finish', function () {
    var fixture = setupExportFixture();
    registerController();
    ui.rate.doubleValue = 1;
    exportAudio();
    assert(active && audioExport && !ui.pause.enabled && !ui.exportItem.enabled && ui.stop.enabled);
    assert(synth.spoken === '😀 тест' && synth.rate === 360);
    assert(fixture.files[fixture.destination] === 'original audio' && !fixture.renames);
    assert($.NSSavePanel.savePanel.allowedFileTypes[0] === 'aiff');
    highlightWord($.NSMakeRange(0, 2)); assert(!highlightedRange);
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, true);
    assert(!active && !audioExport && fixture.renames === 1);
    assert(fixture.files[fixture.destination] === 'new audio' && ui.exportItem.enabled);
});

check('Preview uses selected voice and settings without changing text, selection or armed diagnostics', function () {
    registerController();
    ui.editor.string = 'Личный текст';
    ui.editor.selectedRange = $.NSMakeRange(3, 5);
    ui.rate.doubleValue = 1;
    debugPitchOffsets['voice-1'] = 3;
    armWordDiagnostics();
    previewVoice();
    assert(active && !reading && !ui.preview.enabled && synth.spoken === voicePreviewText('ru_RU'));
    assert(synth.rate === 360 && synth.base === 51);
    highlightWord($.NSMakeRange(0, 6)); assert(!highlightedRange);
    assert(wordDiagnostics.armed && !wordDiagnostics.recording);
    assert(ui.editor.string === 'Личный текст' && ui.editor.selectedRange.location === 3 && ui.editor.selectedRange.length === 5);
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, true);
    assert(!active && ui.preview.enabled);
    ui.editor.string = '';
    previewVoice(); assert(active); stop(); assert(!active && !reading);
});

check('Preview uses AV and helper voices and ignores duplicate requests during speech', function () {
    var fixture = setupHostFixture();
    voices[0].engine = 'av'; voices[0].locale = 'en-GB'; selectVoice();
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    previewVoice();
    assert(currentUtterance.text === voicePreviewText('en_US') && !reading);
    var utterance = currentUtterance;
    previewVoice(); assert(currentUtterance === utterance);
    finishAV(synth, utterance, true);
    voices[0].engine = 'host'; selectVoice(); previewVoice();
    var job = hostSpeech, request = fixture.files[job.directory + '/request.json'];
    assert(request.text === voicePreviewText('en_GB') && request.id === 'voice-1');
    fixture.reply(job, {state: 'speaking', range: {location: 0, length: 5}});
    hostTick(); assert(!highlightedRange && !reading);
    stop(); assert(job.task.stopped && !active && ui.preview.enabled);
});

check('M4A and WAV publish only after conversion succeeds, preserving filename arguments', function () {
    [0, 1, 2, 3, 4].forEach(function (choice) {
        var fixture = setupExportFixture();
        fixture.choice = choice;
        exportAudio();
        assert(defaults.objectForKey('audioFormatChoice') === choice);
        var job = audioExport;
        finishAudioExport(true);
        assert(active && job.task.running && !ui.pause.enabled && !ui.preview.enabled);
        assert(job.task.launchPath === '/usr/bin/afconvert');
        assert(job.task.arguments.slice(-2)[0] === job.path && job.task.arguments.slice(-1)[0] === job.convertedPath);
        assert($.NSSavePanel.savePanel.allowedFileTypes[0] === (choice < 3 ? 'm4a' : 'wav'));
        exportTick(); assert(!fixture.renames);
        fixture.files[job.convertedPath] = 'converted audio'; job.task.running = false;
        exportTick();
        assert(!active && !audioExport && job.timer.invalidated);
        assert(fixture.renames === 1 && fixture.files[fixture.destination] === 'converted audio');
        assert(!fixture.files[job.path] && !fixture.files[job.convertedPath]);
    });
    var args = audioConversionArguments('wav', 24, '/tmp/текст $(test).aiff', '/tmp/quote\".wav');
    assert(args[3] === 'LEI24' && args[4] === '/tmp/текст $(test).aiff' && args[5] === '/tmp/quote\".wav');
});

check('Export options cancellation, conversion failure, missing output and Stop preserve old files', function () {
    var fixture = setupExportFixture();
    fixture.cancelOptions = true; exportAudio();
    assert(!active && !audioExport && !fixture.directories.length);
    fixture.cancelOptions = false; fixture.choice = 1;
    exportAudio(); finishAudioExport(true);
    var job = audioExport;
    fixture.files[job.convertedPath] = 'partial'; stop();
    assert(job.task.stopped && job.timer.invalidated && !fixture.files[job.convertedPath]);
    exportTick(); assert(!fixture.renames && fixture.files[fixture.destination] === 'original audio');
    exportAudio(); finishAudioExport(true); job = audioExport;
    job.task.running = false; job.task.terminationStatus = 1;
    fixture.files[job.directory + '/convert.log'] = 'Unsupported audio'; exportTick();
    assert(!active && !audioExport && ui.status.stringValue.indexOf('Unsupported audio') >= 0);
    assert(!fixture.renames && fixture.files[fixture.destination] === 'original audio');
    exportAudio(); finishAudioExport(true); job = audioExport;
    job.task.running = false; exportTick();
    assert(!audioExport && !fixture.renames && job.timer.invalidated);
    exportAudio(); fixture.launchFails = true; finishAudioExport(true);
    assert(!audioExport && !active && ui.exportItem.enabled && !fixture.renames);
    assert(fixture.files[fixture.destination] === 'original audio');
});

check('Swift export conversion waits for helper completion and preserves its selected voice', function () {
    var fixture = setupExportFixture(); fixture.choice = 4;
    voices[0].engine = 'av'; selectVoice(); exportAudio();
    var host = hostSpeech, job = audioExport;
    assert(!job.task && fixture.files[host.directory + '/request.json'].id === 'voice-1');
    fixture.files[job.path] = 'source CAF';
    fixture.reply(host, {state: 'finished'}); hostTick();
    assert(!hostSpeech && active && job.task.running);
    fixture.files[job.convertedPath] = 'WAV'; job.task.running = false; exportTick();
    assert(!active && !audioExport && fixture.files[fixture.destination] === 'WAV');
});

check('Cancel panel, stop export and failed synthesis preserve existing destination', function () {
    var fixture = setupExportFixture();
    registerController();
    $.NSSavePanel.savePanel.runModal = 0;
    exportAudio(); assert(!active && !audioExport && fixture.directories.length === 0);
    $.NSSavePanel.savePanel.runModal = 1;
    exportAudio();
    var old = synth, temporary = audioExport.path;
    stop();
    assert(!audioExport && !active && !fixture.files[temporary] && old.wasStopped);
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(old, true);
    assert(!fixture.renames && fixture.files[fixture.destination] === 'original audio');
    exportAudio();
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, false);
    assert(!active && !audioExport && !fixture.renames);
    fixture.startFails = true;
    var threw = false;
    try { exportAudio(); } catch (error) { threw = true; }
    assert(threw && !active && !audioExport && ui.exportItem.enabled);
});

check('Failed publish and empty output never report successful export', function () {
    var fixture = setupExportFixture();
    registerController(); exportAudio();
    fixture.renameFails = true;
    finishAudioExport(true);
    assert(fixture.files[fixture.destination] === 'original audio' && !audioExport);
    assert(ui.status.stringValue.indexOf('Аудио сохранено:') < 0);
    fixture.renameFails = false;
    exportAudio(); delete fixture.files[audioExport.path];
    finishAudioExport(true);
    assert(fixture.renames === 1 && !active && !audioExport);
});

check('AV export runs Swift in background and stop terminates its owned task', function () {
    var fixture = setupExportFixture();
    voices[0].engine = 'av'; selectVoice();
    exportAudio();
    assert(hostSpeech.backend === 'swift' && hostSpeech.mode === 'export');
    assert($.NSSavePanel.savePanel.allowedFileTypes[0] === 'caf');
    var job = hostSpeech, request = fixture.files[job.directory + '/request.json'];
    assert(request.output === audioExport.path && request.text === '😀 тест');
    fixture.reply(job, { state: 'exporting' });
    hostTick(); assert(job.ready && active);
    stop(); assert(job.task.stopped && !hostSpeech && !audioExport);
    assert(fixture.files[fixture.destination] === 'original audio');
    exportAudio();
    fixture.files[audioExport.path] = 'new audio';
    fixture.reply(hostSpeech, { state: 'finished' });
    hostTick(); assert(!active && !audioExport && fixture.files[fixture.destination] === 'new audio');
});

check('Helper speech forwards UTF-16 progress and clears highlighting on failure', function () {
    var fixture = setupHostFixture();
    voices[0].engine = 'host';
    ui.editor.string = 'one two'; play();
    fixture.reply(hostSpeech, { state: 'speaking', range: { location: 4, length: 3 } });
    hostTick(); assert(highlightedRange.location === 4);
    fixture.reply(hostSpeech, { state: 'error', message: 'failed' });
    hostTick(); assert(!active && !highlightedRange && !reading);
});

check('Controller works when JXA cannot resolve delegate protocols', function () {
    var originalRegister = ObjC.registerSubclass;
    var originalApplication = $.NSApplication;
    try {
        ObjC.registerSubclass = function (definition) {
            if (definition.protocols && definition.protocols.length) {
                throw new Error('protocol does not exist');
            }
            registered = definition;
        };
        var terminated = false;
        $.NSApplication = { sharedApplication: { terminate: function () { terminated = true; } } };
        registerController();
        assert(controller);
        var finished = registered.methods['speechSynthesizer:didFinishSpeaking:'];
        assert(finished.types[0] === 'void' && finished.types[1].join(',') === 'id,bool');
        active = true;
        finished.implementation(synth, true);
        assert(!active && ui.play.enabled);
        registered.methods['windowWillClose:'].implementation(null);
        assert(synth.wasStopped && synth.delegate === null && terminated);
    } finally {
        ObjC.registerSubclass = originalRegister;
        $.NSApplication = originalApplication;
    }
});

check('UTF-16 selection handles Cyrillic and emoji', function () {
    assert(textToRead('А😀Б test', 1, 2) === '😀');
    assert(textToRead('Текст', 2, 0) === 'Текст');
});

check('Empty text and whitespace selection never start speech', function () {
    ui.editor.string = '   \n';
    play();
    assert(!active && synth.spoken === '');
    ui.editor.string = 'Привет   мир';
    ui.editor.selectedRange = { location: 6, length: 3 };
    play();
    assert(!active && synth.spoken === '');
});

check('Speech reads selection and locks settings until finished', function () {
    ui.editor.string = 'Привет, мир!';
    ui.editor.selectedRange = { location: 8, length: 3 };
    play();
    assert(synth.spoken === 'мир' && active);
    assert(!ui.voice.enabled && !ui.rate.enabled && !ui.editor.editable && ui.stop.enabled);
    registerController();
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, true);
    assert(!active && ui.play.enabled && ui.editor.editable && ui.status.stringValue === 'Прочитано');
});

check('Pause, resume, stop and restart do not retain old completion callbacks', function () {
    ui.editor.string = 'Long text';
    registerController();
    play();
    pauseOrResume();
    assert(paused && synth.wasPaused && ui.pause.title === 'Продолжить');
    pauseOrResume();
    assert(!paused && synth.wasContinued);
    var old = synth;
    stop();
    assert(!active && old.wasStopped && old.delegate === null);
    play();
    registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(old, false);
    assert(active, 'Stale completion interrupted a new utterance');
});

check('Failed speech start releases controls', function () {
    $.NSSpeechSynthesizer.alloc.initWithVoice = function () {
        var instance = fakeSynth(48); instance.startOK = false; return instance;
    };
    ui.editor.string = 'Text';
    play();
    assert(!active && ui.play.enabled && !ui.stop.enabled);
});

check('An exception starting speech does not leave controls locked', function () {
    $.NSSpeechSynthesizer.alloc.initWithVoice = function () {
        var instance = fakeSynth(48);
        instance.startSpeakingString = function () { throw new Error('Unavailable engine'); };
        return instance;
    };
    ui.editor.string = 'Text';
    var threw = false;
    try { play(); } catch (error) { threw = true; }
    assert(threw && !active && ui.play.enabled && !ui.stop.enabled);
});

check('Speed settings are bounded and reset returns the knob to the center', function () {
    ui.rate.doubleValue = 10000;
    applyRate();
    assert(defaults.objectForKey('speedPosition') === 1);
    ui.rate.doubleValue = NaN;
    applyRate();
    assert(defaults.objectForKey('speedPosition') === 0.5);
    reset();
    assert(ui.rate.doubleValue === 0.5 && speedFactor(0.5) === 1);
});

check('Empty voice list clears old synthesizer and disables playback', function () {
    refreshVoices();
    assert(voices.length === 0 && synth === null && !ui.play.enabled);
});

check('Duplicate voice names remain individually selectable', function () {
    $.NSSpeechSynthesizer.availableVoices = {
        count: 2, objectAtIndex: function (index) { return 'voice-' + (index + 1); }
    };
    defaults.setObjectForKey('voice-2', 'voice');
    refreshVoices();
    assert(voices.length === 2 && ui.voice.titles.length === 3);
    assert(ui.voice.titles[1] === ui.voice.titles[2]);
    assert(ui.voice.items[1].tag !== ui.voice.items[2].tag);
    assert(ui.voice.indexOfSelectedItem === 2);
});

check('Unavailable selected voice disables playback without crashing', function () {
    $.NSSpeechSynthesizer.alloc.initWithVoice = function () { return null; };
    selectVoice();
    assert(synth === null && !ui.play.enabled);
});

check('AVFoundation adds actual Siri voices and avoids duplicate identifiers', function () {
    $.NSSpeechSynthesizer.availableVoices = { count: 1, objectAtIndex: function () { return 'voice-1'; } };
    var av = [{ identifier: 'voice-1', name: 'Existing', language: 'ru-RU' },
        { identifier: 'com.apple.siri.test', name: 'Voice 1', language: 'ru-RU' }];
    $.AVSpeechSynthesisVoice.speechVoices = { count: 2, objectAtIndex: function (i) { return av[i]; } };
    defaults.setObjectForKey('av:com.apple.siri.test', 'voice');
    refreshVoices();
    assert(voices.length === 2 && engine === 'av');
    assert(ui.voice.titles.join('|').indexOf('Siri') !== -1);
    assert(ui.voice.titles.join('|').indexOf('[Siri] Voice 1') !== -1);
});

check('AV reading honors selection and new speed while leaving pitch natural', function () {
    voices = [{ id: 'modern', name: 'Modern', engine: 'av' }];
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    registerController();
    selectVoice();
    ui.editor.string = 'One two';
    ui.editor.selectedRange = { location: 4, length: 3 };
    ui.rate.doubleValue = 1;
    play();
    assert(active && synth.utterance.text === 'two');
    assert(synth.utterance.rate === 1 && synth.utterance.pitchMultiplier === 1);
    pauseOrResume();
    assert(paused && synth.wasPaused);
    pauseOrResume();
    assert(!paused && synth.wasContinued);
    registered.methods['speechSynthesizer:didFinishSpeechUtterance:'].implementation(synth, synth.utterance);
    assert(!active && ui.play.enabled && currentUtterance === null);
});

check('AV pause rejection preserves state; old cancel cannot stop a new reading', function () {
    voices = [{ id: 'modern', name: 'Modern', engine: 'av' }];
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    registerController();
    selectVoice();
    ui.editor.string = 'Text';
    play();
    synth.allowPause = false;
    pauseOrResume();
    assert(!paused);
    var oldSynth = synth, oldUtterance = currentUtterance;
    stop();
    assert(oldSynth.wasStopped && oldSynth.delegate === null);
    play();
    registered.methods['speechSynthesizer:didCancelSpeechUtterance:'].implementation(oldSynth, oldUtterance);
    assert(active);
    registered.methods['speechSynthesizer:didCancelSpeechUtterance:'].implementation(synth, currentUtterance);
    assert(!active && ui.editor.editable);
});

check('A removed AV voice fails without falling back to a different voice', function () {
    voices = [{ id: 'missing', name: 'Missing', engine: 'av' }];
    selectVoice();
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return null; };
    ui.editor.string = 'Text';
    var failed = false;
    try { play(); } catch (error) { failed = true; }
    assert(failed && !active && !currentUtterance && ui.play.enabled);
});

check('Old pitch preferences are ignored by both engines', function () {
    defaults.setDoubleForKey(150, 'pitch.voice-1');
    ui.editor.string = 'Text';
    play();
    assert(!synth.pitchWrites && synth.base === 48);
    stop();
    defaults.setDoubleForKey(1.8, 'pitch.av.modern');
    voices = [{ id: 'modern', name: 'Modern', engine: 'av' }];
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    selectVoice();
    play();
    assert(synth.utterance.pitchMultiplier === 1);
    assert(!ui.pitch && !ui.pitchLabel);
});

check('Closing About pauses video and leaves active speech running', function () {
    registerController();
    active = true;
    var wasPaused = false;
    about = { window: {}, player: {} };
    Object.defineProperty(about.player, 'pause', { get: function () { wasPaused = true; } });
    var notification = { object: { isEqual: function (window) { return window === about.window; } } };
    registered.methods['windowWillClose:'].implementation(notification);
    assert(wasPaused && active && !synth.wasStopped);
});

check('Compact layout stays inside the window at all supported scales', function () {
    [0.8, 1, 1.5].forEach(function (factor) {
        [[680, 400], [760, 500], [1200, 800]].forEach(function (dimensions) {
            var width = dimensions[0] * factor, height = dimensions[1] * factor;
            var frames = layoutFrames(width, height, factor);
            Object.keys(frames).forEach(function (key) {
                var r = frames[key];
                assert(r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0, key + ' invalid dimensions');
                assert(r[0] + r[2] <= width + 0.01 && r[1] + r[3] <= height + 0.01, key + ' outside window');
            });
            assert(frames.pause[0] + frames.pause[2] < frames.stop[0]);
            assert(frames.stop[0] + frames.stop[2] < frames.reset[0]);
            assert(frames.scroll[1] > frames.play[1] + frames.play[3]);
        });
    });
});

check('About loads runtime video classes when JXA AVQueuePlayer binding is absent', function () {
    var fixture = setupAboutFixture();
    assert($.AVQueuePlayer === undefined);
    showAbout();
    assert(fixture.loaded && fixture.shown && fixture.starts === 1);
    assert(about.player === fixture.player && about.player.muted && about.framework);
    assert(fixture.children[0] === about.background, 'Video must be below the text');
    assert(fixture.children[1].layer.cornerRadius === 20);
    assert(about.window.titlebarAppearsTransparent && about.window.movableByWindowBackground);
    var labels = fixture.children.filter(function (child) { return child.stringValue !== undefined; });
    assert(labels[0].stringValue === 'kasholkaTTS');
    assert(labels[1].stringValue === 'coded by gpt-6 astra (vs code + codex)');
    assert(labels[2].stringValue === 'prompting by strch');
    assert(labels[3].stringValue === VERSION);
    showAbout();
    assert(fixture.windows === 1 && fixture.starts === 2, 'Reopening must reuse the player');
});

check('Unavailable video class keeps About usable and retries on next open', function () {
    var fixture = setupAboutFixture();
    fixture.missing = 'AVQueuePlayer';
    active = true;
    showAbout();
    assert(fixture.shown && fixture.children.length === 6 && !about.player && active);
    assert(ui.status.stringValue.indexOf('AVQueuePlayer') !== -1);
    fixture.missing = '';
    showAbout();
    assert(fixture.windows === 1 && fixture.starts === 1 && about.player && active);
});

check('Video setup failure cleans up partial player without interrupting speech', function () {
    var fixture = setupAboutFixture();
    fixture.failLayer = true;
    active = true;
    showAbout();
    assert(fixture.shown && fixture.pauses === 1 && fixture.disabled === 1);
    assert(!about.player && fixture.starts === 0 && active && !synth.wasStopped);
    fixture.failLayer = false;
    showAbout();
    assert(about.player && fixture.starts === 1 && fixture.windows === 1);
});

check('Every new NS reading uses the latest knob value, even without an action event', function () {
    registerController();
    ui.editor.string = 'Repeated reading';
    var previous = synth;
    [0, 0.5, 1, 0.25, 0.9].forEach(function (position) {
        ui.rate.doubleValue = position;
        play();
        assert(synth !== previous && previous.delegate === null);
        assert(synth.rateWasSet && Math.abs(synth.rate - 180 * speedFactor(position)) < 0.001);
        assert(defaults.objectForKey('speedPosition') === position);
        registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, true);
        previous = synth;
    });
});

check('Every new AV reading sets its rate before enqueueing without rate accumulation', function () {
    registerController();
    voices = [{ id: 'modern', name: 'Modern', engine: 'av' }];
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    ui.editor.string = 'Repeated reading';
    selectVoice();
    var previous = synth;
    [0, 0.5, 1, 0.25, 0.9].forEach(function (position) {
        ui.rate.doubleValue = position;
        play();
        assert(synth !== previous && Math.abs(synth.utterance.rate - 0.5 * speedFactor(position)) < 0.001);
        registered.methods['speechSynthesizer:didFinishSpeechUtterance:'].implementation(synth, synth.utterance);
        previous = synth;
    });
});

check('Speed action never moves the knob and preserves the slowest saved value', function () {
    var position = 0.183421;
    Object.defineProperty(ui.rate, 'doubleValue', {
        get: function () { return position; },
        set: function () { throw new Error('Action changed the knob during dragging'); }
    });
    applyRate();
    assert(defaults.objectForKey('speedPosition') === position);
    position = 0;
    applyRate();
    assert(unwrap(defaults.objectForKey('speedPosition'), 0.5) === 0);
    assert(speedFactor(0) < speedFactor(0.5) && speedFactor(0.5) < speedFactor(1));
});

check('Siri recognition covers old identifiers and never invents unavailable voices', function () {
    assert(isSiriVoice({ id: 'com.apple.siri.natural.test', name: 'Voice 1' }));
    assert(isSiriVoice({ id: 'com.apple.ttsbundle.siri_female_ru-RU_compact', name: 'Voice 2' }));
    assert(isSiriVoice({ id: 'some.id', name: 'Siri (Russian)' }));
    assert(!isSiriVoice({ id: 'com.apple.voice.Katya', name: 'Katya' }));
    assert(!isSiriVoice({ id: 'com.example.sirius', name: 'Sirius' }));
    $.NSSpeechSynthesizer.availableVoices = { count: 1, objectAtIndex: function () { return 'voice-1'; } };
    refreshVoices();
    assert(voices.length === 1 && ui.voice.titles[1].indexOf('[Siri]') === -1);
    assert(ui.status.stringValue.indexOf('Siri') === -1, 'Normal refresh must not report a Siri search');
});

check('Additional Siri voices are enumerated even without a direct JXA speech binding', function () {
    var loaded = false;
    var bundle = { isNil: function () { return false; } };
    Object.defineProperty(bundle, 'load', { get: function () { loaded = true; return true; } });
    $.NSBundle = { bundleWithPath: function () { return bundle; } };
    delete $.AVSpeechSynthesisVoice;
    $.NSClassFromString = function (name) {
        assert(loaded && name === 'AVSpeechSynthesisVoice');
        return { speechVoices: { count: 1, objectAtIndex: function () {
            return { identifier: 'com.apple.ttsbundle.siri_female_test', name: 'Voice 1', language: 'ru-RU' };
        } } };
    };
    refreshVoices();
    assert(voices.length === 1 && engine === 'av' && avFoundationBundle === bundle);
    assert(ui.voice.titles[1].indexOf('[Siri] Voice 1') !== -1);
});

check('Host discovery is asynchronous, preserves preference and merges only real unique voices', function () {
    var fixture = setupHostFixture();
    $.NSSpeechSynthesizer.availableVoices = { count: 1, objectAtIndex: function () { return 'voice-1'; } };
    defaults.setObjectForKey('host:com.apple.siri.natural.test', 'voice');
    searchSiriVoices();
    assert(voiceProbe && ui.play.enabled && voices.length === 1);
    assert(defaults.stringForKey('voice') === 'host:com.apple.siri.natural.test');
    assert(fixture.tasks[0].launchPath === '/usr/bin/osascript' && fixture.permissions === 448);
    assert(fixture.tasks[0].arguments[2] === '/Applications/путь с пробелом/voice-host.js');
    fixture.reply(voiceProbe, { state: 'voices', voices: [
        { id: 'voice-1', name: 'Duplicate' }, { id: 'com.apple.siri.natural.test', name: 'Voice 1', locale: 'ru-RU' }
    ] });
    hostTick();
    assert(!voiceProbe && voices.length === 2 && engine === 'host');
    assert(ui.voice.titles.join('|').indexOf('[Siri] Voice 1') !== -1 && ui.play.enabled);
    assert(fixture.tasks[0].stopped && fixture.timers[0].invalidated);
});

check('Host inventory waits for active reading and does not steal a user selection', function () {
    var fixture = setupHostFixture();
    defaults.setObjectForKey('voice-1', 'voice');
    beginVoiceProbe();
    var current = synth;
    fixture.reply(voiceProbe, { state: 'voices', voices: [{ id: 'com.apple.siri.test', name: 'Siri', locale: 'en-US' }] });
    active = true;
    hostTick();
    assert(voices.length === 1 && synth === current && voiceProbe);
    active = false;
    hostTick();
    assert(voices.length === 2 && selectedVoice().id === 'voice-1');
});

check('Host receives selection and latest speed as JSON data; pause, finish and stop are isolated', function () {
    var fixture = setupHostFixture();
    voices = [{ id: 'com.apple.siri.test', name: 'Siri', engine: 'host' }];
    selectVoice();
    ui.editor.string = 'START `echo bad` $(bad) "Привет😀" END';
    ui.editor.selectedRange = { location: 6, length: 28 };
    ui.rate.doubleValue = 0.25;
    play();
    var old = hostSpeech;
    var request = fixture.files[old.directory + '/request.json'];
    assert(request.text === ui.editor.string.substr(6, 28) && request.factor === speedFactor(0.25));
    assert(old.task.arguments.length === 5 && old.task.arguments.indexOf(request.text) === -1);
    pauseOrResume();
    assert(old.command === 'pause' && !paused);
    fixture.reply(old, { state: 'paused' });
    hostTick();
    assert(paused && ui.pause.title === 'Продолжить');
    pauseOrResume();
    assert(old.command === 'play');
    fixture.reply(old, { state: 'speaking' });
    hostTick();
    assert(!paused && active);
    stop();
    assert(!hostSpeech && old.task.stopped && !active);
    assert(!fixture.files[old.directory + '/request.json']);
    ui.rate.doubleValue = 1;
    play();
    assert(hostSpeech.directory !== old.directory && active);
    assert(fixture.files[hostSpeech.directory + '/request.json'].factor === 2);
    fixture.reply(old, { state: 'finished' });
    hostTick();
    assert(active, 'An old job finished a newer reading');
    fixture.reply(hostSpeech, { state: 'finished' });
    hostTick();
    assert(!active && ui.play.enabled && !hostSpeech && !hostTimer);
});

check('Host timeout and process crash restore controls instead of hanging the UI', function () {
    var fixture = setupHostFixture();
    voices = [{ id: 'com.apple.siri.test', name: 'Siri', engine: 'host' }];
    selectVoice();
    ui.editor.string = 'Text';
    play();
    var task = hostSpeech.task;
    hostSpeech.deadline = Date.now() - 1;
    hostTick();
    assert(!active && !hostSpeech && task.stopped && ui.play.enabled);
    assert(ui.status.stringValue.indexOf('15 секунд') !== -1);
    play();
    hostSpeech.task.running = false;
    hostSpeech.task.terminationStatus = 1;
    hostTick();
    assert(!active && ui.play.enabled && ui.status.stringValue.indexOf('код 1') !== -1);
});

check('Helper-reported errors never fall back to a different voice', function () {
    var fixture = setupHostFixture();
    voices = [{ id: 'missing-siri', name: 'Siri', engine: 'host' }];
    selectVoice();
    ui.editor.string = 'Text';
    play();
    fixture.reply(hostSpeech, { state: 'error', message: 'Голос недоступен' });
    hostTick();
    assert(!active && engine === 'host' && ui.play.enabled);
    assert(ui.status.stringValue.indexOf('Голос недоступен') !== -1);
});

check('Repeated refresh removes vanished helper voices and stops only its own probe', function () {
    var fixture = setupHostFixture();
    beginVoiceProbe();
    var previous = voiceProbe;
    beginVoiceProbe();
    assert(previous.task.stopped && voiceProbe !== previous);
    addHostVoices([{ id: 'gone', name: 'Old voice' }]);
    fixture.reply(voiceProbe, { state: 'voices', voices: [] });
    hostTick();
    assert(voices.length === 1 && voices[0].id === 'voice-1' && !hostVoices.length);
});

check('Quitting stops both helper tasks, cancels timer and removes per-job text files', function () {
    var fixture = setupHostFixture();
    var terminated = false;
    $.NSApplication = { sharedApplication: { terminate: function () {
        assert(!hostSpeech && !voiceProbe, 'Application exited before stopping its helpers');
        terminated = true;
    } } };
    registerController();
    voices = [{ id: 'com.apple.siri.test', name: 'Siri', engine: 'host' }];
    selectVoice();
    beginVoiceProbe();
    ui.editor.string = 'Text';
    play();
    registered.methods['quitApp:'].implementation();
    assert(terminated);
    assert(!voiceProbe && !hostSpeech && !hostTimer);
    assert(fixture.tasks.every(function (task) { return task.stopped; }));
    assert(Object.keys(fixture.files).length === 0 && fixture.timers[0].invalidated);
});

check('Empty Siri inventory automatically tries Swift and restores a saved Swift voice', function () {
    var fixture = setupHostFixture();
    defaults.setObjectForKey('swift:com.apple.siri.ru-test', 'voice');
    beginVoiceProbe();
    fixture.reply(voiceProbe, { state: 'voices', voices: [] });
    hostTick();
    assert(voiceProbe && voiceProbe.backend === 'swift' && voiceProbe.timeout === 60);
    assert(voiceProbe.task.launchPath === '/bin/bash');
    assert(voiceProbe.task.arguments[0] === '/Applications/путь с пробелом/voice-host-swift.sh');
    fixture.reply(voiceProbe, { state: 'voices', voices: [
        { id: 'voice-1', name: 'Duplicate', locale: 'ru-RU' },
        { id: 'com.apple.siri.ru-test', name: 'Voice 1', locale: 'ru-RU' }
    ] });
    hostTick();
    assert(!voiceProbe && !hostTimer && voices.length === 2 && engine === 'host');
    var selected = selectedVoice();
    assert(selected.backend === 'swift' && voiceKey(selected) === defaults.stringForKey('voice'));
    ui.editor.string = 'Новый текст';
    ui.rate.doubleValue = 0;
    play();
    assert(hostSpeech.backend === 'swift');
    assert(fixture.files[hostSpeech.directory + '/request.json'].factor === 0.5);
    pauseOrResume();
    assert(hostSpeech.command === 'pause');
    stop();
    assert(!hostSpeech && !active);
});

check('Missing Swift tools are reported distinctly and preserve classic speech', function () {
    var fixture = setupHostFixture();
    beginVoiceProbe('swift');
    fixture.files[voiceProbe.directory + '/stderr.txt'] = 'Swift недоступен: нужны Command Line Tools';
    voiceProbe.task.running = false;
    voiceProbe.task.terminationStatus = 3;
    hostTick();
    assert(!voiceProbe && voices.length === 1 && synth && engine === 'ns');
    assert(voiceDiagnostics.swift.indexOf('Command Line Tools') !== -1);
    assert(ui.status.stringValue.indexOf('не завершена') !== -1);
    ui.editor.string = 'Обычный голос';
    play();
    assert(active && synth.spoken === 'Обычный голос');
});

check('Swift probe timeout is bounded and cancels the exact running task', function () {
    setupHostFixture();
    beginVoiceProbe('swift');
    var task = voiceProbe.task;
    voiceProbe.deadline = Date.now() - 1;
    hostTick();
    assert(task.stopped && !voiceProbe && !hostTimer);
    assert(voiceDiagnostics.swift.indexOf('60 секунд') !== -1);
});

check('A failed osascript probe still tries Swift and retains the first error', function () {
    var fixture = setupHostFixture();
    beginVoiceProbe();
    fixture.reply(voiceProbe, { state: 'error', message: 'Bridge failure' });
    hostTick();
    assert(voiceProbe.backend === 'swift' && voiceDiagnostics.osascript.indexOf('Bridge failure') !== -1);
    fixture.reply(voiceProbe, { state: 'voices', voices: [] });
    hostTick();
    assert(!voiceProbe && ui.status.stringValue.indexOf('Siri не найдены') !== -1);
});

check('Diagnostic report counts the six requested Siri voices and excludes reading text', function () {
    setupHostFixture();
    ui.editor.string = 'PRIVATE_TEXT_NOT_FOR_DIAGNOSTICS';
    var list = [];
    ['en-GB', 'en-US', 'ru_RU'].forEach(function (locale) {
        [1, 2].forEach(function (n) { list.push({ id: 'com.apple.siri.' + locale + n, name: 'Voice ' + n, locale: locale }); });
    });
    recordVoiceInventory('swift', list);
    var report = voiceDiagnosticText();
    assert(report.indexOf('12.6.5') !== -1 && report.indexOf('Siri: 6') !== -1);
    ['en-GB: 2', 'en-US: 2', 'ru-RU: 2'].forEach(function (count) { assert(report.indexOf(count) !== -1); });
    assert(report.indexOf('PRIVATE_TEXT') === -1);
    assert(report.indexOf('com.apple.siri.ru_RU2') !== -1);
});

check('About video covers every edge without distorting the bundled video', function () {
    [[440, 330], [880, 660], [600, 220]].forEach(function (size) {
        var frame = aboutVideoLayout(size[0], size[1]);
        assert(frame[0] <= 0 && frame[1] <= 0);
        assert(frame[0] + frame[2] >= size[0] && frame[1] + frame[3] >= size[1]);
        assert(Math.abs(frame[2] / frame[3] - 854 / 480) < 0.000001);
    });
    setupAboutFixture();
    showAbout();
    assert(about.window.contentView.layer.masksToBounds);
    assert(about.background.frame[0] < 0 && about.background.frame[1] === 0);
    assert(about.background.frame[2] > 440 && about.background.frame[3] === 330);
    assert(about.layer.frame[2] === about.background.frame[2]);
});

check('Normal startup inventory and refresh never launch helpers, even with a saved Swift voice', function () {
    var fixture = setupHostFixture();
    $.NSSpeechSynthesizer.availableVoices = { count: 1, objectAtIndex: function () { return 'voice-1'; } };
    defaults.setObjectForKey('swift:com.apple.siri.test', 'voice');
    refreshVoices();
    refreshVoices();
    assert(!voiceProbe && !hostTimer && fixture.tasks.length === 0 && ui.play.enabled);
    assert(ui.status.stringValue.indexOf('Siri') === -1);
    registerController();
    registered.methods['searchSiri:'].implementation();
    assert(voiceProbe && fixture.tasks.length === 1);
    registered.methods['searchSiri:'].implementation();
    assert(fixture.tasks.length === 1, 'Repeated menu click must not restart the search');
    active = true;
    registered.methods['searchSiri:'].implementation();
    assert(active && fixture.tasks.length === 1);
});

check('Normal refresh retains manual discovery and the diagnostic report', function () {
    setupHostFixture();
    hostVoices = [{ id: 'com.apple.siri.test', name: 'Voice 1', locale: 'ru-RU', backend: 'swift' }];
    recordVoiceInventory('swift', hostVoices);
    defaults.setObjectForKey('swift:com.apple.siri.test', 'voice');
    refreshVoices();
    assert(voices.length === 1 && engine === 'host' && !voiceProbe);
    assert(voiceInventories.swift.length === 1 && voiceDiagnostics.swift.indexOf('Siri: 1') !== -1);
});

check('Debug pitch is per voice, applied to fresh NS synths without accumulation, and resettable', function () {
    registerController();
    setDebugPitch(12);
    assert(synth.base === 48, 'Editing the setting must not mutate the current synthesizer');
    ui.editor.string = 'Text';
    [1, 2].forEach(function () {
        play();
        assert(synth.base === 60 && synth.pitchWrites === 1);
        registered.methods['speechSynthesizer:didFinishSpeaking:'].implementation(synth, true);
    });
    reset();
    play();
    assert(synth.base === 48 && !synth.pitchWrites);
    stop();
    setDebugPitch(-12);
    voices = [{ id: 'voice-2', name: 'Another' }];
    selectVoice();
    assert(selectedPitchOffset() === 0);
});

check('Unsupported NS pitch never commits a setting or disables normal playback', function () {
    $.NSSpeechSynthesizer.alloc.initWithVoice = function () {
        var value = fakeSynth(48); value.writable = false; return value;
    };
    var failed = false;
    try { setDebugPitch(5); } catch (error) { failed = true; }
    assert(failed && selectedPitchOffset() === 0);
    ui.editor.string = 'Text';
    play();
    assert(active && synth.spoken === 'Text' && !synth.pitchWrites);
});

check('Debug pitch reaches AV utterances and helper JSON with bounded octave shifts', function () {
    var fixture = setupHostFixture();
    voices = [{ id: 'modern', name: 'Modern', engine: 'av' }];
    $.AVSpeechSynthesisVoice.voiceWithIdentifier = function () { return { isNil: function () { return false; } }; };
    selectVoice();
    setDebugPitch(-100);
    ui.editor.string = 'Text';
    play();
    assert(synth.utterance.pitchMultiplier === 0.5);
    stop();
    voices = [{ id: 'helper', name: 'Helper', engine: 'host', backend: 'swift' }];
    selectVoice();
    setDebugPitch(100);
    play();
    assert(fixture.files[hostSpeech.directory + '/request.json'].pitch === 2);
});

JSON.stringify(testResults);
