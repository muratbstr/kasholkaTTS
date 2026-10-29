"""Build an independent Beta from the stable source plus opt-in experiments."""
from pathlib import Path
import hashlib
import re
import stat
import zipfile
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from localization import localization_source

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Beta integration point changed: {old!r}")
    return text.replace(old, new, 1)


def beta_source():
    stable_version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    version = (ROOT / "beta/VERSION").read_text(encoding="utf-8").strip()
    source = (ROOT / "src/kasholkaTTS.js").read_text(encoding="utf-8")
    source = source.replace(stable_version, version).replace("kasholkaTTS", "kasholkaTTS Beta")
    # Longer name in About: preserve the existing card and credits.
    source = replace_once(source, "overlay('kasholkaTTS Beta', 110, 48, 38, true)",
                          "overlay('kasholkaTTS Beta', 110, 48, 30, true)")
    return source + "\n" + (ROOT / "beta/experiments.js").read_text(encoding="utf-8") + localization_source()


def beta_installer():
    stable_version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    version = (ROOT / "beta/VERSION").read_text(encoding="utf-8").strip()
    body = (ROOT / "installer/Install kasholkaTTS.command").read_text(encoding="utf-8")
    body = body.replace(stable_version, version).replace("com.kasholka.tts", "com.kasholka.tts.beta")
    body = body.replace("kasholkaTTS.app", "kasholkaTTS Beta.app")
    body = body.replace(".kasholkaTTS-build.", ".kasholkaTTS-Beta-build.")
    body = body.replace("kasholkaTTS-backup.", "kasholkaTTS-Beta-backup.")
    body = body.replace("kasholkaTTS " + version, "kasholkaTTS Beta " + version)
    body = body.replace("завершите kasholkaTTS через", "завершите kasholkaTTS Beta через")
    body = replace_once(body, "app_display_name='kasholkaTTS'", "app_display_name='kasholkaTTS Beta'")
    body = replace_once(body, "CFBundleName string kasholkaTTS\n", "CFBundleName string 'kasholkaTTS Beta'\n")
    body = replace_once(body, "CFBundleDisplayName string kasholkaTTS\n", "CFBundleDisplayName string 'kasholkaTTS Beta'\n")
    body = re.sub(r"CFBundleShortVersionString string \d+\.\d+\.\d+", "CFBundleShortVersionString string " + version.split()[0], body)
    body = re.sub(r"CFBundleVersion string \d+", "CFBundleVersion string 30", body)
    anchor = 'cp "$installer_dir/src/voice-host.js" "$built_app/Contents/Resources/voice-host.js"'
    body = replace_once(body, anchor, anchor + '\ncp "$installer_dir/src/beta-probe.js" "$built_app/Contents/Resources/beta-probe.js"')
    body = replace_once(body, '# beta-extra-validation',
                        '[[ -f "$installer_dir/src/beta-probe.js" ]] || fail "$(message missing)"')
    return body


def build_beta(output_dir=None, *, manual=False):
    version = (ROOT / "beta/VERSION").read_text(encoding="utf-8").strip()
    suffix = "-macOS-manual-installer" if manual else "-macOS-installer"
    name = "kasholkaTTS-Beta-" + version.replace(" ", "-") + suffix
    output = Path(output_dir) if output_dir else ROOT / "dist"
    output.mkdir(parents=True, exist_ok=True)
    files = {
        "Install kasholkaTTS Beta.command": beta_installer().encode("utf-8"),
        "src/kasholkaTTS.js": beta_source().encode("utf-8"),
    }
    for relative, source in {
        "src/beta-probe.js": "beta/probe.js",
        "src/update-policy.js": "src/update-policy.js",
        "src/updater.js": "src/updater.js",
        "src/update-install.sh": "src/update-install.sh",
        "src/voice-host.js": "src/voice-host.js",
        "src/voice-host.swift": "src/voice-host.swift",
        "src/voice-host-swift.sh": "src/voice-host-swift.sh",
        "README.txt": "beta/README.md", "CHANGELOG.md": "beta/CHANGELOG.md",
        "VERSION": "beta/VERSION", "MAC_SMOKE_TEST.txt": "beta/MAC_SMOKE_TEST.md",
        "STABLE_README.txt": "README.md",
        "LICENSE": "LICENSE",
        "assets/voicesinstalling_tutor.gif": "assets/voicesinstalling_tutor.gif",
        "docs/UPDATES.md": "docs/UPDATES.md",
        "docs/LOCALIZATION.md": "docs/LOCALIZATION.md",
        "samples/kasholkaTTS-long-test.txt": "samples/kasholkaTTS-long-test.txt",
        "assets/kasholkaTTS.icns": "beta/assets/kasholkaTTS.icns",
        "assets/about.mp4": "assets/about.mp4", "assets/loading.png": "assets/loading.png",
    }.items():
        path = ROOT / source
        files[relative] = path.read_bytes() if path.suffix in (".png", ".icns", ".mp4", ".gif") else path.read_text(encoding="utf-8").encode("utf-8")
    archive = output / (name + ".zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for relative, data in files.items():
            info = zipfile.ZipInfo(name + "/" + relative, date_time=(2026, 10, 25, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | (0o755 if relative.endswith(".command") else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, data)
    checksum = archive.with_suffix(".zip.sha256")
    checksum.write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name + "\n", encoding="ascii")
    return archive, checksum


if __name__ == "__main__":
    # Keep the historical asset name for existing protocol-1 updaters.
    # The separately named manual installer is the only counted download.
    for manual in (True, False):
        for path in build_beta(manual=manual):
            print(path)
