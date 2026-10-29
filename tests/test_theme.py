import json
from pathlib import Path
import subprocess
import sys
import unittest

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]


class ThemeTests(unittest.TestCase):
    def test_theme_preferences_and_switching_preserve_reading(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8')
        body += '\n' + (ROOT / 'src/kasholkaTTS.js').read_text(encoding='utf-8')
        body += r'''
function themeFixture() {
    var current = $();
    $.NSApplication = {sharedApplication: {}};
    Object.defineProperty($.NSApplication.sharedApplication, 'appearance', {
        get: function () { return current; },
        set: function (value) {
            // Raw JS null is not JXA's bridged Objective-C nil.
            if (value === null || value === undefined) throw new Error('Invalid appearance object: JS null/undefined');
            current = value;
        }
    });
    $.NSAppearanceNameAqua = 'Aqua';
    $.NSAppearanceNameDarkAqua = 'DarkAqua';
    $.NSAppearance = {appearanceNamed: function (name) { return name; }};
    function menu() {
        return {items: [], addItem: function (item) { this.items.push(item); },
            addItemWithTitleActionKeyEquivalent: function (title, action) {
                var item = {title: title, action: action}; this.items.push(item); return item;
            }};
    }
    $.NSMenu = {alloc: {initWithTitle: menu}};
    $.NSMenuItem.alloc = {};
    Object.defineProperty($.NSMenuItem.alloc, 'init', {get: function () { return {}; }});
    return menu();
}
check('first launch follows system without saving an override', function () {
    var parent = themeFixture();
    initTheme(); installThemeMenu(parent);
    assert($.NSApplication.sharedApplication.appearance === bridgedNil);
    assert(themePreference === 'system' && defaults.objectForKey('uiTheme') === undefined);
    assert(parent.items[0].submenu.items.length === 3);
    assert(ui.themeItems[0].state === 1 && ui.themeItems[1].state === 0 && ui.themeItems[2].state === 0);
});
check('theme action persists and restores without changing an active session', function () {
    var parent = themeFixture();
    initTheme(); installThemeMenu(parent); registerController();
    ui.editor.string = 'Text 😀';
    ui.editor.selectedRange = {location: 2, length: 3};
    var selection = ui.editor.selectedRange, speech = synth;
    active = true; paused = true;
    reading = {offset: 2, length: 3};
    var savedReading = reading;
    highlightedRange = {location: 2, length: 3};
    var savedHighlight = highlightedRange;
    audioExport = {state: 'running'};
    var savedExport = audioExport;
    registered.methods['theme:'].implementation({tag: 2});
    assert($.NSApplication.sharedApplication.appearance === 'DarkAqua');
    assert(defaults.objectForKey('uiTheme') === 'dark' && ui.themeItems[2].state === 1);
    assert(ui.editor.string === 'Text 😀' && ui.editor.selectedRange === selection);
    assert(active && paused && synth === speech && !synth.wasStopped);
    assert(reading === savedReading && highlightedRange === savedHighlight && audioExport === savedExport);
    $.NSApplication.sharedApplication.appearance = $(); themePreference = 'system';
    initTheme();
    assert(themePreference === 'dark' && $.NSApplication.sharedApplication.appearance === 'DarkAqua');
    registered.methods['theme:'].implementation({tag: 1});
    assert($.NSApplication.sharedApplication.appearance === 'Aqua' && ui.themeItems[1].state === 1);
    registered.methods['theme:'].implementation({tag: 0});
    assert($.NSApplication.sharedApplication.appearance === bridgedNil);
    assert(defaults.objectForKey('uiTheme') === 'system' && ui.themeItems[0].state === 1);
});
check('run reaches splash with default system theme and reports initialization errors', function () {
    themeFixture();
    var oldShow = showStartup, oldAlert = alertUser, oldQuit = terminateApp;
    var oldBind = ObjC.bindFunction;
    var shown = 0, errors = [], quits = 0;
    $.NSUserDefaults = {standardUserDefaults: defaults};
    $.NSApplication.sharedApplication.setActivationPolicy = function () {};
    $.NSApplication.sharedApplication.activateIgnoringOtherApps = function () {};
    ObjC.bindFunction = function () {};
    showStartup = function () { shown++; };
    alertUser = function (title, message) { errors.push(message); };
    terminateApp = function () { quits++; };
    startup = null;
    try {
        run();
        assert(shown === 1 && !errors.length && !quits, 'Launch did not reach splash');
        Object.defineProperty(defaults, 'objectForKey', {value: function (key) {
            if (key === 'uiTheme') throw new Error('Theme initialization failed');
        }});
        run();
        assert(errors.length === 1 && errors[0].indexOf('Theme initialization failed') >= 0);
        assert(shown === 1 && quits === 1, 'Failure was not reported through the launch handler');
    } finally {
        showStartup = oldShow; alertUser = oldAlert; terminateApp = oldQuit; ObjC.bindFunction = oldBind;
    }
});
check('invalid saved theme falls back to system; invalid menu actions are ignored', function () {
    themeFixture(); defaults.setObjectForKey('broken', 'uiTheme'); initTheme();
    assert(themePreference === 'system' && $.NSApplication.sharedApplication.appearance === bridgedNil);
    chooseTheme('dark'); chooseTheme(undefined); chooseTheme('unknown');
    assert(defaults.objectForKey('uiTheme') === 'dark' && themePreference === 'dark');
});
'''
        results = json.loads(evaluate('(function () {\n' + body + '\nreturn JSON.stringify(testResults);\n}());'))
        self.assertEqual(len(results), 4)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    @unittest.skipUnless(sys.platform == 'darwin', 'Native appearance and JXA bridge require a Mac')
    def test_native_theme_menu_and_editor(self):
        source = (ROOT / 'src/kasholkaTTS.js').read_text(encoding='utf-8')
        script = '(function () {\n' + source + r'''
var saved = {};
defaults = {objectForKey: function (key) { return saved[ObjC.unwrap(key)]; },
    setObjectForKey: function (value, key) { saved[ObjC.unwrap(key)] = ObjC.unwrap(value); }};
registerController(); initTheme(); buildMainWindow();
ui.editor.string = $('Theme test');
ui.editor.setSelectedRange($.NSMakeRange(2, 3));
controller.theme(ui.themeItems[2]);
var names = $([$.NSAppearanceNameAqua, $.NSAppearanceNameDarkAqua]);
var matched = ObjC.unwrap(ui.window.effectiveAppearance.bestMatchFromAppearancesWithNames(names));
if (matched !== ObjC.unwrap($.NSAppearanceNameDarkAqua)) throw new Error('Dark appearance was not inherited');
if (saved.uiTheme !== 'dark' || Number(ui.themeItems[2].state) !== 1) throw new Error('Menu action failed');
controller.theme(ui.themeItems[1]);
matched = ObjC.unwrap(ui.window.effectiveAppearance.bestMatchFromAppearancesWithNames(names));
if (matched !== ObjC.unwrap($.NSAppearanceNameAqua)) throw new Error('Light appearance was not inherited');
if (ObjC.unwrap(ui.editor.string) !== 'Theme test' || Number(ui.editor.selectedRange.location) !== 2 ||
    Number(ui.editor.selectedRange.length) !== 3) throw new Error('Editor changed');
controller.theme(ui.themeItems[0]);
if (saved.uiTheme !== 'system') throw new Error('System choice failed');
if (!$.NSApplication.sharedApplication.appearance.isNil()) throw new Error('System appearance is not native nil');
ui.window.orderOut(null);
return 'ok';
}());
'''
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')
