import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("beta_builder", ROOT / "scripts/build_beta.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
icon_spec = importlib.util.spec_from_file_location("beta_icon", ROOT / "scripts/build_icon.py")
icon = importlib.util.module_from_spec(icon_spec)
icon_spec.loader.exec_module(icon)


class BetaTests(unittest.TestCase):
    def test_beta_lifecycle_and_system_routes(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8') + '\n' + builder.beta_source()
        body += '\n' + (ROOT / 'tests/beta_cases.js').read_text(encoding='utf-8')
        results = json.loads(evaluate('(function () {\n' + body + '\nreturn JSON.stringify(testResults);\n}());'))
        self.assertEqual(len(results), 5)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    def test_probe_rejects_substitution_and_collects_only_existing_siri_ids(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8')
        body += '\n' + (ROOT / 'beta/probe.js').read_text(encoding='utf-8')
        body += r'''
var id = 'com.apple.siri.natural.Test';
var ids = betaCollectIDs(['ru', {voiceId: id}, {nested: [id, 'Yuri', 'private text', 'com.apple.voice.Yuri']}]);
assert(ids.length === 1 && ids[0] === id);
var cycle = {}; cycle.next = cycle;
assert(betaCollectIDs(cycle).length === 0);
function voice(identifier) { return {identifier: identifier, name: 'Test', language: 'ru-RU', isNil: function () { return false; }}; }
var klass = { voiceWithIdentifier: function (identifier) { return voice('com.apple.voice.Yuri'); },
    voiceWithLanguage: function () { return voice('com.apple.voice.Yuri'); } };
var result = betaResolveCandidates(ids, klass);
assert(result.voices.length === 0 && result.attempts[0].result === 'substituted');
klass.voiceWithIdentifier = function (identifier) { return voice(identifier); };
result = betaResolveCandidates(ids, klass);
assert(result.voices.length === 1 && result.voices[0].id === id && result.voices[0].backend === 'osascript');
klass.voiceWithIdentifier = function () { return {isNil: function () { return true; }}; };
result = betaResolveCandidates(ids, klass);
assert(result.voices.length === 0 && result.attempts[0].result === 'unavailable');
return 'ok';
'''
        self.assertEqual(evaluate('(function () {\n' + body + '\n}());'), 'ok')

    def test_beta_packaging_is_isolated_and_reproducible(self):
        stable = [ROOT / name for name in ['VERSION', 'src/kasholkaTTS.js', 'installer/Install kasholkaTTS.command', 'assets/kasholkaTTS.icns']]
        before = {p: p.read_bytes() for p in stable}
        output = ROOT / 'build'
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temp:
            archive, checksum = builder.build_beta(temp)
            first = archive.read_bytes()
            with zipfile.ZipFile(archive) as package:
                self.assertIsNone(package.testzip())
                names = package.namelist()
                command = next(name for name in names if name.endswith('.command'))
                self.assertTrue(command.endswith('Install kasholkaTTS Beta.command'))
                self.assertEqual(stat.S_IMODE(package.getinfo(command).external_attr >> 16), 0o755)
                body = package.read(command).decode('utf-8')
                self.assertNotIn('\r', body)
                self.assertIn('destination="$applications_dir/kasholkaTTS Beta.app"', body)
                self.assertIn('CFBundleIdentifier string com.kasholka.tts.beta\n', body)
                self.assertNotIn('com.kasholka.tts\n', body)
                self.assertIn("runningApplicationsWithBundleIdentifier('com.kasholka.tts.beta')", body)
                self.assertIn('old_id" == com.kasholka.tts.beta', body)
                self.assertIn('kasholkaTTS-Beta-backup.', body)
                self.assertIn('Contents/Resources/beta-probe.js', body)
                source = package.read(next(name for name in names if name.endswith('/src/kasholkaTTS.js'))).decode('utf-8')
                self.assertIn("var VERSION = '1.5.1 Beta 1';", source)
                self.assertIn("ui.window.title = $('kasholkaTTS Beta');", source)
                self.assertIn('function betaProbe()', source)
                data = package.read(next(name for name in names if name.endswith('/assets/kasholkaTTS.icns')))
                self.assertEqual(data, (ROOT / 'beta/assets/kasholkaTTS.icns').read_bytes())
                self.assertNotEqual(data, before[ROOT / 'assets/kasholkaTTS.icns'])
            self.assertEqual(checksum.read_text().split()[0], hashlib.sha256(first).hexdigest())
            builder.build_beta(temp)
            self.assertEqual(archive.read_bytes(), first)
        for path, data in before.items():
            self.assertEqual(path.read_bytes(), data)

    def test_beta_icon_has_exact_blue_background_and_same_alpha(self):
        width, height, channels, blue = icon.read_png(ROOT / 'beta/assets/kasholkaTTS.png')
        _, _, _, green = icon.read_png(ROOT / 'assets/kasholkaTTS.png')
        self.assertEqual((width, height, channels), (1024, 1024, 4))
        self.assertEqual(blue[3::4], green[3::4])
        for y in range(240, 790):
            for x in list(range(180, 300)) + list(range(740, 850)):
                offset = (y * width + x) * channels
                self.assertEqual(tuple(blue[offset:offset + 4]), (0, 64, 255, 255))
        offset = (512 * width + 512) * 4
        self.assertEqual(tuple(blue[offset:offset + 4]), (0, 0, 0, 255))
