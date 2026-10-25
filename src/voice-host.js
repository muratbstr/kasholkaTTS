/* Runs in Apple's /usr/bin/osascript, not in the locally signed applet.
 * Public AVFoundation only. No downloads, private APIs, or guessed voice IDs.
 * All IPC is JSON in a private, per-job temporary directory.
 */
ObjC.import('Foundation');
ObjC.import('AVFoundation');

var hostDirectory = '', hostSynth = null, hostUtterance = null, hostDelegate = null;
var hostDone = false, hostStarted = false, hostState = '', hostFramework = null;
var hostWordRange = null, hostReportedRange = null;

function hostClass(name) {
    var klass = $[name];
    if (klass && !(klass.isNil && klass.isNil())) return klass;
    hostFramework = $.NSBundle.bundleWithPath($('/System/Library/Frameworks/AVFoundation.framework'));
    if (!hostFramework || hostFramework.isNil() || !hostFramework.load) throw new Error('AVFoundation недоступен.');
    klass = $.NSClassFromString($(name));
    if (!klass || klass.isNil && klass.isNil()) throw new Error('Класс недоступен: ' + name);
    return klass;
}

function hostRead(name) {
    var text = $.NSString.stringWithContentsOfFileEncodingError(
        $(hostDirectory + '/' + name + '.json'), $.NSUTF8StringEncoding, Ref());
    if (!text || text.isNil()) throw new Error('Нет данных от приложения.');
    return JSON.parse(ObjC.unwrap(text));
}

function hostReport(value) {
    if (!$(JSON.stringify(value)).writeToFileAtomicallyEncodingError(
        $(hostDirectory + '/result.json'), true, $.NSUTF8StringEncoding, Ref())) {
        throw new Error('Приложение закрыло сеанс.');
    }
    hostState = value.state;
}

function hostInventory() {
    var nativeVoices = hostClass('AVSpeechSynthesisVoice').speechVoices;
    var result = [];
    for (var i = 0; i < Number(nativeVoices.count); i++) {
        var voice = nativeVoices.objectAtIndex(i);
        result.push({ id: ObjC.unwrap(voice.identifier), name: ObjC.unwrap(voice.name),
            locale: ObjC.unwrap(voice.language) });
    }
    return result;
}

function hostStart(request) {
    hostWordRange = hostReportedRange = null;
    if (typeof request.id !== 'string' || typeof request.text !== 'string' || !request.text.trim()) {
        throw new Error('Некорректный запрос чтения.');
    }
    var voice = hostClass('AVSpeechSynthesisVoice').voiceWithIdentifier($(request.id));
    if (!voice || voice.isNil()) throw new Error('Выбранный голос недоступен помощнику. Нажмите «Обновить».');
    ObjC.registerSubclass({
        name: 'KasholkaVoiceHostDelegate', superclass: 'NSObject', methods: {
            'speechSynthesizer:willSpeakRangeOfSpeechString:utterance:': {
                types: ['void', ['id', 'NSRange', 'id']], implementation: function (sender, range) {
                    hostWordRange = { location: Number(range.location), length: Number(range.length) };
                }
            },
            'speechSynthesizer:didStartSpeechUtterance:': {
                types: ['void', ['id', 'id']], implementation: function () { hostStarted = true; }
            },
            'speechSynthesizer:didFinishSpeechUtterance:': {
                types: ['void', ['id', 'id']], implementation: function () { hostDone = true; }
            },
            'speechSynthesizer:didCancelSpeechUtterance:': {
                types: ['void', ['id', 'id']], implementation: function () {
                    hostState = 'cancelled'; hostDone = true;
                }
            }
        }
    });
    hostDelegate = $.KasholkaVoiceHostDelegate.alloc.init;
    hostSynth = hostClass('AVSpeechSynthesizer').alloc.init;
    hostSynth.delegate = hostDelegate;
    hostUtterance = hostClass('AVSpeechUtterance').speechUtteranceWithString($(request.text));
    hostUtterance.voice = voice;
    var pitch = Number(request.pitch);
    if (isFinite(pitch) && pitch !== 1) hostUtterance.pitchMultiplier = Math.max(0.5, Math.min(2, pitch));
    var factor = Number(request.factor);
    if (!isFinite(factor)) factor = 1;
    factor = Math.max(0.5, Math.min(2, factor));
    var naturalRate = Number(hostUtterance.rate);
    if (!isFinite(naturalRate) || naturalRate <= 0) naturalRate = 0.5;
    hostUtterance.rate = Math.max(0.1, Math.min(1, naturalRate * factor));
    hostSynth.speakUtterance(hostUtterance);
}

function hostControl(control) {
    if (!control || !isFinite(control.time) || Date.now() - control.time > 15000) {
        throw new Error('Приложение больше не отвечает.');
    }
    if (control.command === 'pause' && hostStarted && !hostSynth.paused) hostSynth.pauseSpeakingAtBoundary(0);
    if (control.command === 'play' && hostSynth.paused) hostSynth.continueSpeaking;
    if (hostStarted) {
        var state = hostSynth.paused ? 'paused' : 'speaking';
        if (state !== hostState || hostWordRange !== hostReportedRange) {
            hostReport({ state: state, range: hostWordRange });
            hostReportedRange = hostWordRange;
        }
    }
}

function run(args) {
    if (args.length !== 2 || (args[0] !== 'list' && args[0] !== 'speak')) throw new Error('Некорректный режим помощника.');
    hostDirectory = String(args[1]);
    try {
        if (args[0] === 'list') {
            hostReport({ state: 'voices', voices: hostInventory() });
            return;
        }
        hostStart(hostRead('request'));
        var deadline = Date.now() + 15000;
        while (!hostDone) {
            hostControl(hostRead('control'));
            if (!hostStarted && Date.now() > deadline) throw new Error('Голос не начал чтение за 15 секунд.');
            $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
        }
        if (hostState === 'cancelled') throw new Error('Система прервала чтение.');
        hostReport({ state: 'finished' });
    } catch (error) {
        try { hostReport({ state: 'error', message: String(error) }); } catch (closed) {}
    } finally {
        if (hostSynth) {
            hostSynth.delegate = null;
            hostSynth.stopSpeakingAtBoundary(0);
        }
    }
}
