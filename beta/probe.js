/* Beta-only, read-only probe hosted in Apple's osascript. No invented IDs,
 * preference writes, private frameworks or changes to downloaded voices. */
ObjC.import('Cocoa');
ObjC.import('AVFoundation');

function betaSiriID(value) {
    return typeof value === 'string' && value.length <= 512 &&
        /^com\.apple\./.test(value) && /(^|[._-])siri([._-]|$)/i.test(value);
}

function betaCollectIDs(value) {
    var found = [], seen = {}, budget = 2048;
    function visit(item, depth) {
        if (--budget < 0 || depth > 8 || found.length >= 32) return;
        if (typeof item === 'string') {
            if (betaSiriID(item) && !seen[item]) { seen[item] = true; found.push(item); }
        } else if (Array.isArray(item)) {
            item.slice(0, 64).forEach(function (entry) { visit(entry, depth + 1); });
        } else if (item && typeof item === 'object') {
            Object.keys(item).slice(0, 64).forEach(function (key) {
                visit(key, depth + 1); visit(item[key], depth + 1);
            });
        }
    }
    visit(value, 0);
    return found;
}

function betaResolveCandidates(candidates, voiceClass) {
    var voices = [], attempts = [], seen = {};
    function inspect(requested, voice, source, exact) {
        if (!voice || voice.isNil()) {
            attempts.push({ source: source, requested: requested, result: 'unavailable' }); return;
        }
        var id = String(ObjC.unwrap(voice.identifier));
        var match = !exact || requested === id;
        var siri = betaSiriID(id);
        attempts.push({ source: source, requested: requested, returned: id,
            result: !match ? 'substituted' : siri ? 'resolved-siri-id' : 'ordinary-voice' });
        if (match && siri && !seen[id]) {
            seen[id] = true;
            voices.push({ id: id, name: String(ObjC.unwrap(voice.name)),
                locale: String(ObjC.unwrap(voice.language)), backend: 'osascript' });
        }
    }
    candidates.slice(0, 32).forEach(function (id) {
        if (!betaSiriID(id)) return;
        try { inspect(id, voiceClass.voiceWithIdentifier($(id)), 'preferences-id', true); }
        catch (error) { attempts.push({ requested: id, result: 'error', message: String(error) }); }
    });
    ['ru-RU', 'en-US', 'en-GB'].forEach(function (locale) {
        try { inspect(locale, voiceClass.voiceWithLanguage($(locale)), 'language-default', false); }
        catch (error) { attempts.push({ requested: locale, result: 'error', message: String(error) }); }
    });
    return { voices: voices, attempts: attempts };
}

function betaReadVoicePreferences() {
    var values = [], sources = [], preferences = $.NSUserDefaults.standardUserDefaults;
    ['com.apple.Accessibility', 'com.apple.speech.voice.prefs'].forEach(function (name) {
        try {
            var domain = preferences.persistentDomainForName($(name));
            if (!domain || domain.isNil()) { sources.push({ domain: name, result: 'absent' }); return; }
            var keys = domain.allKeys, count = 0;
            for (var i = 0; i < Number(keys.count); i++) {
                var key = keys.objectAtIndex(i), text = String(ObjC.unwrap(key));
                if (!/voice|speech|tts/i.test(text)) continue;
                values.push(ObjC.deepUnwrap(domain.objectForKey(key))); count++;
            }
            sources.push({ domain: name, voiceKeys: count });
        } catch (error) { sources.push({ domain: name, error: String(error) }); }
    });
    return { candidates: betaCollectIDs(values), sources: sources };
}

function run(args) {
    if (args.length !== 1) throw new Error('Expected private result directory.');
    var report;
    try {
        var preferences = betaReadVoicePreferences();
        var bundle = $.NSBundle.bundleWithPath($('/System/Library/Frameworks/AVFoundation.framework'));
        if (!bundle || bundle.isNil() || !bundle.load) throw new Error('AVFoundation недоступен.');
        var klass = $.NSClassFromString($('AVSpeechSynthesisVoice'));
        if (!klass || klass.isNil()) throw new Error('AVSpeechSynthesisVoice недоступен.');
        var resolved = betaResolveCandidates(preferences.candidates, klass);
        report = { state: 'voices', voices: resolved.voices, report: {
            sources: preferences.sources, candidates: preferences.candidates, attempts: resolved.attempts,
            note: 'Resolved ID is not proof of audible Siri. Preview and compare with Spoken Content.'
        } };
    } catch (error) { report = { state: 'error', message: String(error) }; }
    if (!$(JSON.stringify(report)).writeToFileAtomicallyEncodingError(
        $(String(args[0]) + '/result.json'), true, $.NSUTF8StringEncoding, Ref())) {
        throw new Error('Не удалось записать отчёт Beta.');
    }
}
