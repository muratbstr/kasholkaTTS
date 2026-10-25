"""Build a flat, rounded macOS icon from the approved silhouette, offline.

The user explicitly requested programmatic cleanup after image generation
produced transparency artifacts. Only Python's standard library is used.
"""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]


def read_png(path):
    data = Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Expected PNG")
    offset, compressed = 8, bytearray()
    while offset < len(data):
        size = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:offset + 8 + size]
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
                raise ValueError("Expected non-interlaced 8-bit RGB(A) PNG")
            channels = 3 if color == 2 else 4
        elif kind == b"IDAT":
            compressed.extend(body)
        offset += size + 12
    raw = zlib.decompress(compressed)
    stride = width * channels
    previous = bytearray(stride)
    pixels = bytearray()
    for y in range(height):
        start = y * (stride + 1)
        mode = raw[start]
        row = bytearray(raw[start + 1:start + stride + 1])
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            up = previous[x]
            corner = previous[x - channels] if x >= channels else 0
            if mode == 0:
                predictor = 0
            elif mode == 1:
                predictor = left
            elif mode == 2:
                predictor = up
            elif mode == 3:
                predictor = (left + up) // 2
            elif mode == 4:
                p = left + up - corner
                distances = (abs(p - left), abs(p - up), abs(p - corner))
                predictor = (left, up, corner)[distances.index(min(distances))]
            else:
                raise ValueError("Invalid PNG filter")
            row[x] = (row[x] + predictor) & 255
        pixels.extend(row)
        previous = row
    return width, height, channels, pixels


def png_bytes(size, rgba):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    rows = b"".join(b"\0" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))
    return (b"\x89PNG\r\n\x1a\n" +
            chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def render_icon(source, size, color=(0, 230, 0)):
    width, height, channels, pixels = source
    output = bytearray(size * size * 4)
    inset, radius = 0.04, 0.18
    lo, hi = inset + radius, 1 - inset - radius
    for y in range(size):
        for x in range(size):
            coverage = green = 0
            # Four samples per pixel antialias both the outline and silhouette.
            for dy in (0.25, 0.75):
                for dx in (0.25, 0.75):
                    nx, ny = (x + dx) / size, (y + dy) / size
                    if not inset <= nx <= 1 - inset or not inset <= ny <= 1 - inset:
                        continue
                    cx, cy = min(hi, max(lo, nx)), min(hi, max(lo, ny))
                    if (nx - cx) ** 2 + (ny - cy) ** 2 > radius ** 2:
                        continue
                    coverage += 1
                    sx = min(width - 1, int((nx - inset) / (1 - 2 * inset) * width))
                    sy = min(height - 1, int((ny - inset) / (1 - 2 * inset) * height))
                    index = (sy * width + sx) * channels
                    # The approved source is black on green. Flatten all green
                    # shades/noise to the same opaque color, preserve the man.
                    if pixels[index + 1] >= 100:
                        green += 1
            index = (y * size + x) * 4
            if coverage:
                output[index:index + 4] = bytes((*[round(channel * green / coverage) for channel in color], round(255 * coverage / 4)))
    return bytes(output)


def build_icon(output_dir=None, color=(0, 230, 0)):
    output_dir = Path(output_dir) if output_dir else ROOT / "assets"
    output_dir.mkdir(parents=True, exist_ok=True)
    source = read_png(ROOT / "assets/icon-source.png")
    chunks = []
    for kind, size in [(b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128),
                       (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)]:
        data = png_bytes(size, render_icon(source, size, color))
        chunks.append(kind + struct.pack(">I", len(data) + 8) + data)
        if size == 1024:
            (output_dir / "kasholkaTTS.png").write_bytes(data)
    payload = b"".join(chunks)
    destination = output_dir / "kasholkaTTS.icns"
    destination.write_bytes(b"icns" + struct.pack(">I", len(payload) + 8) + payload)
    print(destination)


if __name__ == "__main__":
    build_icon()
