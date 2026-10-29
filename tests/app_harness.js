// AppKit test double: validates application logic, NOT the real ObjC bridge.
var registered;
var ObjC = {
    import: function () {},
    unwrap: function (value) { return value; },
    registerSubclass: function (definition) { registered = definition; }
};
var bridgedNil = { isNil: function () { return true; } };
var $ = function (value) { return arguments.length === 0 ? bridgedNil : value; };
var Ref = function () { return []; };
$.NSSpeechPitchBaseProperty = 'pitch';
$.NSSpeechImmediateBoundary = 0;
$.NSVoiceName = 'name';
$.NSVoiceLocaleIdentifier = 'locale';
$.KasholkaController = { alloc: { init: {} } };
var testResults = [];
var originalHostIO = null;

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function check(name, test) {
    try { setup(); test(); testResults.push({ name: name, passed: true }); }
    catch (error) { testResults.push({ name: name, passed: false, error: String(error) }); }
}

function fakeSynth(pitch) {
    var instance = {
        base: pitch, spoken: '', rate: 180, writable: true, startOK: true,
        isNil: function () { return false; },
        isEqual: function (other) { return this === other; },
        objectForPropertyError: function () { return this.base; },
        setObjectForPropertyError: function (value) {
            this.pitchWrites = (this.pitchWrites || 0) + 1;
            if (!this.writable) return false;
            this.base = value;
            return true;
        },
        setRate: function (value) { this.rate = value; this.rateWasSet = true; },
        startSpeakingString: function (text) { this.spoken = text; return this.startOK; },
        pauseSpeakingAtBoundary: function () { this.wasPaused = true; }
    };
    Object.defineProperty(instance, 'continueSpeaking', { get: function () { this.wasContinued = true; } });
    Object.defineProperty(instance, 'stopSpeaking', { get: function () { this.wasStopped = true; } });
    return instance;
}

function fakeAVSynth() {
    var instance = {
        isNil: function () { return false; },
        isEqual: function (other) { return this === other; },
        speakUtterance: function (utterance) { this.utterance = utterance; },
        stopSpeakingAtBoundary: function () { this.wasStopped = true; return true; },
        pauseSpeakingAtBoundary: function () { this.wasPaused = true; return this.allowPause !== false; }
    };
    Object.defineProperty(instance, 'continueSpeaking', { get: function () {
        this.wasContinued = true; return this.allowResume !== false;
    } });
    return instance;
}

function setupAboutFixture() {
    var fixture = { loaded: false, windows: 0, starts: 0, pauses: 0, disabled: 0,
        removed: 0, children: [], missing: '', failLayer: false };
    var player = {};
    Object.defineProperty(player, 'play', { get: function () { fixture.starts++; } });
    Object.defineProperty(player, 'pause', { get: function () { fixture.pauses++; } });
    fixture.player = player;
    var looper = {};
    Object.defineProperty(looper, 'disableLooping', { get: function () { fixture.disabled++; } });
    var bundle = { isNil: function () { return false; } };
    Object.defineProperty(bundle, 'load', { get: function () { fixture.loaded = true; return true; } });
    $.NSBundle = {
        bundleWithPath: function (path) {
            assert(path === '/System/Library/Frameworks/AVFoundation.framework');
            return bundle;
        },
        mainBundle: { pathForResourceOfType: function () { return { isNil: function () { return false; } }; } }
    };
    var runtimeClasses = {
        AVQueuePlayer: { alloc: { initWithItems: function (items) {
            assert(items.length === 0); return player;
        } } },
        AVPlayerItem: { playerItemWithURL: function () { return {}; } },
        AVPlayerLooper: { playerLooperWithPlayerTemplateItem: function (value) {
            assert(value === player); return looper;
        } },
        AVPlayerLayer: { playerLayerWithPlayer: function (value) {
            if (fixture.failLayer) throw new Error('Layer unavailable');
            assert(value === player); return {};
        } }
    };
    Object.keys(runtimeClasses).forEach(function (name) { delete $[name]; });
    $.NSClassFromString = function (name) {
        assert(fixture.loaded, 'Runtime lookup happened before loading the framework');
        return name === fixture.missing ? null : runtimeClasses[name];
    };
    $.NSWindow = { alloc: { initWithContentRectStyleMaskBackingDefer: function () {
        fixture.windows++;
        return { contentView: {
            bounds: { size: { width: 440, height: 330 } }, layer: {},
            addSubview: function (view) { fixture.children.push(view); },
            addSubviewPositionedRelativeTo: function (view, order) {
                assert(order === -1); fixture.children.unshift(view);
            }
        }, makeKeyAndOrderFront: function () { fixture.shown = true; } };
    } } };
    $.NSMakeRect = function (x, y, w, h) { return [x, y, w, h]; };
    $.NSWindowBelow = -1;
    $.NSURL = { fileURLWithPath: function (path) { return path; } };
    $.NSView = { alloc: { initWithFrame: function (frame) {
        var view = { frame: frame, layer: {} };
        Object.defineProperty(view, 'removeFromSuperview', { get: function () { fixture.removed++; } });
        return view;
    } } };
    $.NSVisualEffectView = $.NSView;
    $.NSAppearance = { appearanceNamed: function () { return 'dark'; } };
    $.NSTextField = { labelWithString: function (text) { return { stringValue: text }; } };
    $.NSFont = { boldSystemFontOfSize: function (size) { return size; }, systemFontOfSize: function (size) { return size; } };
    $.NSColor = { whiteColor: 'white', blackColor: 'black', colorWithCalibratedWhiteAlpha: function () { return { CGColor: 'black' }; } };
    return fixture;
}

