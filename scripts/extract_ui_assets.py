#!/usr/bin/env python3
"""Prepare DS-scale UI sprites from the PC/HD Trilogy UI archive (status magnifier, music player).

    python scripts/extract_ui_assets.py "<archive>/other assets/UI" [--out frontend/public/assets/ui]

The archive path is a CLI argument only (never referenced at runtime). Requires Pillow + numpy.

Method (deterministic, no generative step): crop the opaque art, box-average (area) downscale by an
exact integer factor in premultiplied alpha, binarize alpha at 50% (35% for the thin note) (DS sprites carry no semi-alpha),
un-premultiply and quantize to a small palette without dithering.

  status/magnifier_working.png  28x28  <- Investigation Cursor, top-left cell (4,4,116,116) / 4
  status/magnifier_done.png     28x28  <- bottom-left cell (4,124,116,236) / 4 (blue + red check)
  (yellow variants, top-right / bottom-right, are intentionally not extracted yet)
  music-player/*.png                    <- musicPlayer_* buttons (68x68 crop / 4 = 17x17), note (28x40 / 2 = 14x20, alpha threshold 35% so thin strokes survive)
"""

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CURSOR = "PC _ Computer - Phoenix Wright_ Ace Attorney Trilogy - Miscellaneous - Investigation Cursor.png"

# name -> (source file, crop box, integer factor, colours)
STATUS = {
    "status/magnifier_working.png": (CURSOR, (4, 4, 116, 116), 4, 12),
    "status/magnifier_done.png": (CURSOR, (4, 124, 116, 236), 4, 14),
}
# Buttons are 72x142: blue state on top (2..70), yellow "pressed/highlight" below (72..140).
BTN_BLUE = (2, 2, 70, 70)
BTN_HOT = (2, 72, 70, 140)
MUSIC = {}
for _n in ("Play", "Pause", "Next", "Prev"):
    MUSIC[f"music-player/{_n.lower()}.png"] = (f"musicPlayer_player_{_n}.png", BTN_BLUE, 4, 8)
    MUSIC[f"music-player/{_n.lower()}_hot.png"] = (f"musicPlayer_player_{_n}.png", BTN_HOT, 4, 8)
MUSIC["music-player/note.png"] = ("musicPlayer_icon_note.png", (0, 2, 28, 42), 2, 3, 0.35)


def downscale_ds(img: Image.Image, factor: int, colours: int, threshold: float = 0.5) -> Image.Image:
    rgba = np.asarray(img.convert("RGBA"), dtype=np.float64)
    h, w = rgba.shape[0] // factor, rgba.shape[1] // factor
    if (h * factor, w * factor) != rgba.shape[:2]:
        raise ValueError(f"{img.size} is not a multiple of {factor}")
    alpha = rgba[..., 3:] / 255.0
    pre = np.concatenate([rgba[..., :3] * alpha, alpha], axis=-1)
    box = pre.reshape(h, factor, w, factor, 4).mean(axis=(1, 3))
    a = box[..., 3:]
    rgb = np.where(a > 0, box[..., :3] / np.maximum(a, 1e-9), 0)
    solid = a[..., 0] >= threshold
    out = np.zeros((h, w, 4), dtype=np.uint8)
    out[..., :3] = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    out[solid, 3] = 255
    # Palette over the opaque pixels only (median cut, no dithering), then restore binary alpha.
    opaque = Image.fromarray(out[..., :3]).quantize(colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    quant = np.asarray(opaque.convert("RGB"))
    out[..., :3] = np.where(solid[..., None], quant, 0)
    return Image.fromarray(out, "RGBA")


def metrics(img: Image.Image) -> str:
    arr = np.asarray(img)
    semi = int(((arr[..., 3] > 0) & (arr[..., 3] < 255)).sum())
    cols = len({tuple(p[:3]) for p in arr.reshape(-1, 4) if p[3]})
    return f"{img.size[0]}x{img.size[1]} colours={cols} semi-alpha={semi} opaque={int((arr[..., 3] == 255).sum())}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="archive folder holding the UI PNGs")
    ap.add_argument("--out", type=Path, default=ROOT / "frontend" / "public" / "assets" / "ui")
    args = ap.parse_args()
    for table in (STATUS, MUSIC):
        for rel, (src, box, factor, colours, *rest) in table.items():
            path = args.source / src
            if not path.is_file():
                print(f"missing source: {path}", file=sys.stderr)
                return 1
            crop = Image.open(path).convert("RGBA").crop(box)
            result = downscale_ds(crop, factor, colours, *rest)
            dest = args.out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            result.save(dest, optimize=True)
            print(f"{rel}: {metrics(result)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
