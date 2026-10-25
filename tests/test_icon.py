import importlib.util
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_icon", ROOT / "scripts/build_icon.py")
icon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(icon)


class IconTests(unittest.TestCase):
    def test_no_transparent_holes_or_side_shadows(self):
        width, height, channels, pixels = icon.read_png(ROOT / "assets/kasholkaTTS.png")
        self.assertEqual((width, height, channels), (1024, 1024, 4))
        def pixel(x, y):
            offset = (y * width + x) * channels
            return tuple(pixels[offset:offset + channels])
        self.assertEqual(pixel(0, 0)[3], 0)
        self.assertEqual(pixel(512, 512), (0, 0, 0, 255))
        # Broad rectangles on both sides of the walking man were damaged by
        # generated transparency. Every pixel here must now be opaque green.
        for y in range(240, 790):
            for x in list(range(180, 300)) + list(range(740, 850)):
                self.assertEqual(pixel(x, y), (0, 230, 0, 255))

    def test_icns_contains_all_icon_sizes(self):
        data = (ROOT / "assets/kasholkaTTS.icns").read_bytes()
        self.assertEqual(data[:4], b"icns")
        self.assertEqual(struct.unpack_from(">I", data, 4)[0], len(data))
        offset, sizes = 8, []
        while offset < len(data):
            length = struct.unpack_from(">I", data, offset + 4)[0]
            self.assertGreater(length, 8)
            png = data[offset + 8:offset + length]
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
            sizes.append(struct.unpack_from(">I", png, 16)[0])
            offset += length
        self.assertEqual(offset, len(data))
        self.assertEqual(sizes, [16, 32, 64, 128, 256, 512, 1024])
