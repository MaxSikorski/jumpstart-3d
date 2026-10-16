#!/usr/bin/env python3
"""Generate the JumpStart 3D 1200x630 Open Graph social preview card.

Mirrors the app's drafting-table workspace: dark title-block bar on top,
light paper viewport, layout-fluid blue accent. Uses the exact CSS palette
from docs/index.html so the card matches the product.

No machine-specific paths: run from anywhere, output PNG is written relative
to this script (../docs/og-image.png). Fonts resolve via
JUMPSTART_FONT_DIR -> ./fonts -> ~/.fonts -> system font dirs, falling back
to DejaVu Sans.

Requirements: pip install Pillow (>=9).

Usage:
    python3 gen-og-image.py [--out PATH]
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Exact palette from docs/index.html :root
PAPER = (238, 241, 244)      # --paper
PANEL = (255, 255, 255)      # --panel
INK = (24, 32, 42)           # --ink
INK_2 = (72, 83, 97)         # --ink-2
BLOCK = (27, 35, 45)         # --block  (title-block bar)
BLOCK_2 = (42, 53, 66)       # --block-2
BLOCK_INK = (233, 238, 244)  # --block-ink
ACCENT = (31, 79, 168)       # --accent (layout-fluid blue)
ACCENT_2 = (45, 99, 200)     # --accent-2
ACCENT_SOFT = (228, 236, 250)  # --accent-soft
AMBER = (232, 163, 23)       # --amber
LINE = (216, 221, 227)       # --line

WIDTH, HEIGHT = 1200, 630
BAR_H = 96

FONT_NAMES = {
    "condensed_bold": "BarlowCondensed-Bold.ttf",
    "sans_bold": "IBMPlexSans-Bold.ttf",
    "sans_semibold": "IBMPlexSans-SemiBold.ttf",
    "sans_regular": "IBMPlexSans-Regular.ttf",
    "mono_regular": "IBMPlexMono-Regular.ttf",
}


def font_dirs() -> list[Path]:
    dirs: list[Path] = []
    env = os.environ.get("JUMPSTART_FONT_DIR")
    if env:
        dirs.append(Path(env))
    script_dir = Path(__file__).resolve().parent
    dirs.append(script_dir / "fonts")
    dirs.append(Path.home() / ".fonts")
    dirs.append(Path("/usr/share/fonts/truetype/ibmplexsans"))
    dirs.append(Path("/usr/share/fonts/truetype/barlow"))
    dirs.append(Path("/usr/share/fonts/truetype/dejavu"))
    return dirs


def load_font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    for d in font_dirs():
        p = d / FONT_NAMES[weight]
        if p.exists():
            return ImageFont.truetype(str(p), size)
    # Fallback: DejaVu Sans
    for d in font_dirs():
        p = d / "DejaVuSans.ttf"
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def rounded_rect(draw: ImageDraw.ImageDraw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    out = Path(args.out) if args.out else Path(__file__).resolve().parent.parent / "docs" / "og-image.png"

    img = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    d = ImageDraw.Draw(img)

    # Title-block bar (top)
    d.rectangle([0, 0, WIDTH, BAR_H], fill=BLOCK)
    d.rectangle([0, BAR_H, WIDTH, BAR_H + 4], fill=BLOCK_2)

    # App title in the bar (left), like the drafting-table title block
    f_title = load_font("condensed_bold", 52)
    d.text((48, 22), "JumpStart 3D", font=f_title, fill=BLOCK_INK)

    # Right side of bar: "3D CAD in your browser"
    f_bar = load_font("sans_regular", 24)
    d.text((WIDTH - 48, 34), "3D CAD in your browser", font=f_bar, fill=BLOCK_INK, anchor="ra")

    # Viewport: a light "drawing sheet" panel with a 3D-ish isometric cube motif
    panel = [80, 150, WIDTH - 80, 470]
    rounded_rect(d, panel, 18, PANEL)
    d.rectangle([80, 150, WIDTH - 80, 470], outline=LINE, width=2)

    # Isometric cube (three faces) in accent blue + amber, like a CAD part
    cx, cy = 300, 330
    s = 95
    # top face
    top = [(cx, cy - s), (cx + s, cy - s // 2), (cx, cy), (cx - s, cy - s // 2)]
    d.polygon(top, fill=ACCENT_2)
    # right face
    right = [(cx + s, cy - s // 2), (cx + s, cy + s // 2), (cx, cy + s), (cx, cy)]
    d.polygon(right, fill=ACCENT)
    # left face
    left = [(cx - s, cy - s // 2), (cx, cy), (cx, cy + s), (cx - s, cy + s // 2)]
    d.polygon(left, fill=ACCENT_SOFT)

    # A second smaller cube behind, amber accent
    cx2, cy2 = 470, 300
    s2 = 55
    top2 = [(cx2, cy2 - s2), (cx2 + s2, cy2 - s2 // 2), (cx2, cy2), (cx2 - s2, cy2 - s2 // 2)]
    d.polygon(top2, fill=AMBER)
    right2 = [(cx2 + s2, cy2 - s2 // 2), (cx2 + s2, cy2 + s2 // 2), (cx2, cy2 + s2), (cx2, cy2)]
    d.polygon(right2, fill=(200, 140, 20))
    left2 = [(cx2 - s2, cy2 - s2 // 2), (cx2, cy2), (cx2, cy2 + s2), (cx2 - s2, cy2 + s2 // 2)]
    d.polygon(left2, fill=(240, 200, 120))

    # Headline (right of the cubes)
    f_h1 = load_font("sans_bold", 40)
    d.text((560, 205), "Free 3D CAD in your browser", font=f_h1, fill=INK)
    f_sub = load_font("sans_regular", 28)
    d.text((560, 268), "No install. No account. No server.", font=f_sub, fill=INK_2)
    f_sub2 = load_font("sans_regular", 24)
    d.text((560, 316), "Beginner mode to full CAD kernel (OpenCascade).", font=f_sub2, fill=INK_2)

    # Bottom strip: tagline + URL
    d.rectangle([0, HEIGHT - 64, WIDTH, HEIGHT], fill=BLOCK)
    f_url = load_font("mono_regular", 22)
    d.text((48, HEIGHT - 40), "maxsikorski.github.io/jumpstart-3d", font=f_url, fill=BLOCK_INK)
    f_tag = load_font("sans_regular", 22)
    d.text((WIDTH - 48, HEIGHT - 40), "drag shapes · sketch · extrude · fillet", font=f_tag, fill=BLOCK_INK, anchor="ra")

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"Wrote {out} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