function setup() {
    startup = null;
    wordDiagnostics = { armed: false, recording: false, header: null, events: [] };
    reading = highlightedRange = audioExport = null;
    autoScroll = true;
    if (!originalHostIO) originalHostIO = { read: readHostJSON, write: writeHostJSON, unwrap: ObjC.unwrap };
    readHostJSON = originalHostIO.read;
    writeHostJSON = originalHostIO.write;
    ObjC.unwrap = originalHostIO.unwrap;
    voiceProbe = hostSpeech = hostTimer = null;
    hostVoices = [];
    debugPitchOffsets = {};
    voiceDiagnostics = {};
    voiceInventories = {};
    active = false;
    paused = false;
    voiceBaseRate = 180;
    engine = 'ns';
    currentUtterance = null;
    about = {};
    avFoundationBundle = null;
    scale = 1;
    controller = {};
    voices = [{ id: 'voice-1', name: 'Test', locale: 'ru_RU' }];
    synth = fakeSynth(48);
    var saved = {};
    defaults = {
        objectForKey: function (key) { return saved[key]; },
        stringForKey: function (key) { return saved[key]; },
        setDoubleForKey: function (value, key) { saved[key] = value; },
        setObjectForKey: function (value, key) { saved[key] = value; }
    };
    ui = {
        play: {}, preview: {}, pause: {}, stop: {}, refresh: {}, reset: {}, open: {}, exportItem: {},
        voice: {
            indexOfSelectedItem: 0, titles: [], items: [], menu: {},
            addItemWithTitle: function (title) {
                this.titles.push(title); this.items.push({ title: title, enabled: true, tag: 0 });
            },
            selectItemAtIndex: function (index) { this.indexOfSelectedItem = index; },
            selectItemWithTag: function (tag) {
                for (var i = 0; i < this.items.length; i++) {
                    if (this.items[i].tag === tag) { this.indexOfSelectedItem = i; return true; }
                }
                return false;
            }
        },
        rate: { doubleValue: 0.5 }, rateValue: {},
        status: {}, editor: { string: '', selectedRange: { location: 0, length: 0 },
            setSelectedRange: function (range) { this.selectedRange = range; },
            scrollRangeToVisible: function (range) { this.scrolled = range; },
            layoutManager: { highlights: [], removed: [],
                addTemporaryAttributeValueForCharacterRange: function (key, value, range) {
                    this.highlights.push({ key: key, range: range });
                },
                removeTemporaryAttributeForCharacterRange: function (key, range) { this.removed.push(range); }
            }
        }
    };
    $.NSMakeRange = function (location, length) { return { location: location, length: length }; };
    $.NSMakeRect = function (x, y, width, height) { return [x, y, width, height]; };
    $.NSBackgroundColorAttributeName = 'background';
    $.NSForegroundColorAttributeName = 'foreground';
    $.NSColor = { selectedTextBackgroundColor: 'blue', selectedTextColor: 'white' };
    $.NSProcessInfo = { processInfo: { operatingSystemVersionString: 'Version 12.6.5 (test)' } };
    Object.defineProperty(ui.voice, 'removeAllItems', { get: function () { this.titles = []; this.items = []; } });
    Object.defineProperty(ui.voice, 'lastItem', { get: function () { return this.items[this.items.length - 1]; } });
    Object.defineProperty(ui.voice, 'selectedItem', { get: function () {
        return this.items.length ? this.items[this.indexOfSelectedItem] : { tag: this.indexOfSelectedItem };
    } });
    ui.voice.menu.addItem = function (item) { ui.voice.items.push(item); ui.voice.titles.push(item.title || ''); };
    ui.voice.menu.addItemWithTitleActionKeyEquivalent = function (title, action) {
        var item = { title: title, action: action, tag: 0, enabled: true };
        this.addItem(item); return item;
    };
    $.NSMenuItem = {};
    Object.defineProperty($.NSMenuItem, 'separatorItem', { get: function () {
        return { separator: true, enabled: false, tag: -1, title: '' };
    } });
    $.NSSpeechSynthesizer = {
        defaultVoice: 'voice-1',
        alloc: { initWithVoice: function () { return fakeSynth(48); } },
        availableVoices: { count: 0 },
        attributesForVoice: function (id) {
            return { objectForKey: function (key) { return key === 'name' ? 'Same name' : 'ru_RU'; } };
        }
    };
    $.AVSpeechSynthesisVoice = { speechVoices: { count: 0 } };
    $.AVSpeechSynthesizer = { alloc: {} };
    Object.defineProperty($.AVSpeechSynthesizer.alloc, 'init', { get: function () { return fakeAVSynth(); } });
    $.AVSpeechUtterance = { speechUtteranceWithString: function (text) {
        return { text: text, rate: 0.5, pitchMultiplier: 1, isEqual: function (other) { return this === other; } };
    } };
    $.AVSpeechBoundaryImmediate = 0;
}

