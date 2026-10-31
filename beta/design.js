/* Beta-only design milestone 1. Loaded after experiments and localization.
 * Native AppKit controls keep speech and export ownership in the existing code.
 */
var betaDesign = { controller: null, settings: null, buttonCellReady: false, buttons: [] };

var betaAccentRGB = [0, 64 / 255, 1];
function betaAccentPresets() {
    return [
        {name: t('Beta — синий'), rgb: [0, 64 / 255, 1]},
        {name: t('kasholkaTTS — зелёный'), rgb: [0, 1, 0]},
        {name: t('Фиолетовый'), rgb: [0.52, 0.25, 0.90]},
        {name: t('Оранжевый'), rgb: [1, 0.49, 0]},
        {name: t('Розовый'), rgb: [0.92, 0.24, 0.54]},
        {name: t('Красный'), rgb: [0.90, 0.19, 0.19]}
    ];
}
function betaAccentValid(rgb) {
    return Array.isArray(rgb) && rgb.length === 3 && rgb.every(function (v) {
        return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
    });
}
function betaAccentLoad() {
    var value;
    try { value = JSON.parse(unwrap(defaults.objectForKey($('betaAccentRGB')), 'null')); } catch (invalid) {}
    betaAccentRGB = betaAccentValid(value) ? value : [0, 64 / 255, 1];
}
function betaAccentColor() {
    return $.NSColor.colorWithSRGBRedGreenBlueAlpha(betaAccentRGB[0], betaAccentRGB[1], betaAccentRGB[2], 1);
}
function betaAccentDarkText(rgb) {
    var linear = rgb.map(function (v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722 > 0.179;
}
function betaAccentTextColor() { return betaAccentDarkText(betaAccentRGB) ? $.NSColor.blackColor : $.NSColor.whiteColor; }
function betaAccentSync() {
    var settings = betaDesign.settings;
    if (settings && settings.accentPreset) {
        var selected = betaAccentPresets().length;
        betaAccentPresets().forEach(function (preset, i) {
            if (preset.rgb.every(function (v, n) { return Math.abs(v - betaAccentRGB[n]) < 0.001; })) selected = i;
        });
        settings.accentPreset.selectItemAtIndex(selected);
        settings.accentWell.color = betaAccentColor();
    }
}
function betaAccentApply(rgb) {
    if (!betaAccentValid(rgb)) return;
    betaAccentRGB = rgb.slice();
    defaults.setObjectForKey($(JSON.stringify(betaAccentRGB)), $('betaAccentRGB'));
    betaDesign.buttons.forEach(function (button) {
        if (Number(button.tag) === 1001) button.contentTintColor = button.enabled ? betaAccentTextColor() : $.NSColor.disabledControlTextColor;
        button.needsDisplay = true;
    });
    try { if (ui.rate) ui.rate.trackFillColor = betaAccentColor(); } catch (unavailable) {}
    try { if (typeof betaPitch !== 'undefined' && betaPitch.view) betaPitch.view.slider.trackFillColor = betaAccentColor(); } catch (unavailable) {}
    var settings = betaDesign.settings;
    [settings && settings.theme, settings && settings.language,
        typeof betaExport !== 'undefined' && betaExport.view && betaExport.view.format,
        typeof betaDiagnostic !== 'undefined' && betaDiagnostic.view && betaDiagnostic.view.tabs].forEach(function (control) {
        if (control) try { control.selectedSegmentBezelColor = betaAccentColor(); } catch (unavailable) {}
    });
    if (highlightedRange && ui.editor) {
        ui.editor.layoutManager.addTemporaryAttributeValueForCharacterRange(
            $.NSBackgroundColorAttributeName, betaAccentColor().colorWithAlphaComponent(0.24), highlightedRange);
    }
    betaAccentSync();
}

// Own bezel drawing; AppKit still handles hit testing, keyboard focus,
// accessibility, titles, images and enabled/pressed state.
function betaDesignButtonPalette(dark, primary, pressed, enabled) {
    if (!enabled) return dark ? {top: [0.22, 0.23, 0.25], bottom: [0.19, 0.20, 0.22], border: [0.29, 0.30, 0.32]} :
        {top: [0.96, 0.96, 0.97], bottom: [0.93, 0.93, 0.94], border: [0.84, 0.85, 0.87]};
    if (primary) {
        var base = betaAccentRGB;
        return {top: base.map(function (v) {return pressed ? v * 0.82 : v + (1 - v) * 0.10;}),
            bottom: base.map(function (v) {return pressed ? v * 0.78 : v;}),
            border: base.map(function (v) {return v * 0.80;})};
    }
    if (dark) return pressed ? {top: [0.18, 0.19, 0.21], bottom: [0.22, 0.23, 0.25], border: [0.42, 0.44, 0.48]} :
        {top: [0.30, 0.31, 0.34], bottom: [0.23, 0.24, 0.27], border: [0.43, 0.45, 0.49]};
    return pressed ? {top: [0.86, 0.88, 0.92], bottom: [0.92, 0.94, 0.97], border: [0.63, 0.68, 0.76]} :
        {top: [1, 1, 1], bottom: [0.95, 0.95, 0.96], border: [0.79, 0.80, 0.82]};
}

function betaDesignDrawBezel(cell, frame, view) {
    var appearance = view.effectiveAppearance.bestMatchFromAppearancesWithNames(
        $([$.NSAppearanceNameAqua, $.NSAppearanceNameDarkAqua]));
    var dark = unwrap(appearance, '') === unwrap($.NSAppearanceNameDarkAqua, 'NSAppearanceNameDarkAqua');
    var palette = betaDesignButtonPalette(dark, Number(view.tag) === 1001, !!cell.highlighted, !!cell.enabled);
    function color(rgb) { return $.NSColor.colorWithCalibratedRedGreenBlueAlpha(rgb[0], rgb[1], rgb[2], 1); }
    var inset = 1, radius = Math.min(7, Number(frame.size.height) / 5);
    var rect = $.NSMakeRect(Number(frame.origin.x) + inset, Number(frame.origin.y) + inset,
        Number(frame.size.width) - 2 * inset, Number(frame.size.height) - 2 * inset);
    var path = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(rect, radius, radius);
    var gradient = $.NSGradient.alloc.initWithStartingColorEndingColor(color(palette.top), color(palette.bottom));
    gradient.drawInBezierPathAngle(path, view.flipped ? 90 : -90);
    color(palette.border).setStroke;
    path.lineWidth = 1;
    path.stroke;
}

function betaDesignRegisterButtonCell() {
    if (betaDesign.buttonCellReady) return;
    // These selectors already exist in AppKit. Let JXA inherit their exact
    // runtime encodings (including the platform's NSRect/CGRect encoding).
    // Explicit types can fail registration with "method types do not match".
    // New controller actions below still require their own type declarations.
    ObjC.registerSubclass({ name: 'KasholkaBetaButtonCell', superclass: 'NSButtonCell', methods: {
        'drawBezelWithFrame:inView:': function (frame, view) {
            try { betaDesignDrawBezel(this, frame, view); }
            catch (unavailable) { ObjC.super(this).drawBezelWithFrameInView(frame, view); }
        }
    } });
    ObjC.registerSubclass({ name: 'KasholkaBetaSettingsWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function (sender) { betaDesignCloseSettings(); }
    } });
    betaDesign.buttonCellReady = true;
}

function betaDesignMakeButton(parent, title, selector, target, frame) {
    betaDesignRegisterButtonCell();
    var button = $.NSButton.alloc.initWithFrame(frame);
    button.cell = $.KasholkaBetaButtonCell.alloc.initTextCell($(title));
    button.setButtonType($.NSButtonTypeMomentaryPushIn);
    button.bezelStyle = $.NSBezelStyleRegularSquare;
    button.bordered = true;
    button.alignment = $.NSTextAlignmentCenter;
    button.title = $(title);
    button.font = $.NSFont.systemFontOfSize(13);
    button.target = target;
    button.action = selector;
    button.imagePosition = $.NSImageLeft;
    button.imageScaling = $.NSImageScaleProportionallyDown;
    button.tag = selector === 'play:' ? 1001 : 0;
    if (button.tag === 1001) button.contentTintColor = betaAccentTextColor();
    betaDesign.buttons.push(button);
    var symbols = {'play:': 'play.fill', 'pause:': 'pause.fill', 'stop:': 'stop.fill',
        'openText:': 'folder', 'exportAudio:': 'square.and.arrow.up'};
    if (symbols[selector]) {
        var image = betaDesignSymbol(symbols[selector], title);
        if (image) { image.size = $.NSMakeSize(14, 14); button.image = image; }
    }
    parent.addSubview(button);
    return button;
}

addButton = function (title, selector) {
    return betaDesignMakeButton(ui.content, title, selector, controller, $.NSMakeRect(0, 0, 100, 34));
};

function betaDesignCloseSettings() {
    if (betaDesign.settings) {
        if (betaDesign.settings.accentWell) betaDesign.settings.accentWell.deactivate;
        betaDesign.settings.window.orderOut($());
    }
}


function betaDesignWindow(window) {
    window.titlebarAppearsTransparent = false;
    window.titleVisibility = $.NSWindowTitleVisible;
    window.backgroundColor = $.NSColor.windowBackgroundColor;
    window.opaque = true;
}

function betaDesignSymbol(name, description) {
    try {
        var image = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription($(name), $(description));
        return image && !image.isNil() ? image : null;
    } catch (unavailable) { return null; }
}

function betaDesignIconButton(button, symbol, title) {
    button.toolTip = $(title);
    var image = betaDesignSymbol(symbol, title);
    if (image) { button.image = image; button.imagePosition = $.NSImageOnly; button.title = $(''); }
    try { button.setAccessibilityLabel($(title)); } catch (unavailable) {}
}

function betaDesignSpeedIcon(symbol, fallback, title) {
    var image = betaDesignSymbol(symbol, title), view;
    if (image) {
        view = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, 22, 22));
        view.image = image;
        view.imageScaling = $.NSImageScaleProportionallyUpOrDown;
        try { view.contentTintColor = $.NSColor.secondaryLabelColor; } catch (unavailable) {}
        ui.content.addSubview(view);
    } else {
        view = addLabel(fallback, 15, true);
        view.alignment = $.NSTextAlignmentCenter;
    }
    view.toolTip = $(title);
    return view;
}

