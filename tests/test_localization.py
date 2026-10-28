import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('locale_builder', ROOT / 'scripts/localization.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class LocalizationTests(unittest.TestCase):
    def test_language_selection_translation_and_session_preservation(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8')
        body += '\n' + builder.application_source()
        body += '\n' + (ROOT / 'tests/localization_cases.js').read_text(encoding='utf-8')
        results = json.loads(evaluate('(function () {\n' + body + '\nreturn JSON.stringify(testResults);\n}());'))
        self.assertEqual(len(results), 6)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    def test_catalog_covers_every_ui_literal_and_wraps_it_explicitly(self):
        builder.localization_source()  # fails on missing/empty translations or mismatched placeholders
        for relative in builder.UI_SOURCES:
            body = (ROOT / relative).read_text(encoding='utf-8')
            for match, key in builder.russian_literals(body):
                with self.subTest(file=relative, key=key):
                    self.assertRegex(body[:match.start()], r'(?:\bt|\bupdateText)\($')
        catalog = json.loads((ROOT / 'locales/en.json').read_text(encoding='utf-8'))
        self.assertGreater(len(catalog['messages']), 300)
        for value in catalog['messages'].values():
            self.assertIsNone(re.search('[А-Яа-яЁё]', value), value)

    @unittest.skipUnless(sys.platform == 'darwin', 'Native AppKit localization requires a Mac')
    def test_native_language_menu_action_and_system_language_bridge(self):
        script = '(function () {\n' + builder.application_source() + '\n' + '''
var saved = {};
defaults = {objectForKey: function (key) {return saved[ObjC.unwrap(key)];},
    setObjectForKey: function (value, key) {saved[ObjC.unwrap(key)] = ObjC.unwrap(value);}, synchronize: true};
initLocalization();
if (uiLanguage !== 'ru' && uiLanguage !== 'en') throw new Error('System language resolution failed');
uiLanguage = 'en';
alertUser = function () {};
var menu = $.NSMenu.alloc.initWithTitle($('Test'));
installLanguageMenu(menu);
if (ObjC.unwrap(menu.itemAtIndex(0).title) !== 'Language') throw new Error('Menu not translated');
var item = menu.itemAtIndex(0).submenu.itemAtIndex(2);
languageSettings.controller.uiLanguage(item);
if (saved.uiLanguage !== 'en') throw new Error('Native selector failed');
return 'ok';
}());
'''
        result = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', '-e', script],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')
