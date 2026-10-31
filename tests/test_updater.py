"""Updater policy and process lifecycle tests; no network or real installation."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]


class UpdaterTests(unittest.TestCase):
    def test_validation_and_lifecycle(self):
        paths = ['tests/app_harness.js', 'src/kasholkaTTS.js', 'src/update-policy.js',
                 'src/updater.js', 'tests/update_cases.js']
        body = '\n'.join((ROOT / name).read_text(encoding='utf-8') for name in paths)
        results = json.loads(evaluate('(function () {\n' + body + '\nreturn JSON.stringify(testResults);\n}());'))
        self.assertGreaterEqual(len(results), 14)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    @unittest.skipUnless(sys.platform == 'darwin', 'Native updater bridge requires a Mac')
    def test_native_task_file_handles_and_archive_extraction(self):
        import zipfile
        output = ROOT / 'build'
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temporary:
            directory = Path(temporary).resolve()
            with zipfile.ZipFile(directory / 'fixture.zip', 'w') as archive:
                archive.writestr('release/src/test.js', 'test 😀')
            source = '\n'.join((ROOT / 'src' / name).read_text(encoding='utf-8') for name in
                               ['kasholkaTTS.js', 'update-policy.js', 'updater.js'])
            script = '(function () {\n' + source + '\nvar directory = ' + json.dumps(str(directory)) + ';\n' + '''
var job = { directory: directory };
updateCommand(job, '/usr/bin/unzip', ['-p', directory + '/fixture.zip', 'release/src/test.js'],
    'out.txt', 4096, 'extract');
job.task.waitUntilExit;
updateCloseHandles(job);
if (Number(job.task.terminationStatus) !== 0) throw new Error('unzip failed');
if (updateRead(directory + '/out.txt') !== 'test 😀') throw new Error('File bridge failed');
if (updateSize(directory + '/out.txt') !== 9) throw new Error('File size bridge failed');
return 'ok';
}());
'''
            result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script],
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), 'ok')

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS bash and osacompile required')
    def test_installer_and_combined_application_compile(self):
        from importlib.util import module_from_spec, spec_from_file_location
        spec = spec_from_file_location('update_beta_builder', ROOT / 'scripts/build_beta.py')
        builder = module_from_spec(spec)
        spec.loader.exec_module(builder)
        output = ROOT / 'build'
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temporary:
            for beta in (False, True):
                main = builder.beta_source() if beta else (ROOT / 'src/kasholkaTTS.js').read_text(encoding='utf-8') + builder.localization_source()
                source = main + '\n' + (ROOT / 'src/update-policy.js').read_text(encoding='utf-8') + '\n' + (builder.beta_updater_source() if beta else (ROOT / 'src/updater.js').read_text(encoding='utf-8'))
                path = Path(temporary) / ('beta.js' if beta else 'stable.js')
                path.write_text(source, encoding='utf-8')
                result = subprocess.run(['/usr/bin/osacompile', '-l', 'JavaScript', '-s', '-o',
                                         str(path.with_suffix('.app')), str(path)], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stderr)
                installer = builder.beta_installer() if beta else (ROOT / 'installer/Install kasholkaTTS.command').read_text(encoding='utf-8')
                result = subprocess.run(['/bin/bash', '-n'], input=installer, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            result = subprocess.run(['/bin/bash', '-n', str(ROOT / 'src/update-install.sh')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