function betaDesignFrames(width, height, factor) {
    var w = width / factor, h = height / factor;
    var frames = {
        voice: [16, h - 48, w - 134, 32], preview: [w - 104, h - 48, 42, 32],
        settingsButton: [w - 58, h - 48, 42, 32],
        rateLabel: [18, h - 86, 70, 22], turtle: [88, h - 86, 22, 22],
        rate: [116, h - 87, w - 246, 24], hare: [w - 120, h - 86, 22, 22],
        rateValue: [w - 88, h - 86, 70, 22],
        scroll: [16, 84, w - 32, h - 190],
        play: [12, 36, 110, 34], pause: [126, 36, 126, 34], stop: [256, 36, 88, 34],
        open: [w - 258, 36, 116, 34], exportButton: [w - 138, 36, 126, 34],
        status: [18, 9, w - 36, 20]
    };
    Object.keys(frames).forEach(function (key) {
        frames[key] = frames[key].map(function (value) { return value * factor; });
    });
    return frames;
}

var betaDesignOldLayout = layoutUI;
layoutUI = function () {
    if (!ui.designReady) { betaDesignOldLayout(); return; }
    var size = ui.content.bounds.size;
    var frames = betaDesignFrames(Number(size.width), Number(size.height), scale);
    Object.keys(frames).forEach(function (key) {
        var f = frames[key];
        ui[key].frame = $.NSMakeRect(f[0], f[1], f[2], f[3]);
        if (['scroll', 'rate', 'turtle', 'hare'].indexOf(key) < 0) {
            ui[key].font = $.NSFont.systemFontOfSize((key === 'status' ? 11 : 13) * scale);
        }
    });
    ui.editor.font = $.NSFont.systemFontOfSize(18 * scale);
    ui.editor.textContainerInset = $.NSMakeSize(16 * scale, 16 * scale);
    var width = Number(ui.scroll.contentSize.width);
    ui.editor.setFrameSize($.NSMakeSize(width,
        Math.max(Number(ui.editor.frame.size.height), Number(ui.scroll.contentSize.height))));
    ui.editor.textContainer.containerSize = $.NSMakeSize(width, 1000000);
};

