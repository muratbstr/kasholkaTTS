function checkBeta(name, test) {
    check(name, function () {
        betaJob = null; betaMenuItems = []; betaReport = { probe: null, say: null };
        test();
    });
}

function betaFixture() {
    var fixture = setupHostFixture();
    var originalPath = $.NSBundle.mainBundle.pathForResourceOfType;
    $.NSBundle.mainBundle.pathForResourceOfType = function (name, ext) {
        return name === 'beta-probe' ? { nativeText: '/app Beta/beta-probe.js', isNil: function () { return false; } } : originalPath(name, ext);
    };
    var originalTimer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats;
    $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats = function (seconds, target, selector) {
        var timer = originalTimer(seconds, target, selector === 'betaTick:' ? 'hostTick:' : selector);
        return timer;
    };
    var originalDollar = $;
    $ = function (value) {
        if (value === fixture.text) return { writeToFileAtomicallyEncodingError: function (path) {
            fixture.files[path] = value; return !fixture.writeFails;
        } };
        return originalDollar(value);
    };
    Object.keys(originalDollar).forEach(function (key) { $[key] = originalDollar[key]; });
    fixture.restore = function () { $ = originalDollar; };
    $.NSAlert = { alloc: { init: { runModal: 1000, addButtonWithTitle: function () {} } } };
    return fixture;
}

checkBeta('Direct probe adds real Siri IDs, labels neither ordinary voices nor guessed names as Siri', function () {
    var fixture = betaFixture();
    try {
        betaProbe();
        assert(betaJob && active && !ui.play.enabled && ui.stop.enabled && !ui.pause.enabled);
        assert(betaJob.task.launchPath === '/usr/bin/osascript');
        var job = betaJob;
        fixture.files[job.directory + '/result.json'] = { state: 'voices', report: { attempts: [] }, voices: [
            { id: 'com.apple.siri.natural.Test', name: 'Siri test', locale: 'ru-RU' },
            { id: 'ordinary', name: 'Siri fake', locale: 'en-US' }
        ] };
        betaTick();
        assert(!betaJob && !active && job.timer.invalidated);
        var found = voices.filter(function (voice) { return voice.id === 'com.apple.siri.natural.Test'; });
        assert(found.length === 1 && found[0].engine === 'host' && found[0].backend === 'osascript');
        assert(!voices.some(function (voice) { return voice.id === 'ordinary'; }));
        refreshVoices();
        assert(voices.some(function (voice) { return voice.id === 'com.apple.siri.natural.Test'; }));
    } finally { fixture.restore(); }
});

checkBeta('Probe timeout, Stop and launch failure clean up only their own jobs', function () {
    var fixture = betaFixture();
    try {
        betaProbe(); var job = betaJob;
        job.deadline = 0; betaTick();
        assert(!active && !betaJob && job.task.stopped && job.timer.invalidated);
        assert(betaReport.probe.error.indexOf('20') >= 0);
        betaProbe(); job = betaJob; stop();
        assert(!betaJob && !active && job.task.stopped && betaReport.probe.state === 'cancelled');
        betaTick(); assert(!betaJob);
        fixture.launchFails = true;
        var threw = false;
        try { betaProbe(); } catch (error) { threw = true; }
        assert(threw && !active && !betaJob && betaReport.probe.error);
    } finally { fixture.restore(); }
});

checkBeta('say sends selected text by file, has no voice override, and never reports Siri success', function () {
    var fixture = betaFixture();
    try {
        fixture.text = '$(touch injected) "Привет"';
        ui.editor.string = 'before ' + fixture.text + ' after';
        ui.editor.selectedRange = $.NSMakeRange(7, fixture.text.length);
        betaSay(); var job = betaJob;
        assert(active && job.mode === 'say' && !reading && !ui.pause.enabled);
        assert(job.task.launchPath === '/usr/bin/say' && job.task.arguments.length === 2);
        assert(job.task.arguments[0] === '-f' && fixture.files[job.task.arguments[1]] === fixture.text);
        assert(ui.editor.selectedRange.location === 7 && ui.editor.selectedRange.length === fixture.text.length);
        job.task.running = false; betaTick();
        assert(!active && !betaJob && betaReport.say.identity.indexOf('unverified') >= 0);
        assert(JSON.stringify(betaReport).indexOf(fixture.text) < 0);
        betaSay(); job = betaJob; stop();
        assert(job.task.stopped && !fixture.files[job.directory + '/input.txt']);
        betaSay(); job = betaJob; job.task.running = false; job.task.terminationStatus = 1;
        fixture.files[job.directory + '/stderr.txt'] = fixture.text;
        betaTick(); assert(!active && !betaJob && betaReport.say.error);
        assert(JSON.stringify(betaReport).indexOf('touch injected') < 0);
    } finally { fixture.restore(); }
});

checkBeta('Busy app and cancelled dialog never start experiments or modify selection', function () {
    var fixture = betaFixture();
    try {
        fixture.text = ui.editor.string = 'Проба';
        active = true; betaProbe(); betaSay(); betaPrepareSelection();
        assert(!betaJob && !fixture.tasks.length);
        active = false; $.NSAlert.alloc.init.runModal = 1001;
        betaSay(); betaPrepareSelection();
        assert(!betaJob && !fixture.tasks.length && ui.editor.selectedRange.length === 0);
        $.NSAlert.alloc.init.runModal = 1000;
        fixture.writeFails = true;
        try { betaSay(); } catch (expected) {}
        assert(!active && !betaJob && ui.play.enabled);
    } finally { fixture.restore(); }
});

checkBeta('Spoken Content preparation retains existing selection or selects all and focuses editor', function () {
    var fixture = betaFixture(), focused = false;
    try {
        ui.window = { makeKeyAndOrderFront: function () {}, makeFirstResponder: function (view) { focused = view === ui.editor; } };
        ui.editor.string = 'Текст 😀 для Siri';
        betaPrepareSelection();
        assert(focused && ui.editor.selectedRange.length === ui.editor.string.length);
        ui.editor.selectedRange = $.NSMakeRange(6, 2);
        betaPrepareSelection();
        assert(ui.editor.selectedRange.location === 6 && ui.editor.selectedRange.length === 2);
        assert(!active && !betaJob && fixture.tasks.length === 0);
    } finally { fixture.restore(); }
});
