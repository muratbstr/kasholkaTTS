import hashlib
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_release", ROOT / "scripts/build_release.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ReleaseTests(unittest.TestCase):
    def test_installer_archive_is_complete_and_executable_on_mac(self):
        # All test writes stay in the project, including temporary archives.
        output = ROOT / "build"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temp:
            archive, checksum = builder.build_release(temp)
            with zipfile.ZipFile(archive) as package:
                self.assertIsNone(package.testzip())
                names = package.namelist()
                self.assertEqual(len(names), 22)
                self.assertFalse(any(name.startswith("/") or ".." in name.split("/") for name in names))
                command = next(name for name in names if name.endswith(".command"))
                info = package.getinfo(command)
                self.assertEqual(info.create_system, 3)
                self.assertEqual(stat.S_IMODE(info.external_attr >> 16), 0o755)
                body = package.read(command)
                self.assertTrue(body.startswith(b"#!/bin/bash\n"))
                self.assertNotIn(b"\r", body)
                source = next(name for name in names if name.endswith("/src/kasholkaTTS.js"))
                self.assertEqual(package.read(source).decode("utf-8"),
                                 builder.application_source())
                license_entry = next(name for name in names if name.endswith("/LICENSE"))
                self.assertEqual(package.read(license_entry), (ROOT / "LICENSE").read_bytes())
                version = (ROOT / "VERSION").read_text().strip()
                self.assertIn(f"var VERSION = '{version}';", package.read(source).decode("utf-8"))
                self.assertRegex(body.decode("utf-8"), r"CFBundleShortVersionString string \d+\.\d+\.\d+\n")
                self.assertIn(f"KasholkaReleaseName string '{version}'", body.decode("utf-8"))
                self.assertIn(version.replace(' ', '-'), archive.name)
                sample = next(name for name in names if name.endswith('/samples/kasholkaTTS-long-test.txt'))
                sample_text = package.read(sample).decode('utf-8')
                self.assertEqual(sample_text, (ROOT / 'samples/kasholkaTTS-long-test.txt').read_text(encoding='utf-8'))
                self.assertGreater(len(sample_text.split()), 2000)
                self.assertNotIn(b"check-runtime.js", body)
                for filename in ('update-policy.js', 'updater.js', 'update-install.sh'):
                    entry = next(name for name in names if name.endswith('/src/' + filename))
                    self.assertEqual(package.read(entry).decode('utf-8'),
                                     (ROOT / 'src' / filename).read_text(encoding='utf-8'))
                self.assertIn(b'# kasholka-update-protocol: 1\n', body)
                self.assertIn(b'"$update_mode" == 1', body)
                helper = next(name for name in names if name.endswith("/src/voice-host.js"))
                self.assertEqual(package.read(helper).decode("utf-8"),
                                 (ROOT / "src/voice-host.js").read_text(encoding="utf-8"))
                self.assertIn(b'"$built_app/Contents/Resources/voice-host.js"', body)
                for filename in ("voice-host.swift", "voice-host-swift.sh"):
                    entry = next(name for name in names if name.endswith("/src/" + filename))
                    self.assertEqual(package.read(entry).decode("utf-8"),
                                     (ROOT / "src" / filename).read_text(encoding="utf-8"))
                    self.assertNotIn(b"\r", package.read(entry))
                    self.assertIn(('"$built_app/Contents/Resources/' + filename + '"').encode(), body)
                for asset in ("kasholkaTTS.icns", "about.mp4", "loading.png", "voicesinstalling_tutor.gif"):
                    entry = next(name for name in names if name.endswith("/assets/" + asset))
                    self.assertEqual(package.read(entry), (ROOT / "assets" / asset).read_bytes())
            self.assertEqual(checksum.read_text().split()[0], hashlib.sha256(archive.read_bytes()).hexdigest())

    def test_release_is_reproducible(self):
        output = ROOT / "build"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temp:
            archive, _ = builder.build_release(temp)
            first = archive.read_bytes()
            builder.build_release(temp)
            self.assertEqual(first, archive.read_bytes())


if __name__ == "__main__":
    unittest.main()