var betaDesignOldRate = applyRate;
applyRate = function () {
    betaDesignOldRate();
    ui.rateValue.toolTip = ui.rateValue.stringValue;
    ui.rateValue.stringValue = $(speedFactor(ui.rate.doubleValue).toFixed(2).replace(/\.?0+$/, '') + '×');
};

var betaDesignOldHighlight = highlightWord;
highlightWord = function (range, text) {
    betaDesignOldHighlight(range, text);
    if (!highlightedRange) return;
    try {
        ui.editor.layoutManager.addTemporaryAttributeValueForCharacterRange(
            $.NSBackgroundColorAttributeName, betaAccentColor().colorWithAlphaComponent(0.24), highlightedRange);
        ui.editor.layoutManager.addTemporaryAttributeValueForCharacterRange(
            $.NSForegroundColorAttributeName, $.NSColor.textColor, highlightedRange);
    } catch (unavailable) { /* Retain native selection colors when tint is unavailable. */ }
};

function betaDesignSyncSettings() {
    var settings = betaDesign.settings;
    if (!settings) return;
    settings.theme.selectedSegment = themeOptions.indexOf(themePreference);
    settings.language.selectedSegment = ['system', 'ru', 'en'].indexOf(languageSettings.preference);
    settings.scroll.state = autoScroll ? 1 : 0;
    settings.updates.state = unwrap(defaults.objectForKey($('updateAutoCheck')), true) ? 1 : 0;
    settings.refresh.enabled = !!ui.refresh.enabled && !voiceProbe && !betaJob;
    settings.reset.enabled = !!ui.reset.enabled && !voiceProbe && !betaJob;
}

