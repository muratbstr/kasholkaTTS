import json
from pathlib import Path
import unittest

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]


class ApplicationLogicTests(unittest.TestCase):
    def test_javascript_syntax_and_speech_state_transitions(self):
        paths = [ROOT / "tests/app_harness.js", ROOT / "src/kasholkaTTS.js", ROOT / "tests/app_cases.js"]
        # Local scope shadows JXA's built-in ObjC/$ and prevents the production
        # run() handler from being launched by the macOS OSA test host.
        body = "\n".join(path.read_text(encoding="utf-8") for path in paths)
        script = "(function () {\n" + body + "\nreturn JSON.stringify(testResults);\n}());"
        try:
            results = json.loads(evaluate(script))
        except NotImplementedError as error:
            self.skipTest(str(error))
        self.assertGreaterEqual(len(results), 63)
        for result in results:
            with self.subTest(case=result["name"]):
                self.assertTrue(result["passed"], result.get("error"))

    def test_voice_host_ipc_and_lifecycle(self):
        paths = [ROOT / "tests/app_harness.js", ROOT / "src/voice-host.js", ROOT / "tests/host_cases.js"]
        body = "\n".join(path.read_text(encoding="utf-8") for path in paths)
        script = "(function () {\n" + body + "\nreturn JSON.stringify(testResults);\n}());"
        try:
            results = json.loads(evaluate(script))
        except NotImplementedError as error:
            self.skipTest(str(error))
        self.assertEqual(len(results), 8)
        for result in results:
            with self.subTest(case=result["name"]):
                self.assertTrue(result["passed"], result.get("error"))


if __name__ == "__main__":
    unittest.main()
