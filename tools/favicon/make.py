# Makes the PNG icons from the splash-logo geometry (src/favicon.svg is hand-written).
# Run from the repo root: uv run --with pillow python tools/favicon/make.py
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "src"

BG, COLORS = "#1b232d", ["#2d63c8", "#6f98d8", "#e9eef4"]
LAYERS = [  # bottom to top, in the 24-unit box
    [(3, 16.5), (12, 21), (21, 16.5), (12, 12)],
    [(3, 12), (12, 16.5), (21, 12), (12, 7.5)],
    [(3, 7.5), (12, 12), (21, 7.5), (12, 3)],
]

def icon(size, rounded):
    big, k = size * 8, size * 8 / 24  # draw at 8x, then shrink
    if rounded:  # 32x32: transparent corners
        img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
        ImageDraw.Draw(img).rounded_rectangle([0, 0, big - 1, big - 1], radius=5 * k, fill=BG)
    else:  # 180x180: opaque full-bleed square (iOS rounds the corners itself)
        img = Image.new("RGB", (big, big), BG)
    d = ImageDraw.Draw(img)
    for pts, color in zip(LAYERS, COLORS):
        d.polygon([(x * k, y * k) for x, y in pts], fill=color)
    return img.resize((size, size), Image.LANCZOS)

icon(32, True).save(OUT / "favicon-32.png")
icon(180, False).save(OUT / "apple-touch-icon.png")
# jumpstart-3d: install icons for the web manifest
icon(192, False).save(OUT / "icon-192.png")
icon(512, False).save(OUT / "icon-512.png")
