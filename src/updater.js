/* AppKit updater. Appended after the main source and update-policy.js. */
var updater = { controller: null, timer: null, job: null, handedOff: false, items: {} };

function updateIsBeta() { return VERSION.indexOf(' Beta ') !== -1; }
function updateBusy() { return active || !!voiceProbe || (typeof betaJob !== 'undefined' && !!betaJob); }

function updateDirectory(path) {
    var permissions = $.NSMutableDictionary.alloc.init;
    permissions.setObjectForKey($(448), $.NSFilePosixPermissions);
    if (!$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        $(path), false, permissions, Ref())) throw new Error(t('Не удалось создать папку обновления.'));
}

function updateSize(path) {
    var attrs = $.NSFileManager.defaultManager.attributesOfItemAtPathError($(path), Ref());
    return attrs && !attrs.isNil() ? Number(unwrap(attrs.objectForKey($.NSFileSize), 0)) : 0;
}

function updateRead(path) {
    var value = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, Ref());
    if (!value || value.isNil()) throw new Error(t('Не удалось прочитать файл обновления.'));
    return ObjC.unwrap(value);
}

function updateCloseHandles(job) {
    (job.handles || []).forEach(function (handle) { try { handle.closeFile; } catch (closed) {} });
    job.handles = [];
}

function updateClean(job) {
    updateCloseHandles(job);
    // Fixed, individually named files only; rmdir refuses a nonempty directory.
    var files = ['releases.json', 'checksum.txt', 'archive.zip', 'hash.txt', 'listing.txt', 'stderr.txt',
        'resume.json', 'handoff.sh', 'handoff-ready', 'install.log', 'install-result.txt', 'install-error.txt'];
    files = files.concat(updatePackageFiles(job.beta).map(function (name) { return 'package/' + name; }));
    files.forEach(function (name) {
        try { $.NSFileManager.defaultManager.removeItemAtPathError($(job.directory + '/' + name), Ref()); } catch (missing) {}
    });
    ['package/src', 'package/assets', 'package', ''].forEach(function (name) {
        try { $.rmdir(job.directory + (name ? '/' + name : '')); } catch (missing) {}
    });
}

function updateMenuState() {
    updater.items.check.enabled = !updater.job;
    updater.items.cancel.enabled = !!updater.job && updater.job.phase !== 'handoff';
}

function updateFinish(message, error) {
    var job = updater.job;
    updater.job = null;
    if (job) updateClean(job);
    if (job && job.locked) {
        defaults.removeObjectForKey($('updateResumeDirectory'));
        active = false; updateControls();
    }
    updateMenuState();
    if (message) status(message);
    if (error && job && job.manual) alertUser(t('Обновление не установлено'), message);
}

function updateCommand(job, executable, args, output, limit, phase, timeout) {
    updateCloseHandles(job);
    job.phase = phase;
    job.output = job.directory + '/' + output;
    job.limit = limit;
    job.deadline = Date.now() + (timeout || 40) * 1000;
    job.handles = [];
    var handle = createHostLog(job.output); job.handles.push(handle);
    var errors = createHostLog(job.directory + '/stderr.txt'); job.handles.push(errors);
    job.task = $.NSTask.alloc.init;
    job.task.launchPath = $(executable);
    job.task.arguments = $(args);
    job.task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
    job.task.standardOutput = handle;
    job.task.standardError = phase === 'handoff' ? handle : errors;
    job.task.launch;
}

function updateFetch(job, url, output, limit, phase) {
    updateCommand(job, '/usr/bin/curl', ['--disable', '--fail', '--silent', '--show-error', '--location',
        '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '180',
        '--max-filesize', String(limit), '--user-agent', 'kasholka-updater',
        '--header', 'Accept: application/vnd.github+json', url], output, limit, phase, 185);
}

function checkForUpdates(manual) {
    if (updater.job) return;
    var directory = unwrap($.NSTemporaryDirectory(), '') + 'kasholka-update-' + unwrap($.NSUUID.UUID.UUIDString, '');
    try {
        updateDirectory(directory);
        updater.job = { directory: directory, beta: updateIsBeta(), manual: manual, page: 1, releases: [] };
        updateMenuState();
        if (manual) status(t('Проверка обновлений GitHub…'));
        updateFetch(updater.job, UPDATE_API + '&page=1', 'releases.json', 8 * 1024 * 1024, 'check');
    } catch (error) { updateFinish(String(error), true); }
}

