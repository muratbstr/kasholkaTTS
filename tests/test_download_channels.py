"""Separate manual/automatic archives and the actual workflow counter."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import textwrap
import unittest
import zipfile

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

def counter_source():
    source = (ROOT / '.github/workflows/downloads.yml').read_text(encoding='utf-8')
    return textwrap.dedent(source.split('// BEGIN MANUAL DOWNLOAD COUNTER\n')[1].split('// END MANUAL DOWNLOAD COUNTER')[0])

class DownloadChannelTests(unittest.TestCase):
    def test_counter_filters_actual_workflow_assets(self):
        script = counter_source() + r"""
function asset(name, count, state) { return {name: name, download_count: count, state: state || 'uploaded'}; }
var stable = 'kasholkaTTS-1.7.4-Release-2-macOS-manual-installer.zip';
var beta = 'kasholkaTTS-Beta-1.7.5-Beta-1-macOS-manual-installer.zip';
var releases = [
  {draft: false, assets: [asset(stable, 7), asset(stable + '.sha256', 99),
    asset('kasholkaTTS-1.7.4-Release-2-macOS-installer.zip', 1000),
    asset('kasholkaTTS-1.7.2-Release-2-macOS-installer.zip', 500),
    asset('other.zip', 50), asset(stable, 100, 'new')]},
  {draft: false, prerelease: true, assets: [asset(beta, 3)]},
  {draft: true, assets: [asset(stable, 100)]}
];
if (countManualDownloads(releases) !== 10) throw new Error('Wrong total');
if (countManualDownloads([]) !== 0) throw new Error('Empty total');
var failed = false;
try { countManualDownloads([{draft: false, assets: [asset(stable, -1)]}]); }
catch (e) { failed = true; }
if (!failed) throw new Error('Invalid count accepted');
return 'ok';
"""
        self.assertEqual(evaluate('(function () {\n' + script + '\n}());'), 'ok')

    def test_both_channels_are_reproducible_and_select_only_auto_assets(self):
        policy = (ROOT / 'src/update-policy.js').read_text(encoding='utf-8')
        legacy = ROOT / 'beforerel/kasholkaTTS-1.7.2-Release-2-macOS-installer.zip'
        # The archived published package is used when available, never modified.
        policies = [policy]
        if not legacy.exists():
            legacy = ROOT / 'dist' / legacy.name
        if legacy.exists():
            with zipfile.ZipFile(legacy) as package:
                entry = next(n for n in package.namelist() if n.endswith('/src/update-policy.js'))
                policies.append(package.read(entry).decode('utf-8'))
        for beta, builder_name, version_path in [(False, 'build_release', 'VERSION'), (True, 'build_beta', 'beta/VERSION')]:
            with self.subTest(beta=beta), tempfile.TemporaryDirectory(dir=ROOT / 'build') as tmp:
                build = getattr(module(builder_name), builder_name)
                auto, auto_sum = build(tmp)
                manual, manual_sum = build(tmp, manual=True)
                self.assertNotEqual(auto.name, manual.name)
                self.assertTrue(manual.name.endswith('-macOS-manual-installer.zip'))
                self.assertTrue(auto.name.endswith('-macOS-installer.zip'))
                contents = []
                assets = []
                version = (ROOT / version_path).read_text().strip()
                parts = version.split()
                tag = 'v' + parts[0] + ('-beta.' + parts[2] if beta else '')
                base = 'https://github.com/muratbstr/kasholkaTTS/releases/download/' + tag + '/'
                for archive, checksum in [(manual, manual_sum), (auto, auto_sum)]:
                    original = archive.read_bytes()
                    digest = hashlib.sha256(original).hexdigest()
                    self.assertEqual(checksum.read_text().strip(), digest + '  ' + archive.name)
                    with zipfile.ZipFile(archive) as package:
                        self.assertIsNone(package.testzip())
                        self.assertTrue(all(n.startswith(archive.stem + '/') for n in package.namelist()))
                        contents.append({n.split('/', 1)[1]: (package.read(n), package.getinfo(n).external_attr) for n in package.namelist()})
                        listing = '\n'.join(package.namelist()) + '\n'
                        verify = ('var names = validateUpdateArchive(' + json.dumps(listing) + ', ' + json.dumps(archive.stem) + ', ' + json.dumps(beta) + '); return String(names.length);')
                        self.assertEqual(evaluate('(function(){' + policy + verify + '}());'), '13' if beta else '12')
                    build(tmp, manual=archive == manual)
                    self.assertEqual(archive.read_bytes(), original)
                    for p in [archive, checksum]:
                        assets.append(dict(name=p.name, size=p.stat().st_size, state='uploaded', browser_download_url=base + p.name))
                self.assertEqual(contents[0], contents[1])
                release = dict(tag_name=tag, prerelease=beta, draft=False, assets=assets)
                for source in policies:
                    for ordered in [assets, list(reversed(assets)), assets[:2]]:
                        release['assets'] = ordered
                        js = ('var r = selectUpdate(' + json.dumps([release]) + ', ' + json.dumps('1.6.1 Beta 1' if beta else '1.7.2 Release 2') + ', ' + json.dumps(beta) + '); return r ? r.name : "none";')
                        selected = evaluate('(function(){' + source + js + '}());')
                        legacy_dotted = source != policy and not beta and '.' in parts[2]
                        self.assertEqual(selected, 'none' if len(ordered) == 2 or legacy_dotted else auto.name)
                release['assets'] = assets
                for a in assets:
                    a['download_count'] = 5 if 'manual-installer.zip' == a['name'].split('macOS-')[1] else 100
                js = counter_source() + 'return String(countManualDownloads(' + json.dumps([release]) + '));'
                self.assertEqual(evaluate('(function(){' + js + '}());'), '5')


    def test_reset_counts_only_downloads_after_baseline_and_handles_removed_assets(self):
        script = counter_source() + r"""
var name = 'kasholkaTTS-1.7.4-Release-2.2-macOS-manual-installer.zip';
var releases = [{draft: false, assets: [{id: 123, name: name, state: 'uploaded', download_count: 12}]}];
var baseline = captureDownloadBaseline(releases);
if (countManualDownloads(releases) !== 12 || countManualDownloads(releases, baseline) !== 0) throw new Error('Reset failed');
releases[0].assets[0].download_count += 3;
if (countManualDownloads(releases, baseline) !== 3) throw new Error('New downloads lost');
releases[0].assets.push({id: 124, name: name, state: 'uploaded', download_count: 2});
if (countManualDownloads(releases, baseline) !== 5) throw new Error('New asset ignored');
releases[0].assets.shift();
if (countManualDownloads(releases, baseline) !== 2) throw new Error('Removed asset affected other counts');
if (countManualDownloads([], baseline) !== 0) throw new Error('Empty release reset');
var failed = false;
try { countManualDownloads(releases, {'124': -1}); } catch (e) { failed = true; }
if (!failed) throw new Error('Invalid baseline accepted');
return 'ok';
"""
        self.assertEqual(evaluate('(function(){' + script + '}());'), 'ok')
