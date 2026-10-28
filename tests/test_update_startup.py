"""Regression tests for startup checks without network or user preferences."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]

FIXTURE = r"""
setup();
var state = {fetches: [], messages: [], alerts: [], restored: 0};
updater = {job: null, handedOff: false, didLaunch: false, items: {check: {}, cancel: {}}};
$.NSTemporaryDirectory = function () { return '/tmp/'; };
$.NSUUID = {UUID: {UUIDString: 'AB12-CD34'}};
updateDirectory = function () {};
updateClean = function () {};
updateSize = function () { return 0; };
updateRestoreText = function () { state.restored++; };
status = function (text) { state.messages.push(text); };
alertUser = function (title, text) { state.alerts.push([title, text]); };
updateFetch = function (job, url, output, limit, phase) {
    state.fetches.push(url); job.phase = phase; job.output = job.directory + '/' + output;
};
"""

class StartupUpdateTests(unittest.TestCase):
    def run_case(self, case):
        source = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in [
            'tests/app_harness.js', 'src/kasholkaTTS.js', 'src/update-policy.js', 'src/updater.js'])
        self.assertEqual(evaluate('(function(){\n' + source + FIXTURE + case + "\nreturn 'ok';}());"), 'ok')

    def test_recent_and_future_checks_do_not_suppress_launch(self):
        for last in [0, 'recent', 'future', 'invalid']:
            with self.subTest(last=last):
                value = {'recent': 'Date.now()', 'future': 'Date.now() + 86400000', 'invalid': "'broken'"}.get(last, '0')
                self.run_case("defaults.setObjectForKey(" + value + ", 'updateLastCheck');" + r"""
updateDidLaunch();
assert(state.fetches.length === 1, 'Startup check was skipped');
assert(updater.job.manual === false && updater.job.phase === 'check');
assert(state.messages[0] === 'Проверка обновлений GitHub…');
updateRead = function () { return '[]'; };
updateAdvance(updater.job);
updateDidLaunch();
assert(state.fetches.length === 1 && state.restored === 1, 'Repeated callback checked/restored twice');
""")

    def test_disabled_startup_still_allows_manual_check(self):
        self.run_case(r"""
defaults.setObjectForKey(false, 'updateAutoCheck');
updateDidLaunch();
assert(state.fetches.length === 0 && state.restored === 1);
checkForUpdates(true);
assert(state.fetches.length === 1 && updater.job.manual === true);
checkForUpdates(true);
assert(state.fetches.length === 1, 'Concurrent manual checks');
""")

    def test_real_splash_completion_starts_check(self):
        self.run_case(r"""
defaults.setObjectForKey(Date.now(), 'updateLastCheck');
ui.window = {makeKeyAndOrderFront: function () { state.shown = true; }, makeFirstResponder: function () {}};
startup = {stage: 3, shownAt: Date.now() - 1500, busy: false};
closeStartup = function () { startup = null; };
terminateApp = function () { state.quit = true; };
startupTick();
assert(state.shown && !state.quit && startup === null);
assert(state.fetches.length === 1, 'Splash completion did not check for updates');
startupTick();
assert(state.fetches.length === 1);
""")

    def test_automatic_result_visible_without_dialog_or_interrupting_reading(self):
        for busy in [False, True]:
            with self.subTest(busy=busy):
                self.run_case('active = ' + json.dumps(busy) + ';' + r"""
updateDidLaunch();
assert(state.fetches.length === 1);
updateRead = function () { return '[]'; };
updateAdvance(updater.job);
assert(updater.job === null && state.alerts.length === 0);
if (active) assert(state.messages.length === 0, 'Background result overwrote reading status');
else assert(state.messages[state.messages.length - 1] === 'У вас актуальная версия для этого канала.');
""")

    def test_network_failure_keeps_app_open_and_next_launch_checks_again(self):
        self.run_case(r"""
updateDidLaunch();
updater.job.task = {running: false, terminationStatus: 7};
updateTick();
assert(updater.job === null && state.alerts.length === 0);
assert(state.messages.length >= 2);
assert(!defaults.objectForKey('updateLastCheck'), 'Failed request marked successful');
// A new app process starts with fresh updater state and the same preferences.
updater.didLaunch = false;
updateDidLaunch();
assert(state.fetches.length === 2, 'Network error blocked next launch');
""")

    @unittest.skipUnless(sys.platform == 'darwin', 'Native JXA preference bridge requires a Mac')
    def test_native_boolean_preferences(self):
        source = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in [
            'src/kasholkaTTS.js', 'src/update-policy.js', 'src/updater.js'])
        script = '(function(){\n' + source + r"""
var checks = 0;
checkForUpdates = function (manual) { if (manual) throw new Error('Manual flag'); checks++; };
updateRestoreText = function () {};
[undefined, $(true), $(false), null].forEach(function (value, index) {
    updater.didLaunch = false;
    defaults = {objectForKey: function () { return value; }};
    var before = checks;
    updateDidLaunch(); updateDidLaunch();
    if (checks - before !== (index === 2 ? 0 : 1)) throw new Error('Preference conversion');
});
return 'ok'; }());
"""
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')
