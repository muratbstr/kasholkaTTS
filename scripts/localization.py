"""Compile translation catalogs into the existing app payload (update protocol 1)."""
import ast
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
UI_SOURCES = ['src/kasholkaTTS.js', 'src/updater.js', 'src/update-policy.js', 'beta/experiments.js', 'src/localization.js']
HELPER_SOURCES = ['src/voice-host.js', 'src/voice-host.swift', 'src/voice-host-swift.sh', 'beta/probe.js']
PREVIEW_RU = 'Привет! Так звучит мой голос. Один, два, три. Приятного прослушивания!'
TOKENS = re.compile(r'''//[^\n]*|/\*[\s\S]*?\*/|'(?:\\.|[^'\\\r\n])*'|"(?:\\.|[^"\\\r\n])*"''')


def russian_literals(source):
    for match in TOKENS.finditer(source):
        token = match.group()
        if token[0] not in "'\"" or not re.search('[А-Яа-яЁё]', token):
            continue
        value = ast.literal_eval(token)
        if value != PREVIEW_RU:
            yield match, value


def localization_source():
    catalogs = {}
    for path in sorted((ROOT / 'locales').glob('*.json')):
        catalog = json.loads(path.read_text(encoding='utf-8'))
        if (not re.fullmatch('[a-z]{2}', path.stem) or not isinstance(catalog.get('messages'), dict)
                or not isinstance(catalog.get('name'), str) or not catalog['name'].strip()):
            raise ValueError(f'Invalid locale: {path}')
        if any(not isinstance(value, str) or not value for value in catalog['messages'].values()):
            raise ValueError(f'Invalid translation: {path}')
        for key, value in catalog['messages'].items():
            fields = lambda text: set(re.findall(r'\{([A-Za-z][A-Za-z0-9_]*)\}', text))
            if fields(key) != fields(value):
                raise ValueError(f'Placeholder mismatch in {path}: {key}')
        catalogs[path.stem] = catalog
    required = {value for relative in UI_SOURCES + HELPER_SOURCES
                for _, value in russian_literals((ROOT / relative).read_text(encoding='utf-8'))}
    # The Russian source strings are the source catalog and the fallback.
    if 'en' not in catalogs:
        raise ValueError('English catalog is required')
    missing = required - catalogs['en']['messages'].keys()
    if missing:
        raise ValueError('Missing English translations: ' + repr(sorted(missing)))
    runtime = (ROOT / 'src/localization.js').read_text(encoding='utf-8')
    return '\nvar UI_CATALOGS = ' + json.dumps(catalogs, ensure_ascii=False, sort_keys=True) + ';\n' + runtime


def application_source():
    return (ROOT / 'src/kasholkaTTS.js').read_text(encoding='utf-8') + localization_source()
