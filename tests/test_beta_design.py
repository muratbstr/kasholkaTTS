import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('design_builder', ROOT / 'scripts/build_beta.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BetaDesignTests(unittest.TestCase):
    def test_layout_and_settings_preserve_application_state(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8') + '\n' + builder.beta_source()
        body += r'''
function designSetup() {
    betaJob = null; betaMenuItems = []; betaDesign.settings = null;
    languageSettings.preference = 'system'; themePreference = 'system';
}
check('all visible controls fit at minimum and large sizes for every supported scale', function () {
    designSetup();
    [0.8, 1, 1.5].forEach(function (factor) {
        [[680, 400], [760, 500], [1200, 800]].forEach(function (size) {
            var width = size[0] * factor, height = size[1] * factor;
            var frames = betaDesignFrames(width, height, factor);
            Object.keys(frames).forEach(function (key) {
                var f = frames[key];
                assert(f[0] >= 0 && f[1] >= 0 && f[2] > 0 && f[3] > 0, key);
                assert(f[0] + f[2] <= width + 0.01 && f[1] + f[3] <= height + 0.01, key);
            });
            var keys = Object.keys(frames);
            keys.forEach(function (key, i) {
                var a = frames[key];
                keys.slice(i + 1).forEach(function (other) {
                    var b = frames[other];
                    var overlap = a[0] < b[0]+b[2] && a[0]+a[2] > b[0] && a[1] < b[1]+b[3] && a[1]+a[3] > b[1];
                    assert(!overlap, key + ' overlaps ' + other);
                });
            });
        });
    });
});
check('settings synchronize without resetting reading, voice, selection or saved speed', function () {
    designSetup();
    betaDesign.settings = {theme: {}, language: {}, scroll: {}, updates: {}, refresh: {}, reset: {}};
    ui.autoScrollItem = {};
    ui.editor.string = 'Keep this text';
    var selection = {location: 3, length: 4}; ui.editor.selectedRange = selection;
    var speech = synth; active = true; paused = true;
    reading = {offset: 3, length: 4}; var previousReading = reading;
    defaults.setDoubleForKey(0.8, 'speedPosition');
    themePreference = 'dark'; languageSettings.preference = 'en';
    betaDesignSetAutoUpdates(false); betaDesignSetAutoScroll(false);
    assert(defaults.objectForKey('updateAutoCheck') === false && defaults.objectForKey('autoScroll') === false);
    assert(betaDesign.settings.theme.selectedSegment === 2 && betaDesign.settings.language.selectedSegment === 2);
    assert(betaDesign.settings.scroll.state === 0 && betaDesign.settings.updates.state === 0);
    defaults.setObjectForKey(true, 'updateAutoCheck'); toggleAutoScroll(); betaDesignSyncSettings();
    assert(betaDesign.settings.scroll.state === 1 && betaDesign.settings.updates.state === 1 && ui.autoScrollItem.state === 1);
    assert(synth === speech && !speech.wasStopped && active && paused && reading === previousReading);
    assert(ui.editor.string === 'Keep this text' && ui.editor.selectedRange === selection);
    assert(defaults.objectForKey('speedPosition') === 0.8);
});
check('new export and settings buttons follow speech, export and Siri busy state', function () {
    designSetup(); ui.exportButton = {};
    betaDesign.settings = {theme: {}, language: {}, scroll: {}, updates: {}, refresh: {}, reset: {}};
    updateControls();
    assert(ui.exportButton.enabled && betaDesign.settings.refresh.enabled && betaDesign.settings.reset.enabled);
    active = true; updateControls();
    assert(!ui.exportButton.enabled && !betaDesign.settings.refresh.enabled && !betaDesign.settings.reset.enabled);
    active = false; betaJob = {mode: 'probe'}; updateControls();
    assert(!ui.exportButton.enabled && !betaDesign.settings.refresh.enabled && !betaDesign.settings.reset.enabled);
    betaJob = null; voiceProbe = {state: 'running'}; updateControls();
    assert(!ui.exportButton.enabled && !betaDesign.settings.refresh.enabled && !betaDesign.settings.reset.enabled);
    voiceProbe = null; synth = null; updateControls();
    assert(!ui.exportButton.enabled);
});
check('speed multiplier preserves saved position and actual speech rate logic', function () {
    designSetup(); engine = 'ns'; voiceBaseRate = 180;
    ui.rate.doubleValue = 0.5; applyRate();
    assert(ui.rateValue.stringValue === '1×' && ui.rateValue.toolTip.indexOf('180') >= 0);
    ui.rate.doubleValue = 0; applyRate();
    assert(ui.rateValue.stringValue === '0.5×' && defaults.objectForKey('speedPosition') === 0);
    ui.rate.doubleValue = 1; applyRate();
    assert(ui.rateValue.stringValue === '2×' && defaults.objectForKey('speedPosition') === 1);
});
check('closing settings has its own delegate and cannot quit the reader', function () {
    designSetup(); betaDesign.controller = null;
    $.KasholkaBetaDesignController = {alloc: {init: {}}};
    var oldQuit = terminateApp, quits = 0;
    terminateApp = function () { quits++; };
    try {
        betaDesignRegisterController();
        assert(registered.name === 'KasholkaBetaDesignController');
        var visible = true, hidden = 0;
        betaDesign.settings = {window: {orderOut: function (sender) {
            assert(sender === bridgedNil); visible = false; hidden++;
        }}};
        assert(registered.methods['windowShouldClose:'].implementation({}) === true);
        registered.methods['closeSettings:'].implementation({});
        assert(!visible && hidden === 1, 'Close action did not hide settings');
        registered.methods['windowWillClose:'].implementation({});
        betaDesign.settings = null;
        assert(quits === 0);
        registered.methods['settingsScroll:'].implementation({state: 0});
        assert(autoScroll === false);
        registered.methods['settingsUpdates:'].implementation({state: 0});
        assert(defaults.objectForKey('updateAutoCheck') === false);
    } finally { terminateApp = oldQuit; }
});
check('custom controls preserve target, action and icons; Escape hides only settings', function () {
    designSetup(); betaDesign.buttonCellReady = false;
    var definitions = {}, oldRegister = ObjC.registerSubclass;
    ObjC.registerSubclass = function (definition) { definitions[definition.name] = definition; };
    var children = [], target = {}, frame = {size: {width: 110, height: 34}};
    $.NSButton = {alloc: {initWithFrame: function (value) {
        return {frame: value, setButtonType: function (kind) { this.kind = kind; }};
    }}};
    $.KasholkaBetaButtonCell = {alloc: {initTextCell: function () { return {custom: true}; }}};
    $.NSFont = {systemFontOfSize: function (size) { return size; }};
    $.NSImage = {imageWithSystemSymbolNameAccessibilityDescription: function (symbol) {
        return {symbol: symbol, isNil: function () { return false; }};
    }};
    $.NSMakeSize = function (width, height) { return {width: width, height: height}; };
    $.NSColor = {whiteColor: 'white'};
    try {
        ['play:', 'pause:', 'stop:', 'openText:', 'exportAudio:'].forEach(function (action) {
            var b = betaDesignMakeButton({addSubview: function (item) { children.push(item); }}, 'Title', action, target, frame);
            assert(b.cell.custom && b.action === action && b.target === target && b.frame === frame);
            assert(b.image && b.image.size.width === 14 && b.title === 'Title');
        });
        assert(children.length === 5 && children[0].tag === 1001 && children[0].contentTintColor === 'white');
        var hidden = false, speech = synth;
        betaDesign.settings = {window: {orderOut: function () { hidden = true; }}};
        definitions.KasholkaBetaSettingsWindow.methods['cancelOperation:'](bridgedNil);
        assert(hidden && synth === speech && !speech.wasStopped);
    } finally { ObjC.registerSubclass = oldRegister; betaDesign.settings = null; }
});
check('custom bezel draws full-size rounded gradient and distinct enabled, pressed, disabled themes', function () {
    designSetup();
    var draw = {}, strokes = 0, gradientCount = 0;
    $.NSAppearanceNameAqua = 'light'; $.NSAppearanceNameDarkAqua = 'dark';
    $.NSMakeRect = function (x, y, w, h) { return {origin: {x: x, y: y}, size: {width: w, height: h}}; };
    $.NSColor = {colorWithCalibratedRedGreenBlueAlpha: function (r, g, b, a) { return {rgb: [r, g, b], alpha: a}; }};
    $.NSBezierPath = {bezierPathWithRoundedRectXRadiusYRadius: function (rect, rx, ry) {
        draw.rect = rect; assert(rx > 0 && rx === ry);
        var path = {}; Object.defineProperty(path, 'stroke', {get: function () { strokes++; }}); return path;
    }};
    $.NSGradient = {alloc: {initWithStartingColorEndingColor: function (top, bottom) {
        draw.top = top.rgb; draw.bottom = bottom.rgb;
        return {drawInBezierPathAngle: function (path, angle) { gradientCount++; assert(Math.abs(angle) === 90); }};
    }}};
    var colors = {};
    [false, true].forEach(function (dark) {
        [false, true].forEach(function (enabled) {
            [false, true].forEach(function (pressed) {
                betaDesignDrawBezel({enabled: enabled, highlighted: pressed}, $.NSMakeRect(0, 0, 110, 34), {
                    tag: 1001, flipped: true, effectiveAppearance: {bestMatchFromAppearancesWithNames: function () { return dark ? 'dark' : 'light'; }}
                });
                assert(draw.rect.size.height === 32 && draw.rect.size.width === 108);
                colors[[dark, enabled, pressed].join(':')] = JSON.stringify(draw);
            });
        });
    });
    assert(strokes === 8 && gradientCount === 8);
    assert(colors['false:true:false'] !== colors['false:true:true']);
    assert(colors['false:false:false'] !== colors['false:true:false']);
    assert(colors['false:false:false'] !== colors['true:false:false']);
});
'''
        results = json.loads(evaluate('(function () {\n' + body + '\nreturn JSON.stringify(testResults);\n}());'))
        self.assertEqual(len(results), 7)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    def test_design_is_only_in_beta_payload(self):
        sys.path.insert(0, str(ROOT / 'scripts'))
        from localization import application_source
        self.assertNotIn('function betaDesignShowSettings()', application_source())
        self.assertIn('function betaDesignShowSettings()', builder.beta_source())

    @unittest.skipUnless(sys.platform == 'darwin', 'Subclass ABI validation requires the real JXA runtime')
    def test_native_appkit_subclasses_register_before_window_creation(self):
        script = '(function () {\n' + builder.beta_source() + r"""
betaDesignRegisterButtonCell();
betaDesignRegisterButtonCell(); // Registration must also be idempotent.
var cell = $.KasholkaBetaButtonCell.alloc.initTextCell($('Test'));
var window = $.KasholkaBetaSettingsWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(0, 0, 200, 100), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable,
    $.NSBackingStoreBuffered, false);
if (!cell.isKindOfClass($.NSButtonCell) || !window.isKindOfClass($.NSWindow)) throw new Error('Invalid subclass');
var hidden = false;
betaDesign.settings = {window: {orderOut: function () { hidden = true; }}};
window.cancelOperation($());
if (!hidden) throw new Error('Inherited cancelOperation signature did not dispatch');
return 'ok';
}());
"""
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')

    @unittest.skipUnless(sys.platform == 'darwin', 'Native design and JXA bridge require a Mac')
    def test_native_reader_settings_and_appearance(self):
        script = '(function () {\n' + builder.beta_source() + r'''
var saved = {};
defaults = {objectForKey: function (key) { return saved[ObjC.unwrap(key)]; },
    setObjectForKey: function (value, key) { saved[ObjC.unwrap(key)] = ObjC.unwrap(value); },
    setDoubleForKey: function (value, key) { saved[ObjC.unwrap(key)] = Number(value); }};
var quits = 0;
terminateApp = function () { quits++; };
alertUser = function (title, text) { throw new Error(String(text)); };
initLocalization(); initTheme(); registerController(); buildMainWindow();
if (!ui.designReady || ObjC.unwrap(ui.exportButton.action) !== 'exportAudio:') throw new Error('Reader not configured');
ui.editor.string = $('Design test'); ui.editor.setSelectedRange($.NSMakeRange(2, 3));
betaDesignShowSettings();
betaDesign.settings.theme.selectedSegment = 2;
betaDesign.controller.settingsTheme(betaDesign.settings.theme);
if (saved.uiTheme !== 'dark') throw new Error('Theme selector failed');
betaDesign.settings.scroll.state = 0;
betaDesign.controller.settingsScroll(betaDesign.settings.scroll);
if (autoScroll !== false) throw new Error('Scroll switch failed');
var settingsWindow = betaDesign.settings.window;
settingsWindow.standardWindowButton($.NSWindowCloseButton).performClick($());
if (settingsWindow.visible) throw new Error('Red button did not hide settings');
betaDesignShowSettings();
if (!settingsWindow.visible) throw new Error('Settings failed to reopen');
settingsWindow.cancelOperation($());
if (settingsWindow.visible) throw new Error('Escape did not hide settings');
betaDesignShowSettings();
settingsWindow.performClose($());
if (settingsWindow.visible) throw new Error('performClose did not close settings');
if (quits) throw new Error('Settings quit the application');
betaDesignShowSettings();
if (Number(betaDesign.settings.theme.selectedSegment) !== 2) throw new Error('Settings lost state');
['light', 'dark'].forEach(function (theme) {
    chooseTheme(theme);
    var image = $.NSImage.alloc.initWithSize($.NSMakeSize(110, 34));
    image.lockFocus;
    try {
        betaDesignDrawBezel(ui.play.cell, $.NSMakeRect(0, 0, 110, 34), ui.play);
        ui.play.cell.drawWithFrameInView($.NSMakeRect(0, 0, 110, 34), ui.play);
    } finally { image.unlockFocus; }
});
if (ui.window.titlebarAppearsTransparent || settingsWindow.titlebarAppearsTransparent) throw new Error('Missing title bar');
if (!ui.play.cell.isKindOfClass($.KasholkaBetaButtonCell)) throw new Error('System bezel used');
chooseTheme('system');
if (!$.NSApplication.sharedApplication.appearance.isNil()) throw new Error('System theme is not nil');
if (ObjC.unwrap(ui.editor.string) !== 'Design test' || Number(ui.editor.selectedRange.location) !== 2) throw new Error('Text changed');
betaDesign.settings.window.orderOut($()); ui.window.orderOut($());
return 'ok';
}());
'''
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')