function betaDesignSetAutoScroll(enabled) {
    if (!!enabled !== autoScroll) toggleAutoScroll();
    betaDesignSyncSettings();
}

function betaDesignSetAutoUpdates(enabled) {
    defaults.setObjectForKey($(!!enabled), $('updateAutoCheck'));
    if (typeof updater !== 'undefined' && updater.items.auto) updater.items.auto.state = enabled ? 1 : 0;
    betaDesignSyncSettings();
}

function betaDesignRegisterController() {
    if (betaDesign.controller) return;
    ObjC.registerSubclass({ name: 'KasholkaBetaDesignController', superclass: 'NSObject', methods: {
        'closeSettings:': { types: ['void', ['id']], implementation: guarded(betaDesignCloseSettings) },
        'windowShouldClose:': { types: ['bool', ['id']], implementation: function () { return true; } },
        'settings:': { types: ['void', ['id']], implementation: guarded(betaDesignShowSettings) },
        'accentPreset:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () {
                var preset = betaAccentPresets()[Number(sender.indexOfSelectedItem)];
                if (preset) betaAccentApply(preset.rgb); else betaDesign.settings.accentWell.activate(true);
            })();
        } },
        'accentColor:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () {
                var rgb = sender.color.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
                if (rgb && !rgb.isNil()) betaAccentApply([Number(rgb.redComponent), Number(rgb.greenComponent), Number(rgb.blueComponent)]);
            })();
        } },
        'settingsTheme:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () { chooseTheme(themeOptions[Number(sender.selectedSegment)]); })();
        } },
        'settingsLanguage:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () { chooseUILanguage(['system', 'ru', 'en'][Number(sender.selectedSegment)]); })();
        } },
        'settingsScroll:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () { betaDesignSetAutoScroll(Number(sender.state) === 1); })();
        } },
        'settingsUpdates:': { types: ['void', ['id']], implementation: function (sender) {
            guarded(function () { betaDesignSetAutoUpdates(Number(sender.state) === 1); })();
        } },
        'windowDidBecomeKey:': { types: ['void', ['id']], implementation: guarded(betaDesignSyncSettings) },
        // The settings window must never use the main window's quit delegate.
        'windowWillClose:': { types: ['void', ['id']], implementation: function () {} }
    } });
    betaDesign.controller = $.KasholkaBetaDesignController.alloc.init;
}

