/* Update protocol 1. Pure validation shared by the app and offline tests. */
var UPDATE_REPOSITORY = 'muratbstr/kasholkaTTS';
var UPDATE_API = 'https://api.github.com/repos/' + UPDATE_REPOSITORY + '/releases?per_page=100';

function updateText(text) { return typeof t === 'function' ? t(text) : text; }

function updateVersion(value) {
    var match = /^(\d+)\.(\d+)\.(\d+) (Release|Beta) ([1-9]\d*(?:\.(?:0|[1-9]\d*))*)$/.exec(value);
    if (!match || (match[4] === 'Beta' && match[5].indexOf('.') !== -1)) return null;
    var parts = [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === 'Beta' ? 0 : 1]
        .concat(match[5].split('.').map(Number));
    return parts.every(function (part) { return Number.isSafeInteger(part); }) ? parts : null;
}

function compareUpdateVersions(a, b) {
    a = updateVersion(a); b = updateVersion(b);
    if (!a || !b) throw new Error(updateText('Неизвестный формат версии.'));
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
        var left = a[i] || 0, right = b[i] || 0;
        if (left !== right) return left > right ? 1 : -1;
    }
    return 0;
}

function updateAssetPrefix(beta) { return beta ? 'kasholkaTTS-Beta-' : 'kasholkaTTS-'; }
function updateAppName(beta) { return beta ? 'kasholkaTTS Beta' : 'kasholkaTTS'; }

// Protocol 1 intentionally keeps -macOS-installer.zip for automatic updates.
// -macOS-manual-installer.zip is a separate asset and MUST NOT match below.
// Older clients only understand integer Release labels and ignore dotted ones.
// They need a manual upgrade once; no misleading compatibility alias is published.
function selectUpdate(releases, current, beta) {
    if (!Array.isArray(releases)) throw new Error(updateText('GitHub вернул неверный список выпусков.'));
    var found = null;
    releases.forEach(function (release) {
        if (release.draft || !!release.prerelease !== beta || !Array.isArray(release.assets)) return;
        var tag = /^v(\d+\.\d+\.\d+)(?:-beta\.([1-9]\d*))?$/.exec(release.tag_name || '');
        if (!tag || !!tag[2] !== beta) return;
        release.assets.forEach(function (asset) {
            var pattern = beta ? /^kasholkaTTS-Beta-(\d+\.\d+\.\d+)-Beta-([1-9]\d*)-macOS-installer\.zip$/ :
                /^kasholkaTTS-(\d+\.\d+\.\d+)-Release-([1-9]\d*(?:\.(?:0|[1-9]\d*))*)-macOS-installer\.zip$/;
            var match = pattern.exec(asset.name || '');
            if (!match || match[1] !== tag[1] || (beta && match[2] !== tag[2])) return;
            var version = match[1] + (beta ? ' Beta ' : ' Release ') + match[2];
            if (compareUpdateVersions(version, current) <= 0 || (found && compareUpdateVersions(version, found.version) <= 0)) return;
            var base = 'https://github.com/' + UPDATE_REPOSITORY + '/releases/download/' + release.tag_name + '/';
            var checksums = release.assets.filter(function (a) { return a.name === asset.name + '.sha256'; });
            if (checksums.length !== 1 || asset.state !== 'uploaded' || checksums[0].state !== 'uploaded') return;
            if (asset.browser_download_url !== base + asset.name || checksums[0].browser_download_url !== base + asset.name + '.sha256') return;
            if (!(asset.size > 0 && asset.size <= 128 * 1024 * 1024) || !(checksums[0].size > 0 && checksums[0].size < 1024)) return;
            found = { version: version, name: asset.name, url: asset.browser_download_url,
                checksumURL: checksums[0].browser_download_url, size: asset.size,
                digest: /^sha256:[a-f0-9]{64}$/.test(asset.digest || '') ? asset.digest.slice(7) : null };
        });
    });
    return found;
}

function verifyUpdateChecksum(text, name, actual, digest) {
    var match = /^([a-fA-F0-9]{64}) [ *]([^\r\n]+)\r?\n?$/.exec(text);
    if (!match || match[2] !== name || match[1].toLowerCase() !== actual.toLowerCase() ||
        (digest && digest !== actual.toLowerCase())) throw new Error(updateText('Контрольная сумма обновления не совпала. Установка отменена.'));
}

function updatePackageFiles(beta) {
    var files = ['Install ' + updateAppName(beta) + '.command', 'VERSION',
        'src/kasholkaTTS.js', 'src/update-policy.js', 'src/updater.js', 'src/update-install.sh',
        'src/voice-host.js', 'src/voice-host.swift', 'src/voice-host-swift.sh',
        'assets/kasholkaTTS.icns', 'assets/about.mp4', 'assets/loading.png'];
    if (beta) files.push('src/beta-probe.js');
    return files;
}

function validateUpdateArchive(listing, root, beta) {
    var seen = {};
    listing.replace(/\n$/, '').split('\n').forEach(function (name) {
        if (!name || name.indexOf(root + '/') !== 0 || /[\\\r\x00-\x1f]/.test(name) ||
            name.split('/').some(function (part) { return part === '..' || part === '.'; }) || seen[name]) {
            throw new Error(updateText('Неверная структура ZIP-архива.'));
        }
        seen[name] = true;
    });
    updatePackageFiles(beta).forEach(function (name) {
        if (!seen[root + '/' + name]) throw new Error(updateText('В обновлении отсутствует ') + name);
    });
    // Extraction uses unzip -p for these exact names into newly created files.
    // Neither archive paths nor symlinks are ever extracted to the filesystem.
    return updatePackageFiles(beta);
}
