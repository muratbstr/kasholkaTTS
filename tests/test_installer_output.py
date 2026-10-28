"""Exercise early installer failure without touching an installed application."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == 'darwin', 'Installer execution requires macOS')
class InstallerOutputTests(unittest.TestCase):
    def test_missing_package_shows_only_stage_and_localized_error_with_log(self):
        output = ROOT / 'build'
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temporary:
            work = Path(temporary).resolve()
            installer = work / 'Install.command'
            installer.write_text((ROOT / 'installer/Install kasholkaTTS.command').read_text(encoding='utf-8'), encoding='utf-8')
            # Deliberately no src/ or assets/: the script must stop before installation.
            fake_home = work / 'home'
            fake_home.mkdir()
            env = dict(os.environ, HOME=str(fake_home), TMPDIR=str(work))
            for language, stage, error, log_label in [
                ('ru', '[1/6] Проверка установки…', 'Ошибка:', 'Журнал:'),
                ('eng', '[1/6] Checking installation…', 'Error:', 'Log:'),
            ]:
                with self.subTest(language=language):
                    result = subprocess.run(['/bin/bash', str(installer), '--update', '--lang', language],
                                            env=env, capture_output=True, text=True, timeout=30)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout.strip(), stage)
                    self.assertIn(error, result.stderr)
                    self.assertIn(log_label, result.stderr)
                    log_line = next(line for line in result.stderr.splitlines() if line.startswith(log_label))
                    log = Path(log_line.split(': ', 1)[1])
                    self.assertEqual(log.parent, work)
                    self.assertTrue(log.read_text(encoding='utf-8').strip())
                    self.assertFalse((fake_home / 'Applications').exists())