function cancelUpdate() {
    var job = updater.job;
    if (!job || job.phase === 'handoff') return;
    job.cancelled = t('Обновление отменено.');
    if (job.task && job.task.running) job.task.terminate;
    else updateFinish(job.cancelled, false);
}

function updateConfirm(title, text, button) {
    var dialog = $.NSAlert.alloc.init;
    dialog.messageText = $(title); dialog.informativeText = $(text);
    dialog.addButtonWithTitle($(button)); dialog.addButtonWithTitle($(t('Позже')));
    return Number(dialog.runModal) === 1000;
}

function updateExtractNext(job) {
    if (!job.files.length) {
        if (updateRead(job.directory + '/package/VERSION').trim() !== job.release.version) throw new Error(t('Версия внутри ZIP не совпала с выпуском GitHub.'));
        var installer = updateRead(job.directory + '/package/Install ' + updateAppName(job.beta) + '.command');
        if (installer.indexOf('# kasholka-update-protocol: 1\n') === -1) throw new Error(t('Этот установщик не поддерживает автоматическое обновление.'));
        job.phase = 'ready'; job.task = null;
        status(t('Обновление загружено и проверено.'));
        return;
    }
    var name = job.files.shift();
    updateCommand(job, '/usr/bin/unzip', ['-p', job.directory + '/archive.zip', job.root + '/' + name],
        'package/' + name, name === 'assets/about.mp4' ? 64 * 1024 * 1024 : 16 * 1024 * 1024, 'extract');
}

function updateHandoff(job) {
    var appName = updateAppName(job.beta);
    var destination = unwrap($.NSHomeDirectory(), '') + '/Applications/' + appName + '.app';
    var current = unwrap($.NSBundle.mainBundle.bundlePath, '');
    if (current !== destination) throw new Error(t('Для автоматического обновления запустите приложение из ') + destination + '.');
    var helper = $.NSBundle.mainBundle.pathForResourceOfType($('update-install'), $('sh'));
    if (!helper || helper.isNil()) throw new Error(t('Не найден помощник обновления.'));
    if (!$.NSFileManager.defaultManager.copyItemAtPathToPathError(helper, $(job.directory + '/handoff.sh'), Ref())) {
        throw new Error(t('Не удалось подготовить перезапуск.'));
    }
    // This process outlives the app; cancellation is disabled once handoff begins.
    updateCommand(job, '/bin/bash', [job.directory + '/handoff.sh', job.directory,
        String($.NSProcessInfo.processInfo.processIdentifier), appName,
        job.beta ? 'com.kasholka.tts.beta' : 'com.kasholka.tts', job.release.version], 'install.log', 4 * 1024 * 1024, 'handoff', 10);
    job.locked = true; active = true; updateControls(); ui.stop.enabled = false;
    updateMenuState();
    status(t('Подготовка перезапуска…'));
}

function updateSaveAndQuit(job) {
    var range = ui.editor.selectedRange;
    writeHostJSON(job.directory + '/resume.json', { text: unwrap(ui.editor.string, ''),
        location: Number(range.location), length: Number(range.length) });
    defaults.setObjectForKey($(job.directory), $('updateResumeDirectory'));
    if (!defaults.synchronize) throw new Error(t('Не удалось сохранить состояние перед перезапуском.'));
    updater.handedOff = true;
    updateCloseHandles(job);
    terminateApp();
}

