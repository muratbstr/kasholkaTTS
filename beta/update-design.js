/* Loaded after the existing updater, in Beta only. No networking or validation here. */
var betaUpdateUI = {view: null, controller: null, confirming: false, result: '', error: false};

function betaUpdatePresentation(job, bytes) {
    var phase = job ? job.phase : '';
    var names = {check: t('Проверка обновлений…'), checksum: t('Получение контрольной суммы…'),
        download: t('Загрузка обновления…'), hash: t('Проверка SHA-256…'), list: t('Проверка содержимого архива…'),
        extract: t('Подготовка файлов…'), ready: t('Обновление готово к установке'),
        offer: t('Доступно обновление'), handoff: t('Подготовка перезапуска…')};
    var total = job && job.release ? Number(job.release.size) : 0;
    var measured = phase === 'download' && total > 0;
    return {title: names[phase] || t('Обновления'),
        fraction: measured ? Math.max(0, Math.min(1, bytes / total)) : 0,
        indeterminate: !!job && !measured && phase !== 'offer' && phase !== 'ready',
        detail: measured ? t('{downloaded} / {total} МБ', {
            downloaded: (bytes / 1048576).toFixed(1), total: (total / 1048576).toFixed(1)}) : '',
        canCancel: !!job && phase !== 'handoff' && !job.cancelled};
}

function betaUpdateSync() {
    var view = betaUpdateUI.view;
    if (!view || betaUpdateUI.confirming) return;
    var job = updater.job, bytes = job && job.phase === 'download' ? updateSize(job.output) : 0;
    var state = betaUpdatePresentation(job, bytes);
    view.title.stringValue = $(!job && betaUpdateUI.error ? t('Обновление не установлено') : state.title);
    view.version.stringValue = $(job && job.release ? VERSION + ' → ' + job.release.version : VERSION);
    view.message.stringValue = $(job ? (job.cancelled || state.detail || state.title) : betaUpdateUI.result);
    view.message.toolTip = view.message.stringValue;
    view.progress.stopAnimation($());
    view.progress.indeterminate = state.indeterminate;
    view.progress.doubleValue = state.fraction * 100;
    view.progress.hidden = !job;
    if (state.indeterminate) view.progress.startAnimation($());
    view.primary.title = $(t('Проверить обновления…'));
    view.primary.enabled = !job;
    view.primary.contentTintColor = job ? $.NSColor.disabledControlTextColor : betaAccentTextColor();
    view.secondary.title = $(job ? t('Отмена') : t('Закрыть'));
    view.secondary.enabled = !job || state.canCancel;
    view.window.standardWindowButton($.NSWindowCloseButton).enabled = !job || job.phase !== 'handoff';
}

function betaUpdatePrimary() {
    if (betaUpdateUI.confirming) { $.NSApplication.sharedApplication.stopModalWithCode(1); return; }
    checkForUpdates(true);
}

function betaUpdateClose() {
    if (betaUpdateUI.confirming) {
        $.NSApplication.sharedApplication.stopModalWithCode(0);
        if (betaUpdateUI.view) betaUpdateUI.view.window.orderOut($());
        return;
    }
    if (updater.job && updater.job.phase === 'handoff') return;
    if (updater.job) cancelUpdate();
    if (betaUpdateUI.view) betaUpdateUI.view.window.orderOut($());
}

function betaUpdateSecondary() {
    if (betaUpdateUI.confirming) { $.NSApplication.sharedApplication.stopModalWithCode(0); return; }
    if (updater.job) { cancelUpdate(); betaUpdateSync(); }
    else betaUpdateClose();
}

