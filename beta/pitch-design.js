/* Beta pitch editor. Draft changes never touch synthesis until Apply. */
var betaPitch = {view: null, controller: null, key: null, saved: null, message: ''};

function betaPitchBusy() { return !!(active || audioExport || voiceProbe || betaJob); }
function betaPitchValue() { return Math.round(clamp(betaPitch.view.slider.doubleValue, -12, 12, 0) * 10) / 10; }
function betaPitchNumber() {
    var value = betaPitchValue();
    betaPitch.view.value.stringValue = $((value > 0 ? '+' : '') + String(value));
}
function betaPitchSync() {
    var view = betaPitch.view;
    if (!view) return;
    var voice = selectedVoice(), key = voice ? voiceKey(voice) : null;
    var saved = voice ? selectedPitchOffset() : 0;
    // A voice change or an external reset invalidates the old draft.
    if (key !== betaPitch.key || saved !== betaPitch.saved) {
        betaPitch.key = key; betaPitch.saved = saved;
        view.slider.doubleValue = saved; betaPitch.message = '';
    }
    view.voice.stringValue = $(voice ? voice.name + ' · ' + voice.locale : t('Сначала выберите голос.'));
    view.voice.toolTip = view.voice.stringValue;
    var ready = !!voice && !!synth && !betaPitchBusy();
    [view.slider, view.reset, view.apply].forEach(function (item) { item.enabled = ready; });
    view.apply.contentTintColor = ready ? betaAccentTextColor() : $.NSColor.disabledControlTextColor;
    view.message.stringValue = $(betaPitchBusy() ? t('Остановите чтение, экспорт или поиск голосов, чтобы изменить высоту.') :
        !voice || !synth ? t('Сначала выберите голос.') : betaPitch.message ||
        t('Для выбранного голоса, со следующего чтения. Поддержка зависит от голоса.'));
    view.message.toolTip = view.message.stringValue;
    betaPitchNumber();
}
function betaPitchChanged() {
    betaPitch.message = '';
    betaPitchSync();
}
function betaPitchReset() {
    betaPitchSync();
    if (!betaPitch.view.apply.enabled) return;
    betaPitch.view.slider.doubleValue = 0;
    betaPitch.message = t('Естественная высота выбрана. Нажмите «Применить».');
    betaPitchSync();
}
function betaPitchApply() {
    // The main window remains usable: never apply a stale draft to another voice.
    var voice = selectedVoice(), key = voice ? voiceKey(voice) : null;
    if (key !== betaPitch.key || selectedPitchOffset() !== betaPitch.saved) { betaPitchSync(); return; }
    if (betaPitchBusy() || !voice || !synth) { betaPitchSync(); return; }
    var value = betaPitchValue();
    try {
        setDebugPitch(value);
        betaPitch.saved = selectedPitchOffset();
        betaPitch.view.slider.doubleValue = betaPitch.saved;
        betaPitch.message = value ? t('Высота изменена для следующего чтения.') : t('Естественная высота восстановлена.');
    } catch (error) {
        betaPitch.message = String(error);
    }
    betaPitchSync();
}
function betaPitchClose() {
    if (betaPitch.view) betaPitch.view.window.orderOut($());
    betaPitch.key = null; betaPitch.saved = null; betaPitch.message = '';
}
function betaPitchRegister() {
    if (betaPitch.controller) return;
    ObjC.registerSubclass({name: 'KasholkaBetaPitchWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function (sender) { betaPitchClose(); }
    }});
    ObjC.registerSubclass({name: 'KasholkaBetaPitchController', superclass: 'NSObject', methods: {
        'change:': {types: ['void', ['id']], implementation: guarded(betaPitchChanged)},
        'reset:': {types: ['void', ['id']], implementation: guarded(betaPitchReset)},
        'apply:': {types: ['void', ['id']], implementation: guarded(betaPitchApply)},
        'close:': {types: ['void', ['id']], implementation: guarded(betaPitchClose)},
        'windowShouldClose:': {types: ['bool', ['id']], implementation: function () { betaPitchClose(); return false; }}
    }});
    betaPitch.controller = $.KasholkaBetaPitchController.alloc.init;
}
function betaPitchShow() {
    betaPitchRegister();
    if (!betaPitch.view) {
        var window = $.KasholkaBetaPitchWindow.alloc.initWithContentRectStyleMaskBackingDefer(
            $.NSMakeRect(0, 0, 440, 292), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
        window.title = $(t('Высота голоса'));
        window.releasedWhenClosed = false; window.delegate = betaPitch.controller;
        var close = window.standardWindowButton($.NSWindowCloseButton);
        close.target = betaPitch.controller; close.action = 'close:';
        var content = window.contentView;
        function label(text, x, y, width, height) {
            var item = $.NSTextField.wrappingLabelWithString($(text));
            item.frame = $.NSMakeRect(x, y, width, height);
            item.font = $.NSFont.systemFontOfSize(13); content.addSubview(item); return item;
        }
        var heading = label(t('Экспериментальная настройка'), 24, 248, 392, 22);
        heading.textColor = $.NSColor.secondaryLabelColor;
        label(t('Голос'), 24, 210, 68, 24);
        var voice = label('', 96, 208, 320, 36);
        var slider = $.NSSlider.alloc.initWithFrame($.NSMakeRect(24, 156, 326, 28));
        slider.minValue = -12; slider.maxValue = 12; slider.doubleValue = 0;
        slider.numberOfTickMarks = 5; slider.allowsTickMarkValuesOnly = false;
        slider.continuous = true; slider.target = betaPitch.controller; slider.action = 'change:';
        slider.setAccessibilityLabel($(t('Высота голоса')));
        try { slider.trackFillColor = betaAccentColor(); } catch (unavailable) {}
        content.addSubview(slider);
        var value = label('0', 360, 158, 56, 24); value.alignment = $.NSTextAlignmentRight;
        label('−12', 24, 132, 48, 20);
        var natural = label('0', 165, 132, 44, 20); natural.alignment = $.NSTextAlignmentCenter;
        var high = label('+12', 302, 132, 48, 20); high.alignment = $.NSTextAlignmentRight;
        var message = label('', 24, 70, 392, 48); message.textColor = $.NSColor.secondaryLabelColor;
        var reset = betaDesignMakeButton(content, t('Сбросить'), 'reset:', betaPitch.controller, $.NSMakeRect(24, 24, 112, 34));
        var cancel = betaDesignMakeButton(content, t('Закрыть'), 'close:', betaPitch.controller, $.NSMakeRect(146, 24, 116, 34));
        var apply = betaDesignMakeButton(content, t('Применить'), 'apply:', betaPitch.controller, $.NSMakeRect(272, 24, 144, 34));
        apply.tag = 1001; apply.keyEquivalent = $('\r');
        betaPitch.view = {window: window, voice: voice, slider: slider, value: value, message: message,
            reset: reset, cancel: cancel, apply: apply};
        betaDesignWindow(window); window.center;
    }
    // Repeated menu activation should keep an unsaved draft in an already open window.
    if (!betaPitch.view.window.visible) { betaPitch.key = null; betaPitch.saved = null; betaPitch.message = ''; }
    betaPitchSync(); betaPitch.view.window.makeKeyAndOrderFront($());
}
showDebugPitch = betaPitchShow;
var betaPitchOldControls = updateControls;
updateControls = function () { betaPitchOldControls(); betaPitchSync(); };

var betaPitchOldReset = reset;
reset = function () { betaPitchOldReset(); betaPitchSync(); };