function setupHostFixture() {
    var fixture = { files: {}, tasks: [], removed: [], directories: [], timers: [], sequence: 0 };
    ObjC.unwrap = function (value) { return value && value.nativeText !== undefined ? value.nativeText : value; };
    $.NSBundle = { mainBundle: { pathForResourceOfType: function (name, extension) {
        assert(name === 'voice-host' || name === 'voice-host-swift');
        return { nativeText: '/Applications/путь с пробелом/' + name + '.' + extension, isNil: function () { return false; } };
    } } };
    $.NSTemporaryDirectory = function () { return '/private/tmp/'; };
    $.NSUUID = {};
    Object.defineProperty($.NSUUID, 'UUID', { get: function () { return { UUIDString: 'test-' + (++fixture.sequence) }; } });
    $.NSMutableDictionary = { alloc: { init: { setObjectForKey: function (value) { fixture.permissions = value; } } } };
    $.NSData = { data: { nativeData: true, length: 0 } };
    $.NSDictionary = { dictionary: { nativeDictionary: true } };
    $.NSFileManager = { defaultManager: {
        createDirectoryAtPathWithIntermediateDirectoriesAttributesError: function (path, recursive) {
            assert(!recursive); fixture.directories.push(path); return true;
        },
        createFileAtPathContentsAttributes: function (path, contents, attributes) {
            // On the affected JXA bridge, JS null becomes NSNull rather than
            // nil. The old call crashes before either helper is launched.
            if (contents === null) throw new Error('-[NSNull writeToFile:options:error:]: unrecognized selector');
            assert(contents && contents.nativeData && contents.length === 0, 'Expected empty NSData');
            assert(attributes && attributes.nativeDictionary, 'Expected NSDictionary, not JS null');
            fixture.files[path] = ''; return true;
        },
        removeItemAtPathError: function (path) {
            fixture.removed.push(path); delete fixture.files[path]; return true;
        }
    } };
    $.rmdir = function (path) { fixture.removed.push(path); };
    $.NSFileHandle = { fileHandleWithNullDevice: {}, fileHandleForWritingAtPath: function () {
        return { isNil: function () { return false; } };
    } };
    $.NSString = { stringWithContentsOfFileEncodingError: function (path) {
        return { nativeText: fixture.files[path] || '', isNil: function () { return false; } };
    } };
    $.NSProcessInfo = { processInfo: { operatingSystemVersionString: 'Version 12.6.5 (Build test)' } };
    $.NSTask = { alloc: {} };
    Object.defineProperty($.NSTask.alloc, 'init', { get: function () {
        var task = { running: false, terminationStatus: 0 };
        Object.defineProperty(task, 'launch', { get: function () {
            if (fixture.launchFails) throw new Error('Launch failed');
            task.running = true;
        } });
        Object.defineProperty(task, 'terminate', { get: function () { task.running = false; task.stopped = true; } });
        fixture.tasks.push(task);
        return task;
    } });
    $.NSTimer = { scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats: function (seconds, target, selector) {
        assert(seconds === 0.2 && (selector === 'hostTick:' || selector === 'exportTick:'));
        var timer = {};
        Object.defineProperty(timer, 'invalidate', { get: function () { timer.invalidated = true; } });
        fixture.timers.push(timer); return timer;
    } };
    $.NSRunLoop = { mainRunLoop: { addTimerForMode: function () {} } };
    writeHostJSON = function (path, value) { fixture.files[path] = JSON.parse(JSON.stringify(value)); };
    readHostJSON = function (path) { return fixture.files[path] || null; };
    fixture.reply = function (job, result) { fixture.files[job.directory + '/result.json'] = result; };
    return fixture;
}