function updateAdvance(job) {
    if (job.phase === 'check') {
        var page = JSON.parse(updateRead(job.output));
        if (!Array.isArray(page)) throw new Error(t('Неверный ответ GitHub.'));
        job.releases = job.releases.concat(page);
        if (page.length === 100) {
            if (++job.page > 10) throw new Error(t('Слишком много выпусков для проверки.'));
            updateFetch(job, UPDATE_API + '&page=' + job.page, 'releases.json', 8 * 1024 * 1024, 'check');
            return;
        }
        job.release = selectUpdate(job.releases, VERSION, job.beta);
        defaults.setObjectForKey($(Date.now()), $('updateLastCheck'));
        if (!job.release) {
            var manual = job.manual;
            updateFinish(manual ? t('У вас актуальная версия для этого канала.') : '', false);
            if (manual) alertUser(t('Обновлений нет'), t('Установлена ') + VERSION + t('. Новых опубликованных сборок для этого канала нет.'));
            return;
        }
        job.phase = 'offer'; job.task = null;
    } else if (job.phase === 'checksum') {
        updateFetch(job, job.release.url, 'archive.zip', 128 * 1024 * 1024, 'download');
        status(t('Загрузка ') + job.release.version + '…');
    } else if (job.phase === 'download') {
        if (updateSize(job.output) !== job.release.size) throw new Error(t('Архив загружен не полностью.'));
        updateCommand(job, '/usr/bin/shasum', ['-a', '256', job.directory + '/archive.zip'], 'hash.txt', 4096, 'hash');
        status(t('Проверка обновления…'));
    } else if (job.phase === 'hash') {
        var hash = updateRead(job.output).split(/\s/)[0];
        verifyUpdateChecksum(updateRead(job.directory + '/checksum.txt'), job.release.name, hash, job.release.digest);
        updateCommand(job, '/usr/bin/unzip', ['-Z1', job.directory + '/archive.zip'], 'listing.txt', 256 * 1024, 'list');
    } else if (job.phase === 'list') {
        job.root = job.release.name.replace(/\.zip$/, '');
        job.files = validateUpdateArchive(updateRead(job.output), job.root, job.beta);
        updateDirectory(job.directory + '/package');
        updateDirectory(job.directory + '/package/src');
        updateDirectory(job.directory + '/package/assets');
        updateExtractNext(job);
    } else if (job.phase === 'extract') {
        if (updateSize(job.output) === 0) throw new Error(t('Пустой файл в обновлении.'));
        updateExtractNext(job);
    }
}

function updateTick() {
    var job = updater.job;
    if (!job || job.ticking || updater.handedOff) return;
    job.ticking = true;
    try {
        if (job.task && job.task.running) {
            if (job.phase === 'handoff' && $.NSFileManager.defaultManager.fileExistsAtPath($(job.directory + '/handoff-ready'))) {
                updateSaveAndQuit(job); return;
            }
            if (Date.now() > job.deadline || updateSize(job.output) > job.limit || updateSize(job.directory + '/stderr.txt') > 1024 * 1024) {
                job.cancelled = t('Превышено время ожидания или размер файла обновления.');
                job.failed = true; job.task.terminate;
            }
            if (job.phase === 'download' && !updateBusy() && Date.now() - (job.progressAt || 0) > 1000) {
                job.progressAt = Date.now();
                status(t('Загрузка обновления: {downloaded} / {total} МБ. Отмена — в меню «Обновления».', {
                    downloaded: (updateSize(job.output) / 1048576).toFixed(1),
                    total: (job.release.size / 1048576).toFixed(1) }));
            }
            return;
        }
        if (job.cancelled) { updateFinish(job.cancelled, job.failed); return; }
        if (job.task) {
            var code = Number(job.task.terminationStatus);
            updateCloseHandles(job); job.task = null;
            if (code !== 0 || job.phase === 'handoff') throw new Error(t('Не удалось выполнить этап обновления (') + job.phase + t(', код ') + code + t('). Проверьте подключение и повторите попытку.'));
            if (updateSize(job.output) > job.limit) throw new Error(t('Слишком большой файл обновления.'));
            updateAdvance(job);
        }
        if (updater.job !== job || updateBusy()) return;
        if (job.phase === 'offer') {
            if (!updateConfirm(t('Доступна ') + job.release.version,
                t('Скачать обновление из GitHub? После загрузки можно будет установить его и перезапустить приложение.'), t('Скачать'))) {
                updateFinish('', false); return;
            }
            updateFetch(job, job.release.checksumURL, 'checksum.txt', 1024, 'checksum');
        } else if (job.phase === 'ready') {
            if (!updateConfirm(t('Установить ') + job.release.version + '?',
                t('Приложение перезапустится. Текст временно сохранится на этом Mac и восстановится после запуска. Прежняя сборка останется в ~/Applications как резервная копия.'), t('Установить и перезапустить'))) {
                updateFinish(t('Установку отложили. Её можно снова запустить через меню обновлений.'), false); return;
            }
            updateHandoff(job);
        }
    } catch (error) {
        if (job.task && job.task.running) { job.cancelled = String(error); job.failed = true; job.task.terminate; }
        else updateFinish(String(error), true);
    } finally { job.ticking = false; }
}

