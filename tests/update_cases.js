function mustFail(action) {
    var failed = false;
    try { action(); } catch (error) { failed = true; }
    assert(failed, 'Expected rejection');
}

function releaseFixture(version, beta) {
    var pieces = version.split(' ');
    var name = updateAssetPrefix(beta) + version.replace(/ /g, '-') + '-macOS-installer.zip';
    var tag = 'v' + pieces[0] + (beta ? '-beta.' + pieces[2] : '');
    var base = 'https://github.com/' + UPDATE_REPOSITORY + '/releases/download/' + tag + '/';
    return { tag_name: tag, prerelease: beta, draft: false, assets: [
        { name: name, state: 'uploaded', size: 100, browser_download_url: base + name },
        { name: name + '.sha256', state: 'uploaded', size: 140, browser_download_url: base + name + '.sha256' }
    ] };
}

check('versions sort numerically and reject malformed versions', function () {
    assert(compareUpdateVersions('1.10.0 Release 1', '1.9.9 Release 1') === 1);
    assert(compareUpdateVersions('2.0.0 Beta 10', '2.0.0 Beta 2') === 1);
    assert(compareUpdateVersions('2.0.0 Release 1', '2.0.0 Beta 10') === 1);
    assert(compareUpdateVersions('1.6.0 Release 1', '1.6.0 Release 1') === 0);
    mustFail(function () { compareUpdateVersions('latest', '1.6.0 Release 1'); });
});

check('channels never cross, drafts/equal/old versions ignored', function () {
    var stable = releaseFixture('1.10.0 Release 1', false), beta = releaseFixture('9.0.0 Beta 1', true);
    var draft = releaseFixture('20.0.0 Release 1', false); draft.draft = true;
    var list = [releaseFixture('1.9.0 Release 1', false), beta, stable, draft];
    assert(selectUpdate(list, '1.6.0 Release 1', false).version === '1.10.0 Release 1');
    assert(selectUpdate(list, '1.6.1 Beta 1', true).version === '9.0.0 Beta 1');
    assert(selectUpdate(list, '1.10.0 Release 1', false) === null);
    assert(selectUpdate([beta], '1.0.0 Release 1', false) === null);
});

check('release requires exact trusted URLs, complete asset pair and consistent tag', function () {
    var mutations = [
        function (r) { r.assets.pop(); },
        function (r) { r.assets.push(r.assets[1]); },
        function (r) { r.assets[0].browser_download_url = 'https://evil.example/update.zip'; },
        function (r) { r.assets[1].browser_download_url += '?redirect=evil'; },
        function (r) { r.assets[0].state = 'new'; },
        function (r) { r.assets[0].size = 129 * 1024 * 1024; },
        function (r) { r.assets[1].size = 4000; },
        function (r) { r.tag_name = 'v9.0.0'; },
        function (r) { r.prerelease = true; }
    ];
    mutations.forEach(function (mutate) {
        var r = releaseFixture('2.0.0 Release 1', false); mutate(r);
        assert(selectUpdate([r], '1.6.0 Release 1', false) === null);
    });
    mustFail(function () { selectUpdate({message: 'rate limit'}, '1.6.0 Release 1', false); });
});

check('checksum rejects corrupt download, substituted name and digest mismatch', function () {
    var hash = new Array(65).join('a');
    verifyUpdateChecksum(hash + '  archive.zip\n', 'archive.zip', hash, hash);
    mustFail(function () { verifyUpdateChecksum(hash + '  other.zip\n', 'archive.zip', hash); });
    mustFail(function () { verifyUpdateChecksum(hash + '  archive.zip\n', 'archive.zip', new Array(65).join('b')); });
    mustFail(function () { verifyUpdateChecksum(hash + '  archive.zip\n', 'archive.zip', hash, new Array(65).join('b')); });
    mustFail(function () { verifyUpdateChecksum('not a checksum', 'archive.zip', hash); });
});

check('archive rejects traversal, duplicates, missing payload and foreign root', function () {
    var names = updatePackageFiles(false).map(function (name) { return 'release/' + name; });
    assert(validateUpdateArchive(names.join('\n') + '\n', 'release', false).length === names.length);
    ['release/../../file', '/etc/file', 'release/..\\file', 'other/file', names[0], 'release/./file'].forEach(function (bad) {
        mustFail(function () { validateUpdateArchive(names.concat([bad]).join('\n'), 'release', false); });
    });
    mustFail(function () { validateUpdateArchive(names.slice(1).join('\n'), 'release', false); });
    mustFail(function () { validateUpdateArchive(names.join('\n'), 'release', true); });
});