function betaUpdateWindow() {
    if (betaUpdateUI.view) return betaUpdateUI.view;
    ObjC.registerSubclass({name: 'KasholkaBetaUpdateWindow', superclass: 'NSWindow', methods: {
        'cancelOperation:': function (sender) { betaUpdateClose(); }
    }});
    ObjC.registerSubclass({name: 'KasholkaBetaUpdateUIController', superclass: 'NSObject', methods: {
        'primary:': {types: ['void', ['id']], implementation: guarded(betaUpdatePrimary)},
        'secondary:': {types: ['void', ['id']], implementation: guarded(betaUpdateSecondary)},
        'close:': {types: ['void', ['id']], implementation: guarded(betaUpdateClose)},
        'windowShouldClose:': {types: ['bool', ['id']], implementation: function () { betaUpdateClose(); return false; }}
    }});
    betaUpdateUI.controller = $.KasholkaBetaUpdateUIController.alloc.init;
    var window = $.KasholkaBetaUpdateWindow.alloc.initWithContentRectStyleMaskBackingDefer(
        $.NSMakeRect(0, 0, 560, 340), $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable, $.NSBackingStoreBuffered, false);
    window.title = $(t('Обновления')); window.releasedWhenClosed = false;
    window.delegate = betaUpdateUI.controller; betaDesignWindow(window);
    var close = window.standardWindowButton($.NSWindowCloseButton);
    close.target = betaUpdateUI.controller; close.action = 'close:';
    var content = window.contentView;
    function label(text, x, y, width, height, size) {
        var item = $.NSTextField.wrappingLabelWithString($(text));
        item.frame = $.NSMakeRect(x,y,width,height); item.font = $.NSFont.systemFontOfSize(size);
        content.addSubview(item); return item;
    }
    var icon = $.NSImageView.alloc.initWithFrame($.NSMakeRect(24,254,56,56));
    icon.image = $.NSApplication.sharedApplication.applicationIconImage;
    icon.imageScaling = $.NSImageScaleProportionallyUpOrDown; content.addSubview(icon);
    var title = label(t('Обновления'), 96,278,440,28,19);
    var version = label(VERSION,96,246,440,30,12); version.textColor = $.NSColor.secondaryLabelColor;
    var message = label('',24,112,512,118,13);
    var progress = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24,88,512,12));
    progress.style = $.NSProgressIndicatorStyleBar; progress.minValue=0; progress.maxValue=100;
    progress.controlTint = $.NSBlueControlTint; content.addSubview(progress);
    var secondary = betaDesignMakeButton(content,t('Закрыть'),'secondary:',betaUpdateUI.controller,$.NSMakeRect(24,24,126,36));
    var primary = betaDesignMakeButton(content,t('Проверить обновления…'),'primary:',betaUpdateUI.controller,$.NSMakeRect(162,24,374,36));
    primary.tag=1001;
    // No default Enter key: a timer-driven offer must not turn typing into consent.
    betaUpdateUI.view = {window:window,title:title,version:version,message:message,progress:progress,primary:primary,secondary:secondary};
    window.center;
    return betaUpdateUI.view;
}

updateConfirm = function (title, text, button) {
    var view = betaUpdateWindow();
    betaUpdateUI.confirming = true;
    view.title.stringValue = $(title); view.message.stringValue = $(text);
    view.version.stringValue = $(VERSION);
    view.progress.stopAnimation($()); view.progress.hidden = true;
    view.primary.title = $(button); view.primary.enabled = true;
    view.primary.contentTintColor = betaAccentTextColor();
    view.secondary.title = $(t('Позже')); view.secondary.enabled = true;
    view.window.standardWindowButton($.NSWindowCloseButton).enabled = true;
    view.window.makeKeyAndOrderFront($());
    try { return Number($.NSApplication.sharedApplication.runModalForWindow(view.window)) === 1; }
    finally { betaUpdateUI.confirming = false; }
};

var betaUpdateOldCheck = checkForUpdates;
checkForUpdates = function (manual) {
    if (manual) {
        betaUpdateUI.result = ''; betaUpdateUI.error = false;
        betaUpdateWindow().window.makeKeyAndOrderFront($());
    }
    betaUpdateOldCheck(manual); betaUpdateSync();
};
var betaUpdateOldFinish = updateFinish;
updateFinish = function (message, error) {
    betaUpdateUI.result = message || t('Обновление отложено.'); betaUpdateUI.error = !!error;
    betaUpdateOldFinish(message,error); betaUpdateSync();
};
var betaUpdateOldTick = updateTick;
updateTick = function () { try { betaUpdateOldTick(); } finally { betaUpdateSync(); } };
var betaUpdateOldCancel = cancelUpdate;
cancelUpdate = function () { betaUpdateOldCancel(); betaUpdateSync(); };
