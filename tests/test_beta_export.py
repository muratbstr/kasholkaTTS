import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('beta_export_builder', ROOT / 'scripts/build_beta.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BetaExportTests(unittest.TestCase):
    def test_form_validation_and_real_export_lifecycle(self):
        fixture = (ROOT / 'tests/app_cases.js').read_text(encoding='utf-8')
        fixture = 'function setupExportFixture() {' + fixture.split('function setupExportFixture() {', 1)[1].split("check('NS export", 1)[0]
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8') + '\n' + builder.beta_source() + '\n' + fixture
        body += r'''
function formFixture(format, quality) {
    betaExport.view = null; betaExport.job = null; betaExport.starting = false; betaExport.message = '';
    betaDesign.settings = null; betaJob = null; betaMenuItems = [];
    var f = setupExportFixture(); voices[0].engine = 'ns';
    $.NSColor = {whiteColor: 'white', disabledControlTextColor: 'disabled'};
    f.destination = '/Users/test/Текст.aiff'; f.files[f.destination] = 'old';
    var directory = {path: '/Users/test', URLByAppendingPathComponent: function (name) {
        return {path: '/Users/test/' + name, URLByDeletingLastPathComponent: directory};
    }};
    var animation = {running: false, startAnimation: function () { this.running = true; }, stopAnimation: function () { this.running = false; }};
    betaExport.view = {name: {stringValue: 'Текст'}, voice: {indexOfSelectedItem: 0},
        voiceKeys: [voiceKey(voices[0])], format: {selectedSegment: format}, quality: {indexOfSelectedItem: quality},
        folder: {}, directory: directory, save: {}, cancel: {}, message: {}, progress: animation,
        window: {orderOut: function () { f.hidden = true; }}};
    $.NSFileManager.defaultManager.fileExistsAtPathIsDirectory = function (path, ref) { ref[0] = !f.missingFolder; return !f.missingFolder; };
    $.NSFileManager.defaultManager.fileExistsAtPath = function (path) { return !!f.files[path]; };
    $.NSAlert = {alloc: {init: {runModal: 1001, addButtonWithTitle: function () {}}}};
    return f;
}
check('filenames cannot escape the chosen directory and extension follows format', function () {
    ['../bad', 'a/b', 'a\\b', 'a:b', '', '   ', '.', '..', 'bad\nname'].forEach(function (name) {
        var rejected = false; try { betaExportFilename(name, 'wav'); } catch (e) { rejected = true; }
        assert(rejected, name);
    });
    assert(betaExportFilename(' Имя.M4A ', 'wav') === 'Имя.wav');
    assert(betaExportFilename('quote " and $(test)', 'm4a') === 'quote " and $(test).m4a');
    assert(betaExportChoice(2, 0, 'av').extension === 'caf');
    assert(betaExportChoice(2, 0, 'ns').extension === 'aiff');
});
check('form passes selection, speed and original format to unchanged synthesis; success stops animation', function () {
    var f = formFixture(2, 0); ui.rate.doubleValue = 1;
    betaExportSave();
    assert(active && audioExport && synth.spoken === '😀 тест' && synth.rate === 360);
    assert(betaExportOwnsJob() && betaExport.view.progress.running && !betaExport.view.save.enabled);
    assert(f.files[f.destination] === 'old' && !f.renames);
    finishAudioExport(true);
    assert(!active && !audioExport && f.files[f.destination] === 'new audio');
    assert(!betaExport.view.progress.running && betaExport.view.save.enabled);
    assert(betaExport.view.message.stringValue.indexOf('Аудио сохранено') >= 0);
});
check('all conversion profiles wait for completion and persist actual selection', function () {
    [[0,0],[0,1],[0,2],[1,0],[1,1]].forEach(function (profile) {
        var f = formFixture(profile[0], profile[1]);
        betaExportSave(); var job = audioExport;
        assert(job && job.quality === betaExportChoice(profile[0], profile[1], 'ns').quality);
        assert(defaults.objectForKey('audioFormatChoice') === betaExportChoice(profile[0], profile[1], 'ns').saved);
        finishAudioExport(true);
        assert(job.task.running && betaExport.view.message.stringValue.indexOf('Преобразование') >= 0);
        assert(!f.renames);
        f.files[job.convertedPath] = 'converted'; job.task.running = false; exportTick();
        assert(f.files[job.destination] === 'converted' && !betaExport.view.progress.running);
    });
});
check('refused replacement, invalid folder, stale voice and empty text do not create jobs', function () {
    var f = formFixture(2, 0); $.NSAlert.alloc.init.runModal = 1000; betaExportSave();
    assert(!audioExport && !f.directories.length && f.files[f.destination] === 'old');
    $.NSAlert.alloc.init.runModal = 1001; f.missingFolder = true; betaExportSave(); assert(!audioExport && !f.directories.length);
    f.missingFolder = false; betaExport.view.voiceKeys = ['gone']; betaExportSave(); assert(!audioExport && !f.directories.length);
    betaExport.view.voiceKeys = [voiceKey(voices[0])]; ui.editor.string = ''; betaExportSave();
    assert(!audioExport && !f.directories.length && betaExport.view.save.enabled);
});
check('cancel, main Stop and close clean owned jobs but leave another reading alone', function () {
    [betaExportCancel, stop, betaExportClose].forEach(function (cancel) {
        var f = formFixture(2, 0); betaExportSave(); var job = audioExport;
        cancel();
        assert(!active && !audioExport && !f.files[job.path] && f.files[f.destination] === 'old');
        assert(!betaExport.view.progress.running && betaExport.view.message.stringValue.indexOf('отменено') >= 0);
    });
    var f = formFixture(0, 1); active = true; var speech = synth;
    betaExportSync(); assert(!betaExport.view.save.enabled);
    betaExportClose(); assert(active && !speech.wasStopped && f.hidden);
});
check('conversion cancellation and errors preserve destination and report outcome', function () {
    var f = formFixture(0, 1); betaExportSave(); var job = audioExport; finishAudioExport(true);
    betaExportCancel(); assert(!audioExport && !betaExport.view.progress.running && job.timer.invalidated);
    f = formFixture(0, 1); betaExportSave(); job = audioExport; finishAudioExport(true);
    job.task.running = false; job.task.terminationStatus = 1; exportTick();
    assert(!audioExport && !f.renames && betaExport.view.message.stringValue.indexOf('Аудио:') >= 0);
    f = formFixture(2, 0); f.startFails = true; betaExportSave();
    assert(!audioExport && !active && !f.renames && betaExport.view.save.enabled);
});
check('Swift export retains CAF and finishes through existing helper lifecycle', function () {
    var f = formFixture(2, 0); voices[0].engine = 'av'; betaExport.view.voiceKeys = [voiceKey(voices[0])];
    betaExportSave(); var job = audioExport, host = hostSpeech;
    assert(job.path.slice(-4) === '.caf' && job.destination.slice(-4) === '.caf');
    assert(host.backend === 'swift' && host.mode === 'export');
    f.files[job.path] = 'CAF audio'; f.reply(host, {state: 'finished'}); hostTick();
    assert(!audioExport && f.files[job.destination] === 'CAF audio' && !betaExport.view.progress.running);
});
'''
        results = json.loads(evaluate('(function () {\n' + body + '\nreturn JSON.stringify(testResults);\n}());'))
        self.assertEqual(len(results), 7)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    @unittest.skipUnless(sys.platform == 'darwin', 'Export window and JXA require a Mac')
    def test_native_export_window_and_close(self):
        script = '(function () {\n' + builder.beta_source() + r'''
var saved = {};
defaults = {objectForKey: function (key) { return saved[ObjC.unwrap(key)]; },
    setObjectForKey: function (value, key) { saved[ObjC.unwrap(key)] = ObjC.unwrap(value); },
    setDoubleForKey: function (value, key) { saved[ObjC.unwrap(key)] = Number(value); }};
initLocalization(); initTheme(); registerController(); buildMainWindow();
voices = [{id: 'test', name: 'Test voice', locale: 'ru_RU', engine: 'ns'}];
selectedVoice = function () { return voices[0]; }; synth = {};
betaExportShow();
var view = betaExport.view;
if (!view.window.visible || Number(view.format.segmentCount) !== 3) throw new Error('Form missing');
view.format.selectedSegment = 2; betaExportOptions();
if (view.quality.enabled) throw new Error('Original quality should be fixed');
view.window.cancelOperation($());
if (view.window.visible) throw new Error('Escape failed');
betaExportShow(); view.window.performClose($());
if (view.window.visible) throw new Error('Close failed');
betaExportShow(); view.window.standardWindowButton($.NSWindowCloseButton).performClick($());
if (view.window.visible) throw new Error('Red close failed');
ui.window.orderOut($());
return 'ok';
}());
'''
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')