var realUpdateFinish = updateFinish, realUpdateCommand = updateCommand, realUpdateFetch = updateFetch;
var realUpdateClean = updateClean, realUpdateRead = updateRead, realUpdateSize = updateSize;
var realUpdateConfirm = updateConfirm, realUpdateAdvance = updateAdvance;
var realUpdateHandoff = updateHandoff, realUpdateSaveAndQuit = updateSaveAndQuit;
function setupUpdater() {
    setup();
    var state = { messages: [], calls: [], removed: [], written: {}, files: {}, sizes: {}, clock: Date.now() };
    status = function (message) { state.messages.push(message); };
    alertUser = function (title, text) { state.messages.push(title + ': ' + text); };
    updater = { job: null, handedOff: false, items: { check: {}, cancel: {} } };
    updateFinish = realUpdateFinish; updateCommand = realUpdateCommand; updateFetch = realUpdateFetch;
    updateRead = function (path) { if (!(path in state.files)) throw new Error('No file: ' + path); return state.files[path]; };
    updateSize = function (path) { return state.sizes[path] || 0; };
    updateClean = function (job) { state.removed.push(job.directory); };
    updateConfirm = function () { state.confirmed = (state.confirmed || 0) + 1; return true; };
    updateAdvance = realUpdateAdvance; updateHandoff = realUpdateHandoff; updateSaveAndQuit = realUpdateSaveAndQuit;
    $.NSFileManager = { defaultManager: { fileExistsAtPath: function (path) { return path in state.files; } } };
    defaults = { setObjectForKey: function (value, key) { state.written[key] = value; } };
    return state;
}
function fakeUpdateTask(running, code) {
    var task = { running: running, terminationStatus: code || 0 };
    Object.defineProperty(task, 'terminate', { get: function () { task.terminated = true; } });
    return task;
}

check('cancellation waits for owned process exit before removing its files', function () {
    var state = setupUpdater(), task = fakeUpdateTask(true);
    updater.job = { directory: '/private/test', task: task, phase: 'download', deadline: Date.now() + 10000, limit: 200, release: {size: 100} };
    cancelUpdate(); updateTick();
    assert(task.terminated && state.removed.length === 0);
    task.running = false; updateTick();
    assert(updater.job === null && state.removed.length === 1);
});

check('timeout and excessive data terminate only updater task and never install', function () {
    [true, false].forEach(function (timeout) {
        var state = setupUpdater(), task = fakeUpdateTask(true);
        updater.job = { directory: '/private/test', task: task, phase: 'download', output: '/test/out',
            deadline: Date.now() + (timeout ? -1 : 10000), limit: 200, manual: true, release: {size: 100} };
        state.sizes['/test/out'] = timeout ? 0 : 201;
        updateTick(); assert(task.terminated && updater.job.failed);
        task.running = false; updateTick();
        assert(updater.job === null && state.removed.length === 1);
    });
});

check('offer and install wait for speech/export to finish, declined offer cleans files', function () {
    var state = setupUpdater();
    updater.job = { directory: '/test', phase: 'offer', release: {version: '2.0.0 Release 1'} };
    active = true; updateTick(); assert(!state.confirmed);
    active = false; updateConfirm = function () { return false; }; updateTick();
    assert(updater.job === null && state.removed.length === 1);
    updater.job = { directory: '/test', phase: 'ready', release: {version: '2.0.0 Release 1'} };
    active = true; updateTick(); assert(updater.job.phase === 'ready');
});

check('incomplete download never reaches hash or installation', function () {
    var state = setupUpdater();
    updater.job = { directory: '/test', phase: 'download', task: fakeUpdateTask(false), output: '/test/archive.zip',
        limit: 200, release: {size: 100}, manual: true };
    state.sizes['/test/archive.zip'] = 99;
    updateTick(); assert(updater.job === null && state.removed.length === 1);
});

