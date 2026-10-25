"""Exercise the actual Foundation bridge; mocks cannot establish compatibility."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform == "darwin", "Native JXA/Foundation requires a Mac")
class NativeJXATests(unittest.TestCase):
    def test_native_popup_language_headers_and_voice_tags(self):
        source = (ROOT / "src/kasholkaTTS.js").read_text(encoding="utf-8")
        script = "(function () {\n" + source + "\n" + """
ui.voice = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(0, 0, 400, 30), false);
voices = [{id: 'ru', name: 'Same', locale: 'ru_RU', engine: 'ns'},
          {id: 'en', name: 'Same', locale: 'en-US', engine: 'ns'}];
// Isolate native menu behavior from speech and application preferences.
var selected;
selectVoice = function () { selected = selectedVoice(); };
populateVoices('en', false);
if (Number(ui.voice.numberOfItems) !== 5 || selected.id !== 'en') throw new Error('Selection mapping failed');
var header = ui.voice.itemAtIndex(0);
if (header.enabled || Number(header.tag) !== -1) throw new Error('Heading is selectable');
ui.voice.selectItemAtIndex(1);
if (selectedVoice().id !== 'ru' || Number(ui.voice.selectedItem.indentationLevel) !== 0) throw new Error('Voice tag failed');
return 'ok';
}());
"""
        result = subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", "-e", script],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ok")

    def test_word_callback_structs_and_temporary_text_attributes(self):
        source = (ROOT / "src/kasholkaTTS.js").read_text(encoding="utf-8")
        script = "(function () {\n" + source + "\n" + """
registerController();
ui.editor = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, 400, 200));
ui.editor.string = $('До 😀 слово');
synth = $.NSObject.alloc.init;
active = true;
autoScroll = false;
reading = {offset: 3, length: 8};
controller.speechSynthesizerWillSpeakWordOfString(synth, $.NSMakeRange(3, 5), $('😀 слово'));
if (!highlightedRange || Number(highlightedRange.location) !== 6) throw new Error('NSRange bridge failed');
currentUtterance = $.NSObject.alloc.init;
controller.speechSynthesizerWillSpeakRangeOfSpeechStringUtterance(synth, $.NSMakeRange(0, 2), currentUtterance);
if (Number(highlightedRange.location) !== 3) throw new Error('AV NSRange bridge failed');
endReading();
if (highlightedRange) throw new Error('Highlight was not cleared');
return 'ok';
}());
"""
        result = subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", "-e", script],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "ok")

    def test_host_log_is_empty_and_accepts_stderr_data(self):
        output = ROOT / "build"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as session:
            path = Path(session) / "stderr.txt"
            source = (ROOT / "src/kasholkaTTS.js").read_text(encoding="utf-8")
            # Local run() stays local: loading the source must not launch the UI.
            script = "(function () {\n" + source + "\nvar path = " + json.dumps(str(path)) + ";\n" + """
var handle = createHostLog(path);
try {
    if (readHostText(path) !== '') throw new Error('Log was not empty');
    handle.writeData($('host stderr test').dataUsingEncoding($.NSUTF8StringEncoding));
} finally { handle.closeFile; }
return readHostText(path);
}());
"""
            result = subprocess.run(
                ["/usr/bin/osascript", "-l", "JavaScript", "-e", script],
                capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout.strip(), "host stderr test")
            self.assertEqual(path.read_text(encoding="utf-8"), "host stderr test")
