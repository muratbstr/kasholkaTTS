"""Native interpreter smoke test; deliberately skipped on Windows."""
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == "darwin", "Swift/AVFoundation requires a Mac")
class NativeSwiftHostTests(unittest.TestCase):
    def test_swift_exports_real_audio_without_speaker_playback(self):
        output = ROOT / "build"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as folder:
            directory = Path(folder)
            command = ["/bin/bash", str(ROOT / "src/voice-host-swift.sh"),
                       str(ROOT / "src/voice-host.swift")]
            inventory = subprocess.run(command + ["list", folder], capture_output=True, text=True, timeout=65)
            if inventory.returncode == 3:
                self.skipTest(inventory.stderr.strip())
            self.assertEqual(inventory.returncode, 0, inventory.stderr)
            voices = json.loads((directory / "result.json").read_text())["voices"]
            if not voices:
                self.skipTest("No installed AVFoundation voices")
            voice = next((v for v in voices if v["locale"].startswith("en")), voices[0])
            audio = directory / "speech.caf"
            (directory / "request.json").write_text(json.dumps({
                "id": voice["id"], "text": "This is an audio export test.",
                "factor": 1, "pitch": 1, "output": str(audio),
            }), encoding="utf-8")
            closed = threading.Event()

            def heartbeat():
                while True:
                    temporary = directory / "control.next"
                    temporary.write_text(json.dumps({"command": "play", "time": time.time() * 1000}), encoding="utf-8")
                    temporary.replace(directory / "control.json")
                    if closed.wait(1):
                        break

            # Renew the lease during the interpreter's first module load too.
            worker = threading.Thread(target=heartbeat)
            worker.start()
            try:
                result = subprocess.run(command + ["export", folder], capture_output=True, text=True, timeout=100)
            finally:
                closed.set()
                worker.join()
            response = json.loads((directory / "result.json").read_text())
            self.assertEqual(result.returncode, 0, result.stderr + str(response))
            self.assertEqual(response["state"], "finished")
            data = audio.read_bytes()
            self.assertEqual(data[:4], b"caff")
            self.assertGreater(len(data), 1024)

    def test_interpreted_swift_returns_real_voice_inventory(self):
        output = ROOT / "build"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as session:
            result = subprocess.run(
                ["/bin/bash", str(ROOT / "src/voice-host-swift.sh"),
                 str(ROOT / "src/voice-host.swift"), "list", session],
                capture_output=True, text=True, timeout=65,
            )
            if result.returncode == 3:
                self.skipTest(result.stderr.strip())
            self.assertEqual(result.returncode, 0, result.stderr)
            response = json.loads((Path(session) / "result.json").read_text(encoding="utf-8"))
            self.assertEqual(response["state"], "voices")
            self.assertIsInstance(response["voices"], list)
            for voice in response["voices"]:
                self.assertTrue(voice["id"])
                self.assertIsInstance(voice["name"], str)
                self.assertIsInstance(voice["locale"], str)