function betaDesignShowSettings() {
    betaDesignRegisterButtonCell();
    betaDesignRegisterController();
    if (!betaDesign.settings) {
        var window = $.KasholkaBetaSettingsWindow.alloc.initWithContentRectStyleMaskBackingDefer(
            $.NSMakeRect(0, 0, 540, 420), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable,
            $.NSBackingStoreBuffered, false);
        window.title = $(t('Настройки'));
        window.releasedWhenClosed = false;
        window.delegate = betaDesign.controller;
        // Explicit route avoids relying on responder-chain resolution in JXA applets.
        var close = window.standardWindowButton($.NSWindowCloseButton);
        close.target = betaDesign.controller;
        close.action = 'closeSettings:';
        close.enabled = true;
        var content = window.contentView;
        function label(text, x, y, width, size, secondary) {
            var item = $.NSTextField.labelWithString($(text));
            item.frame = $.NSMakeRect(x, y, width, 22);
            item.font = $.NSFont.systemFontOfSize(size);
            item.textColor = secondary ? $.NSColor.secondaryLabelColor : $.NSColor.labelColor;
            content.addSubview(item);
            return item;
        }
        function segments(titles, y, action) {
            var item = $.NSSegmentedControl.alloc.initWithFrame($.NSMakeRect(170, y, 342, 32));
            item.segmentCount = titles.length;
            item.trackingMode = $.NSSegmentSwitchTrackingSelectOne;
            try { item.selectedSegmentBezelColor = betaAccentColor(); } catch (unavailable) {}
            titles.forEach(function (title, i) { item.setLabelForSegment($(title), i); item.setWidthForSegment(112, i); });
            item.target = betaDesign.controller; item.action = action;
            content.addSubview(item);
            return item;
        }
        function toggle(title, y, action) {
            var item = $.NSSwitch.alloc.initWithFrame($.NSMakeRect(26, y, 42, 28));
            item.target = betaDesign.controller; item.action = action;
            item.setAccessibilityLabel($(title));
            content.addSubview(item);
            label(title, 82, y + 3, 420, 13, false);
            return item;
        }
        label(t('Оформление и поведение'), 28, 374, 460, 17, false);
        label(t('Тема'), 28, 326, 130, 13, false);
        var theme = segments([t('Как в macOS'), t('Светлая'), t('Тёмная')], 320, 'settingsTheme:');
        label(t('Язык'), 28, 278, 130, 13, false);
        var language = segments([t('Как в macOS'), t('Русский'), 'English'], 272, 'settingsLanguage:');
        label(t('Язык изменится после перезапуска.'), 170, 246, 342, 11, true);
        var scroll = toggle(t('Автопрокрутка при чтении'), 200, 'settingsScroll:');
        var updates = toggle(t('Проверять обновления при запуске'), 160, 'settingsUpdates:');
        label(t('Цвет акцента'), 28, 110, 130, 13, false);
        var accentPreset = $.NSPopUpButton.alloc.initWithFramePullsDown($.NSMakeRect(170, 104, 270, 32), false);
        betaAccentPresets().forEach(function (preset) { accentPreset.addItemWithTitle($(preset.name)); });
        accentPreset.addItemWithTitle($(t('Свой цвет…')));
        accentPreset.target = betaDesign.controller; accentPreset.action = 'accentPreset:';
        accentPreset.setAccessibilityLabel($(t('Цвет акцента'))); content.addSubview(accentPreset);
        var accentWell = $.NSColorWell.alloc.initWithFrame($.NSMakeRect(452, 104, 60, 32));
        accentWell.color = betaAccentColor(); accentWell.target = betaDesign.controller; accentWell.action = 'accentColor:';
        accentWell.setAccessibilityLabel($(t('Свой цвет…'))); content.addSubview(accentWell);
        function button(title, x, action) {
            return betaDesignMakeButton(content, title, action, controller, $.NSMakeRect(x, 34, 232, 34));
        }
        betaDesign.settings = { window: window, theme: theme, language: language,
            scroll: scroll, updates: updates, accentPreset: accentPreset, accentWell: accentWell,
            refresh: button(t('Обновить голоса'), 24, 'refresh:'),
            reset: button(t('Сброс параметров'), 280, 'reset:') };
        betaDesignWindow(window);
        window.center;
    }
    betaDesignSyncSettings();
    betaAccentSync();
    betaDesign.settings.window.makeKeyAndOrderFront($());
}

var betaDesignOldChooseTheme = chooseTheme;
chooseTheme = function (preference) { betaDesignOldChooseTheme(preference); betaDesignSyncSettings(); };
var betaDesignOldChooseLanguage = chooseUILanguage;
chooseUILanguage = function (preference) { betaDesignOldChooseLanguage(preference); betaDesignSyncSettings(); };
var betaDesignOldScroll = toggleAutoScroll;
toggleAutoScroll = function () { betaDesignOldScroll(); betaDesignSyncSettings(); };