function updateRestoreText() {
    var directory = unwrap(defaults.objectForKey($('updateResumeDirectory')), '');
    if (!directory) return;
    // Only accept our own direct child of NSTemporaryDirectory, never arbitrary paths.
    var base = unwrap($.NSTemporaryDirectory(), '') + 'kasholka-update-';
    if (directory.indexOf(base) !== 0 || !/^[A-Fa-f0-9-]+$/.test(directory.slice(base.length))) {
        defaults.removeObjectForKey($('updateResumeDirectory')); return;
    }
    try {
        var saved = readHostJSON(directory + '/resume.json');
        if (!saved || typeof saved.text !== 'string') throw new Error(t('Не найден сохранённый текст.'));
        ui.editor.string = $(saved.text);
        var location = Math.max(0, Math.min(saved.text.length, Number(saved.location) || 0));
        var length = Math.max(0, Math.min(saved.text.length - location, Number(saved.length) || 0));
        ui.editor.setSelectedRange($.NSMakeRange(location, length));
        ui.editor.scrollRangeToVisible($.NSMakeRange(location, length));
        defaults.removeObjectForKey($('updateResumeDirectory')); defaults.synchronize;
        var failed = $.NSFileManager.defaultManager.fileExistsAtPath($(directory + '/install-error.txt'));
        var success = $.NSFileManager.defaultManager.fileExistsAtPath($(directory + '/install-result.txt'));
        if (failed || !success) {
            alertUser(t('Проверьте результат обновления'), t('Текст восстановлен. Журнал установки сохранён: ') + directory + '/install.log');
            // Keep diagnostics, but remove the private text snapshot after restoration.
            $.NSFileManager.defaultManager.removeItemAtPathError($(directory + '/resume.json'), Ref());
        } else {
            updateClean({ directory: directory, beta: updateIsBeta() });
            status(t('Обновление установлено. Текст восстановлен.'));
        }
    } catch (error) { alertUser(t('Восстановление после обновления'), String(error) + t('\nСохранённые данные: ') + directory); }
}

function updateDidLaunch() {
    updateRestoreText();
    var enabled = !!unwrap(defaults.objectForKey($('updateAutoCheck')), true);
    var last = Number(unwrap(defaults.objectForKey($('updateLastCheck')), 0));
    if (enabled && Date.now() - last > 24 * 60 * 60 * 1000) checkForUpdates(false);
}

function updateWillQuit() {
    if (updater.timer) updater.timer.invalidate;
    var job = updater.job;
    if (!job || updater.handedOff) return;
    if (job.task && job.task.running) {
        job.task.terminate; updateCloseHandles(job);
        // Leave temporary files until the child exits; never race its writes.
    } else updateClean(job);
}

function installUpdateMenu(appMenu) {
    ObjC.registerSubclass({ name: 'KasholkaUpdateController', superclass: 'NSObject', methods: {
        'checkUpdates:': { types: ['void', ['id']], implementation: guarded(function () { checkForUpdates(true); }) },
        'cancelUpdate:': { types: ['void', ['id']], implementation: guarded(cancelUpdate) },
        'autoUpdates:': { types: ['void', ['id']], implementation: guarded(function () {
            var enabled = !unwrap(defaults.objectForKey($('updateAutoCheck')), true);
            defaults.setObjectForKey($(enabled), $('updateAutoCheck')); updater.items.auto.state = enabled ? 1 : 0;
        }) },
        'updateTick:': { types: ['void', ['id']], implementation: updateTick }
    } });
    updater.controller = $.KasholkaUpdateController.alloc.init;
    var menu = $.NSMenu.alloc.initWithTitle($(t('Обновления'))); menu.autoenablesItems = false;
    [[t('Проверить обновления…'), 'checkUpdates:', 'check'], [t('Проверять при запуске'), 'autoUpdates:', 'auto'],
        [t('Отменить загрузку'), 'cancelUpdate:', 'cancel']].forEach(function (entry) {
        var item = menu.addItemWithTitleActionKeyEquivalent($(entry[0]), entry[1], $(''));
        item.target = updater.controller; updater.items[entry[2]] = item;
    });
    updater.items.auto.state = unwrap(defaults.objectForKey($('updateAutoCheck')), true) ? 1 : 0;
    var parent = $.NSMenuItem.alloc.init;
    parent.title = $(t('Обновления')); parent.submenu = menu; appMenu.addItem(parent);
    updateMenuState();
    updater.timer = $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(
        0.2, updater.controller, 'updateTick:', null, true);
    $.NSRunLoop.mainRunLoop.addTimerForMode(updater.timer, $.NSRunLoopCommonModes);
}