check('release list pagination completes before deciding no updates', function () {
    var state = setupUpdater();
    var job = { directory: '/test', phase: 'check', output: '/test/releases', releases: [], page: 1, beta: false };
    updater.job = job;
    var releases = []; for (var i = 0; i < 100; i++) releases.push({draft: true});
    state.files[job.output] = JSON.stringify(releases);
    updateFetch = function (j, url) { state.calls.push(url); };
    updateAdvance(job); assert(job.page === 2 && state.calls[0].indexOf('&page=2') !== -1);
    state.files[job.output] = '[]'; updateAdvance(job);
    assert(updater.job === null && state.written.updateLastCheck > 0);
});

check('download arguments disable curl config and forbid non-HTTPS redirects', function () {
    var state = setupUpdater();
    updateCommand = function (job, executable, args) { state.calls.push({executable: executable, args: args}); };
    realUpdateFetch({}, 'https://github.com/test', 'archive.zip', 100, 'download');
    var call = state.calls[0];
    assert(call.executable === '/usr/bin/curl' && call.args[0] === '--disable');
    assert(call.args[call.args.indexOf('--proto-redir') + 1] === '=https');
    assert(call.args[call.args.indexOf('--max-filesize') + 1] === '100');
});

check('handoff failure keeps app open, handshake needed before saving and quitting', function () {
    var state = setupUpdater(), task = fakeUpdateTask(false, 1);
    updater.job = { directory: '/test', phase: 'handoff', task: task, output: '/test/install.log', limit: 200, manual: true };
    updateSaveAndQuit = function () { state.quit = true; };
    updateTick(); assert(!state.quit && updater.job === null);
    task = fakeUpdateTask(true);
    updater.job = { directory: '/test', phase: 'handoff', task: task, output: '/test/install.log', limit: 200, deadline: Date.now() + 10000 };
    updateTick(); assert(!state.quit);
    state.files['/test/handoff-ready'] = 'ready'; updateTick(); assert(state.quit);
});

check('handoff stores UTF16 selection/text before normal app shutdown', function () {
    var state = setupUpdater();
    var job = { directory: '/test', phase: 'handoff' };
    ui.editor.string = 'До 😀 слово'; ui.editor.selectedRange = { location: 6, length: 5 };
    writeHostJSON = function (path, value) { state.saved = value; };
    defaults.synchronize = true;
    terminateApp = function () { assert(state.saved && updater.handedOff); state.quit = true; };
    realUpdateSaveAndQuit(job);
    assert(state.quit && state.saved.text === 'До 😀 слово' && state.saved.location === 6);
    assert(state.written.updateResumeDirectory === '/test');
});

check('successful restart restores Unicode selection and removes private snapshot', function () {
    var state = setupUpdater(), directory = '/tmp/kasholka-update-AB12-CD34';
    $.NSTemporaryDirectory = function () { return '/tmp/'; };
    defaults.objectForKey = function () { return directory; };
    defaults.removeObjectForKey = function (key) { state.cleared = key; };
    defaults.synchronize = true;
    readHostJSON = function () { return {text: 'До 😀 слово', location: 6, length: 5}; };
    $.NSMakeRange = function (location, length) { return {location: location, length: length}; };
    ui.editor.setSelectedRange = function (range) { state.range = range; };
    ui.editor.scrollRangeToVisible = function () {};
    state.files[directory + '/install-result.txt'] = 'ok';
    updateRestoreText();
    assert(ui.editor.string === 'До 😀 слово' && state.range.location === 6 && state.range.length === 5);
    assert(state.cleared === 'updateResumeDirectory' && state.removed[0] === directory);
});


check('dotted Release labels sort numerically and select valid automatic packages', function () {
    assert(compareUpdateVersions('1.7.4 Release 2.10', '1.7.4 Release 2.2') > 0);
    assert(compareUpdateVersions('1.7.4 Release 2.2', '1.7.4 Release 2') > 0);
    assert(compareUpdateVersions('1.7.4 Release 2', '1.7.4 Release 2.2') < 0);
    assert(compareUpdateVersions('1.7.4 Release 2.0', '1.7.4 Release 2') === 0);
    assert(updateVersion('1.7.4 Release 2..2') === null);
    assert(updateVersion('1.7.4 Release 2.02') === null);
    assert(updateVersion('1.7.5 Beta 1.2') === null);
    var r = releaseFixture('1.7.4 Release 2.2', false);
    assert(selectUpdate([r], '1.7.4 Release 2', false).version === '1.7.4 Release 2.2');
    assert(selectUpdate([r], '1.7.4 Release 2.2', false) === null);
});
