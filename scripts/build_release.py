"""Build the macOS installer ZIP on Windows, using Python's standard library."""
from pathlib import Path
import hashlib
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build_release(output_dir=None):
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    output = Path(output_dir) if output_dir else ROOT / "dist"
    output.mkdir(parents=True, exist_ok=True)
    name = f"kasholkaTTS-{version.replace(' ', '-')}-macOS-installer"
    archive = output / f"{name}.zip"
    files = {
        "Install kasholkaTTS.command": ROOT / "installer/Install kasholkaTTS.command",
        "src/kasholkaTTS.js": ROOT / "src/kasholkaTTS.js",
        "src/voice-host.js": ROOT / "src/voice-host.js",
        "src/voice-host.swift": ROOT / "src/voice-host.swift",
        "src/voice-host-swift.sh": ROOT / "src/voice-host-swift.sh",
        "README.txt": ROOT / "README.md",
        "CHANGELOG.md": ROOT / "CHANGELOG.md",
        "changelog_before_rel.md": ROOT / "changelog_before_rel.md",
        "VERSION": ROOT / "VERSION",
        "MAC_SMOKE_TEST.txt": ROOT / "tests/MAC_SMOKE_TEST.md",
        "samples/kasholkaTTS-long-test.txt": ROOT / "samples/kasholkaTTS-long-test.txt",
        "assets/kasholkaTTS.icns": ROOT / "assets/kasholkaTTS.icns",
        "assets/about.mp4": ROOT / "assets/about.mp4",
        "assets/loading.png": ROOT / "assets/loading.png",
    }
    for source in files.values():
        if not source.is_file():
            raise FileNotFoundError(source)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for relative, source in files.items():
            if source.suffix in (".icns", ".mp4", ".png"):
                content = source.read_bytes()
            else:
                content = source.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")
            info = zipfile.ZipInfo(f"{name}/{relative}", date_time=(2026, 10, 24, 0, 0, 0))
            info.create_system = 3
            mode = 0o755 if relative.endswith(".command") else 0o644
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, content)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix(".zip.sha256")
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    return archive, checksum


if __name__ == "__main__":
    for path in build_release():
        print(path)