var betaDesignOldControls = updateControls;
updateControls = function () {
    betaDesignOldControls();
    if (ui.exportButton) ui.exportButton.enabled = !!(ui.exportItem && ui.exportItem.enabled) && !voiceProbe && !betaJob;
    if (ui.designReady) {
        ui.play.contentTintColor = ui.play.enabled ? betaAccentTextColor() : $.NSColor.disabledControlTextColor;
        var image = betaDesignSymbol(paused ? 'play.fill' : 'pause.fill', unwrap(ui.pause.title, ''));
        if (image) { image.size = $.NSMakeSize(14, 14); ui.pause.image = image; }
    }
    betaDesignSyncSettings();
};

var betaDesignOldMenus = installMenus;
installMenus = function () {
    betaDesignOldMenus();
    betaDesignRegisterController();
    var item = $.NSMenuItem.alloc.init;
    item.title = $(t('Настройки…')); item.action = 'settings:'; item.keyEquivalent = $(',');
    item.target = betaDesign.controller;
    var menu = $.NSApplication.sharedApplication.mainMenu;
    menu.itemAtIndex(0).submenu.insertItemAtIndex(item, 1);
    var close = menu.itemAtIndex(1).submenu.addItemWithTitleActionKeyEquivalent($(t('Закрыть окно')), 'performClose:', $('w'));
    close.target = $();
};

var betaDesignOldBuildWindow = buildMainWindow;
buildMainWindow = function () {
    betaAccentLoad();
    betaDesignOldBuildWindow();
    betaDesignWindow(ui.window);
    ['voiceLabel', 'refresh', 'textLabel', 'reset'].forEach(function (name) { ui[name].hidden = true; });
    ui.settingsButton = addButton(t('Настройки'), 'settings:');
    ui.settingsButton.target = betaDesign.controller;
    betaDesignIconButton(ui.settingsButton, 'gearshape', t('Настройки'));
    betaDesignIconButton(ui.preview, 'speaker.wave.2', t('Прослушать'));
    ui.turtle = betaDesignSpeedIcon('tortoise', '−', t('Медленнее'));
    ui.hare = betaDesignSpeedIcon('hare', '+', t('Быстрее'));
    ui.exportButton = addButton(t('Экспорт…'), 'exportAudio:');
    ui.open.title = $(t('Открыть…'));
    ui.rateValue.alignment = $.NSTextAlignmentRight;
    ui.status.textColor = $.NSColor.secondaryLabelColor;
    ui.scroll.borderType = $.NSNoBorder;
    ui.scroll.wantsLayer = true;
    ui.scroll.layer.cornerRadius = 12;
    ui.scroll.layer.masksToBounds = true;
    try { ui.rate.trackFillColor = betaAccentColor(); } catch (unavailable) {}
    try {
        ui.play.bezelColor = betaAccentColor();
        ui.play.contentTintColor = betaAccentTextColor();
    } catch (unavailable) { /* Native button remains usable without custom tint. */ }
    ui.designReady = true;
    layoutUI();
    applyRate();
    updateControls();
};

aboutLayout = function (width, height) {
    var cardWidth = Math.min(440, width - 48);
    return { card: [(width - cardWidth) / 2, (height - 176) / 2, cardWidth, 176],
        version: [width - 178, 12, 164, 24] };
};


function betaCreateAboutPanel(parent, frame) {
    if (!betaDesign.aboutPanelRegistered) {
        ObjC.registerSubclass({name: 'KasholkaBetaAboutPanel', superclass: 'NSView', methods: {
            // Inherit the native NSRect signature; never redeclare AppKit ABI types.
            'drawRect:': function (dirtyRect) {
                $.NSColor.colorWithCalibratedWhiteAlpha(0, 0.55).setFill;
                $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(this.bounds, 20, 20).fill;
            }
        }});
        betaDesign.aboutPanelRegistered = true;
    }
    var panel = $.KasholkaBetaAboutPanel.alloc.initWithFrame(frame);
    panel.wantsLayer = true;
    parent.addSubview(panel);
    panel.needsDisplay = true;
    betaDesign.aboutPanel = panel;
    return panel;
}

var betaAboutOriginalVideo = startAboutVideo;
startAboutVideo = function () {
    betaAboutOriginalVideo();
    if (about.background && betaDesign.aboutPanel) {
        // Keep the video below the panel and the labels above it, on every reopen.
        about.window.contentView.addSubviewPositionedRelativeTo(
            betaDesign.aboutPanel, $.NSWindowAbove, about.background);
        betaDesign.aboutPanel.needsDisplay = true;
    }
};
