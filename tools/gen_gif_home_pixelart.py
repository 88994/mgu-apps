#!/usr/bin/env python3
"""Generate the original, offline pixel-art loops bundled with GIF Home.

Requires Pillow. Run from any directory; output is deterministic for a given
Pillow version. The app itself needs no Python or image-generation dependency.
"""
from __future__ import annotations

import base64
import io
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "apps" / "gif_home" / "resources"
W, H = 192, 128
FRAMES = 18


def rect(d, box, fill):
    d.rectangle(tuple(round(p) for p in box), fill=fill)


def polygon(d, pts, fill):
    d.polygon([(round(x), round(y)) for x, y in pts], fill=fill)


def stars(d, frame, color):
    for n in range(26):
        x = (n * 67 + 19) % W
        y = (n * 31 + 7) % 67
        if (n + frame // 3) % 5:
            rect(d, (x, y, x + (n % 3 == 0), y + (n % 3 == 0)), color)


def street(d, frame, horizon=87, road="#17203c"):
    rect(d, (0, horizon, 191, 127), road)
    rect(d, (0, horizon, 191, horizon + 2), "#445176")
    rect(d, (0, 119, 191, 122), "#0b1226")
    for j in range(-1, 9):
        x = (j * 35 - frame * 8) % 270 - 40
        rect(d, (x, 112, x + 17, 113), "#ffd56e")


def silhouette(d, x, y, shade):
    polygon(d, [(x, y + 17), (x + 4, y + 7), (x + 12, y + 2),
                (x + 24, y + 2), (x + 29, y + 11), (x + 40, y + 14),
                (x + 45, y + 22), (x - 2, y + 22)], shade)


def side_bmw(d, x, y, body="#3d99ec", accent="#9be5ff", drift=False, phase=0):
    """Hand-drawn side/rear three-quarter BMW-like coupe, on a 192x128 grid."""
    sway = int(math.sin(phase * math.tau / FRAMES) * 2) if drift else 0
    x += sway
    # Shadow and displaced tyre tracks.
    rect(d, (x + 4, y + 31, x + 99, y + 34), "#080f22")
    for wx in (x + 23, x + 78):
        rect(d, (wx - 10, y + 26, wx + 6, y + 37), "#070b16")
        rect(d, (wx - 8, y + 27, wx + 5, y + 35), "#131b30")
        rect(d, (wx - 4, y + 29, wx + 2, y + 33), "#c4e9ff")
        rect(d, (wx - 2, y + 30, wx, y + 32), "#426581")
    polygon(d, [(x + 2, y + 23), (x + 10, y + 17), (x + 25, y + 15),
                (x + 36, y + 3), (x + 65, y + 2), (x + 80, y + 15),
                (x + 94, y + 18), (x + 102, y + 23), (x + 99, y + 29),
                (x + 4, y + 29)], "#0a1936")
    polygon(d, [(x + 5, y + 22), (x + 12, y + 17), (x + 27, y + 16),
                (x + 37, y + 4), (x + 63, y + 4), (x + 77, y + 16),
                (x + 95, y + 19), (x + 99, y + 23), (x + 97, y + 27),
                (x + 5, y + 27)], body)
    polygon(d, [(x + 37, y + 7), (x + 63, y + 7), (x + 73, y + 16),
                (x + 30, y + 16)], "#132643")
    polygon(d, [(x + 39, y + 8), (x + 48, y + 8), (x + 43, y + 15),
                (x + 32, y + 15)], "#457b9f")
    polygon(d, [(x + 52, y + 8), (x + 62, y + 8), (x + 70, y + 15),
                (x + 47, y + 15)], "#295078")
    rect(d, (x + 8, y + 20, x + 92, y + 21), accent)
    rect(d, (x + 29, y + 18, x + 30, y + 27), "#174e97")
    rect(d, (x + 75, y + 18, x + 76, y + 26), "#174e97")
    rect(d, (x + 44, y + 19, x + 52, y + 20), "#ddf8ff")
    rect(d, (x + 16, y + 25, x + 32, y + 27), "#103e77")
    rect(d, (x + 77, y + 25, x + 96, y + 27), "#123a74")
    # Paired kidney-grille detail, front facing towards the right.
    rect(d, (x + 91, y + 22, x + 93, y + 25), "#061326")
    rect(d, (x + 95, y + 22, x + 97, y + 25), "#061326")
    rect(d, (x + 97, y + 19, x + 101, y + 21), "#ebfaff")
    rect(d, (x + 7, y + 19, x + 10, y + 22), "#ff506e")
    rect(d, (x + 5, y + 24, x + 100, y + 25), "#1d5db1")
    if drift:
        rect(d, (x - 3, y + 17, x + 4, y + 19), "#ff6577")


def drift_city(frame):
    im = Image.new("RGB", (W, H), "#0b0923")
    d = ImageDraw.Draw(im)
    rect(d, (0, 0, 191, 69), "#181337")
    stars(d, frame, "#998cda")
    rect(d, (153, 15, 167, 29), "#ceb7ff")
    rect(d, (156, 15, 167, 27), "#0f102a")
    for n in range(11):
        x = (n * 23 + 3) % 200
        h = 21 + ((n * 17) % 27)
        rect(d, (x, 79 - h, x + 14, 79), "#121631" if n % 2 else "#1b2146")
        for j in range(2):
            for k in range(4):
                if (n + k + j + frame // 5) % 3:
                    rect(d, (x + 3 + j * 6, 83 - h + k * 6,
                             x + 5 + j * 6, 84 - h + k * 6), "#eab266")
    street(d, frame, 82, "#202242")
    rect(d, (0, 100, 191, 101), "#6b4585")
    # Expanding puffs behind the rear wheel, offset by the drift phase.
    for k in range(5):
        age = (frame * 4 + k * 15) % 100
        x = 69 - age
        y = 95 - age // 9 + (k % 2) * 6
        s = 4 + age // 10
        d.ellipse((x - s, y - s // 2, x + s, y + s), fill="#6a6998")
        rect(d, (x - s + 2, y - s // 2, x + s - 2, y), "#a0a4c6")
    side_bmw(d, 52 + round(5 * math.sin(frame * math.tau / FRAMES)),
             79 + frame % 3 - 1, "#398fe9", "#a5e9ff", drift=True, phase=frame)
    rect(d, (3, 3, 68, 14), "#13102d")
    d.text((7, 4), "DRIFT // 01", fill="#8bf5ff")
    return im


def sunset_drive(frame):
    im = Image.new("RGB", (W, H), "#37235a")
    d = ImageDraw.Draw(im)
    rect(d, (0, 40, 191, 68), "#7d3b80")
    rect(d, (0, 69, 191, 88), "#e56b78")
    rect(d, (0, 77, 191, 91), "#fb9b68")
    d.ellipse((127, 27, 173, 73), fill="#ffdb88")
    for n in range(4):
        rect(d, (122, 49 + n * 7, 177, 50 + n * 7), "#e56b78")
    for n in range(-1, 5):
        bx = n * 67 - (frame * 2) % 67
        polygon(d, [(bx - 36, 91), (bx + 10, 59), (bx + 48, 91)], "#682f75")
    street(d, frame, 91, "#312545")
    rect(d, (0, 106, 191, 107), "#f38f7e")
    side_bmw(d, 39 + frame % 2, 74, "#213b8d", "#93cdf4", phase=frame)
    rect(d, (6, 5, 88, 17), "#32234e")
    d.text((11, 7), "PIXEL TOURING", fill="#ffd38e")
    return im


def garage_nights(frame):
    im = Image.new("RGB", (W, H), "#071424")
    d = ImageDraw.Draw(im)
    rect(d, (0, 12, 191, 99), "#15233b")
    for k in range(7):
        x = k * 32
        rect(d, (x, 12, x + 2, 99), "#09172c")
    rect(d, (0, 28, 191, 30), "#243552")
    rect(d, (0, 62, 191, 64), "#253855")
    for k in range(4):
        x = 8 + k * 48
        rect(d, (x, 21, x + 30, 23), "#2dfbdf")
        rect(d, (x + 2, 24, x + 28, 25), "#185a67")
    rect(d, (0, 99, 191, 127), "#17233b")
    for k in range(10):
        x = k * 24 - 5
        polygon(d, [(x, 126), (x + 13, 101), (x + 15, 101), (x + 4, 126)], "#2a385a")
    # Breathing electric-blue underglow.
    pulse = 2 + (frame // 3) % 3
    rect(d, (43, 108, 153, 108 + pulse), "#124f95")
    side_bmw(d, 42, 72 + frame % 2, "#c8d8e6", "#f3fdff", phase=frame)
    rect(d, (46, 106, 146, 108), "#2fa9df")
    rect(d, (5, 3, 103, 15), "#101c32")
    d.text((10, 5), "AFTER HOURS", fill="#4df2dc")
    return im


def tunnel_run(frame):
    im = Image.new("RGB", (W, H), "#060b20")
    d = ImageDraw.Draw(im)
    for k in range(6):
        z = (k * 17 + frame * 5) % 110
        w = round(6 + z * 0.92)
        h = round(3 + z * 0.43)
        col = "#17275e" if k % 2 else "#5d43a1"
        d.rectangle((96 - w, 64 - h, 96 + w, 64 + h), outline=col, width=2)
    polygon(d, [(0, 127), (79, 72), (113, 72), (191, 127)], "#131d43")
    for k in range(4):
        y = 75 + ((frame * 3 + k * 14) % 48)
        span = (y - 72) * 2
        rect(d, (96 - span, y, 96 + span, y + 1), "#3e387b")
    # Rear-facing 8-bit BMW-inspired silhouette.
    bob = frame % 4 == 0
    polygon(d, [(57, 100 + bob), (64, 86 + bob), (72, 82 + bob),
                (120, 82 + bob), (128, 86 + bob), (135, 100 + bob),
                (135, 109 + bob), (57, 109 + bob)], "#1c64bd")
    polygon(d, [(74, 86 + bob), (118, 86 + bob), (122, 94 + bob),
                (70, 94 + bob)], "#102844")
    rect(d, (59, 98 + bob, 78, 103 + bob), "#ff485e")
    rect(d, (114, 98 + bob, 133, 103 + bob), "#ff485e")
    rect(d, (83, 100 + bob, 109, 105 + bob), "#121c36")
    rect(d, (92, 100 + bob, 101, 103 + bob), "#cce8ff")
    rect(d, (70, 109 + bob, 86, 114 + bob), "#050915")
    rect(d, (105, 109 + bob, 121, 114 + bob), "#050915")
    d.text((8, 6), "MIDNIGHT RUN", fill="#6cd8f5")
    return im


def export(name, draw_frame):
    images = [draw_frame(i) for i in range(FRAMES)]
    # Fixed palette means no distracting colour cycling from per-frame quantization.
    palette = images[0].quantize(colors=96, dither=Image.Dither.NONE)
    images = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
    stream = io.BytesIO()
    images[0].save(stream, format="GIF", save_all=True, append_images=images[1:],
                   duration=140, loop=0, optimize=True, disposal=2)
    raw = stream.getvalue()
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / (name + ".json")).write_text(
        json.dumps({"base64": base64.b64encode(raw).decode("ascii")}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"{name}: {len(raw)} bytes, {len(images)} frames")


if __name__ == "__main__":
    for name, art in (
        ("drift_city", drift_city),
        ("sunset_drive", sunset_drive),
        ("garage_nights", garage_nights),
        ("tunnel_run", tunnel_run),
    ):
        export(name, art)
