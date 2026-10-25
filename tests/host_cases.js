// Executed with app_harness.js's basic bridge stubs and the REAL helper source.
// This exercises the IPC data and lifecycle, not the macOS speech implementation.
function hostFixture() {
    hostDirectory = '/private/tmp/test';
    hostSynth = hostUtterance = hostDelegate = null;
    hostDone = hostStarted = false;
    hostState = '';
    var fixture = { files: {}, ticks: 0, missing: false, cancel: false };
    fixture.files[hostDirectory + '/request.json'] = JSON.stringify({ id: 'com.apple.siri.test', text: 'Текст 😀', factor: 2 });
    fixture.files[hostDirectory + '/control.json'] = JSON.stringify({ time: Date.now(), command: 'play' });
    String.prototype.writeToFileAtomicallyEncodingError = function (path, atomic) {
        assert(atomic); fixture.files[path] = String(this); return true;
    };
    $.NSString = { stringWithContentsOfFileEncodingError: function (path) {
        if (!fixture.files[path]) return null;
        return { text: fixture.files[path], isNil: function () { return false; } };
    } };
    ObjC.unwrap = function (value) { return value && value.text !== undefined ? value.text : value; };
    $.KasholkaVoiceHostDelegate = { alloc: { init: {} } };
    $.AVSpeechSynthesisVoice = {
        speechVoices: { count: 1, objectAtIndex: function () {
            return { identifier: 'com.apple.siri.test', name: 'Voice 1', language: 'ru-RU' };
        } },
        voiceWithIdentifier: function (id) {
            assert(id === 'com.apple.siri.test');
            return fixture.missing ? null : { isNil: function () { return false; } };
        }
    };
    var nativeContinue = { paused: false,
        speakUtterance: function (utterance) { this.utterance = utterance; },
        stopSpeakingAtBoundary: function () { this.wasStopped = true; },
        pauseSpeakingAtBoundary: function (boundary) { assert(boundary === 0); this.paused = true; return true; }
    };
    Object.defineProperty(nativeContinue, 'continueSpeaking', { get: function () { this.paused = false; return true; } });
    $.AVSpeechSynthesizer = { alloc: { init: nativeContinue } };
    $.AVSpeechUtterance = { speechUtteranceWithString: function (text) { return { text: text, rate: 0.5, pitchMultiplier: 1 }; } };
    $.NSDate = { dateWithTimeIntervalSinceNow: function (interval) { assert(interval === 0.05); return interval; } };
    $.NSRunLoop = { currentRunLoop: { runUntilDate: function () {
        fixture.ticks++;
        if (fixture.ticks === 1) registered.methods['speechSynthesizer:didStartSpeechUtterance:'].implementation();
        if (fixture.ticks === 2) registered.methods[fixture.cancel ?
            'speechSynthesizer:didCancelSpeechUtterance:' : 'speechSynthesizer:didFinishSpeechUtterance:'].implementation();
        assert(fixture.ticks <= 2, 'Unexpected loop');
    } } };
    fixture.result = function () { return JSON.parse(fixture.files[hostDirectory + '/result.json']); };
    return fixture;
}

function hostCheck(name, test) {
    try { test(hostFixture()); testResults.push({ name: name, passed: true }); }
    catch (error) { testResults.push({ name: name, passed: false, error: String(error) }); }
}

hostCheck('Helper reports only the actual system inventory', function (fixture) {
    run(['list', hostDirectory]);
    var result = fixture.result();
    assert(result.state === 'voices' && result.voices.length === 1 && result.voices[0].id === 'com.apple.siri.test');
    assert(!hostSynth);
});

hostCheck('Helper reads Unicode request, applies rate, retains delegates and reports completion', function (fixture) {
    run(['speak', hostDirectory]);
    assert(fixture.result().state === 'finished' && fixture.ticks === 2);
    assert(hostUtterance.text === 'Текст 😀' && hostUtterance.rate === 1 && hostUtterance.pitchMultiplier === 1);
    assert(!registered.protocols && hostDelegate);
    assert(hostSynth.wasStopped && hostSynth.delegate === null);
});

hostCheck('Helper pause and resume report actual state and stale parent lease stops speech', function (fixture) {
    hostStart({ id: 'com.apple.siri.test', text: '`shell` $(text)', factor: 0.5 });
    assert(hostUtterance.rate === 0.25 && hostUtterance.text === '`shell` $(text)');
    hostStarted = true;
    hostControl({ command: 'pause', time: Date.now() });
    assert(fixture.result().state === 'paused');
    hostControl({ command: 'play', time: Date.now() });
    assert(fixture.result().state === 'speaking');
    var threw = false;
    try { hostControl({ command: 'play', time: Date.now() - 16000 }); } catch (error) { threw = true; }
    assert(threw);
});

hostCheck('Helper refuses a missing voice without speaking with another voice', function (fixture) {
    fixture.missing = true;
    run(['speak', hostDirectory]);
    assert(fixture.result().state === 'error' && !hostSynth);
});

hostCheck('Helper stops and reports error when parent stopped renewing its lease', function (fixture) {
    fixture.files[hostDirectory + '/control.json'] = JSON.stringify({ time: Date.now() - 16000, command: 'play' });
    run(['speak', hostDirectory]);
    assert(fixture.result().state === 'error' && hostSynth.wasStopped && fixture.ticks === 0);
});

hostCheck('System cancellation is an error, not successful completion', function (fixture) {
    fixture.cancel = true;
    run(['speak', hostDirectory]);
    assert(fixture.result().state === 'error' && hostSynth.wasStopped);
});

hostCheck('Helper reports word ranges with speech state without changing UTF-16 offsets', function (fixture) {
    hostStart({ id: 'com.apple.siri.test', text: '😀 test', factor: 1 });
    hostStarted = true;
    registered.methods['speechSynthesizer:willSpeakRangeOfSpeechString:utterance:'].implementation(
        hostSynth, { location: 3, length: 4 }, hostUtterance);
    hostControl({ command: 'play', time: Date.now() });
    assert(fixture.result().state === 'speaking' && fixture.result().range.location === 3);
    hostControl({ command: 'pause', time: Date.now() });
    assert(fixture.result().state === 'paused' && fixture.result().range.length === 4);
});

hostCheck('Helper applies explicit debug pitch and preserves natural pitch when absent', function () {
    hostStart({ id: 'com.apple.siri.test', text: 'Text', factor: 1, pitch: 1.5 });
    assert(hostUtterance.pitchMultiplier === 1.5);
    hostStart({ id: 'com.apple.siri.test', text: 'Text', factor: 1, pitch: 99 });
    assert(hostUtterance.pitchMultiplier === 2);
    hostStart({ id: 'com.apple.siri.test', text: 'Text', factor: 1 });
    assert(hostUtterance.pitchMultiplier === 1);
});
