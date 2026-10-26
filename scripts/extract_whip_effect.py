"""Franziska whip slash overlay: reference GIF -> transparent 256x192 PNG frames (D-091).

Source (read-only): assets/other assets/whip/whip effect gif.gif — 400x240, 20 frames, GIF89a,
disposal 1 (frames accumulate), zero frame delays, opaque black substrate. The black is not part of
the effect (the GIF erases with black between swipes), so it is turned into alpha.

Steps, deterministic:
1. Composite every frame on the full canvas (Pillow applies disposal/partial tiles).
2. Black -> alpha: alpha = max(R, G, B); colour un-premultiplied (the slash is light cyan/white
   on black with dark anti-aliased edges, so this keeps the edge shape without a dark fringe).
3. Scale the 400x240 canvas by 0.8 (192 / 240, fills the stage height; premultiplied area
   averaging) to 320x192, keep the centre 256 columns. A few edge pixels of the widest slashes
   fall off-screen, as a full-screen slash should.
4. Binary alpha (>= 128) and a shared 32-colour palette for all frames, like DS effect sprites.

Timing: the GIF has no valid delays. FRAME_MS below is inferred (see docs/TARGETED_CORRECTIONS
follow-up / DECISIONS D-091), not read from the file. 1x1 "no change" GIF frames are kept as holds.

Usage: python scripts/extract_whip_effect.py [--check]
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "other assets" / "whip" / "whip effect gif.gif"
OUT = ROOT / "frontend" / "public" / "assets" / "characters" / "franziska" / "effects" / "whip_slash"
STAGE = (256, 192)
SCALE = 192 / 240
FRAME_MS = 40  # inferred: 20 frames -> 800 ms, two swipes of ~240 ms plus sparkle holds
COLOURS = 32


def frames_rgba(path: Path) -> list[np.ndarray]:
    with Image.open(path) as gif:
        return [np.asarray(frame.convert("RGB"), dtype=np.float64) / 255.0 for frame in ImageSequence.Iterator(gif)]


def to_stage(rgb: np.ndarray) -> np.ndarray:
    alpha = rgb.max(axis=2)
    # Premultiplied (= the RGB itself on black) area downscale, then un-premultiply.
    premul = np.dstack([rgb, alpha])
    height = STAGE[1]
    width = round(rgb.shape[1] * SCALE)
    channels = []
    for c in range(4):
        img = Image.fromarray((premul[..., c] * 65535).astype(np.uint16).astype(np.int32), mode="I")
        channels.append(np.asarray(img.resize((width, height), Image.Resampling.BOX), dtype=np.float64) / 65535)
    scaled = np.dstack(channels)
    left = (width - STAGE[0]) // 2
    scaled = scaled[:, left:left + STAGE[0]]
    a = scaled[..., 3]
    colour = np.where(a[..., None] > 0, scaled[..., :3] / np.maximum(a[..., None], 1e-9), 0)
    out = np.zeros((STAGE[1], STAGE[0], 4), dtype=np.uint8)
    keep = a >= 0.5
    out[..., :3] = np.clip(colour * 255 + 0.5, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(keep, 255, 0)
    out[~keep, :3] = 0
    return out


def quantize(frames: list[np.ndarray]) -> list[Image.Image]:
    opaque = np.concatenate([f[f[..., 3] == 255][:, :3] for f in frames if (f[..., 3] == 255).any()])
    strip = Image.fromarray(opaque.reshape(1, -1, 3), mode="RGB")
    palette = strip.quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    result = []
    for f in frames:
        rgb = Image.fromarray(f[..., :3], mode="RGB").quantize(palette=palette, dither=Image.Dither.NONE).convert("RGB")
        rgba = np.dstack([np.asarray(rgb), f[..., 3]])
        rgba[f[..., 3] == 0, :3] = 0
        result.append(Image.fromarray(rgba, mode="RGBA"))
    return result


def build() -> tuple[list[Image.Image], dict]:
    source_bytes = SOURCE.read_bytes()
    frames = quantize([to_stage(rgb) for rgb in frames_rgba(SOURCE)])
    meta = {
        "method": "GIF composited per frame (disposal 1), black substrate -> alpha (max RGB, un-premultiplied), "
                  f"premultiplied BOX downscale x{SCALE:.2f} to 320x192, centre 256x192 crop, binary alpha >= 128, "
                  f"shared {COLOURS}-colour palette",
        "source": "assets/other assets/whip/whip effect gif.gif",
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "sourceCanvas": [400, 240],
        "sourceFrameDelaysMs": "all 0 (invalid); timing below is inferred",
        "frameMs": FRAME_MS,
        "timingInferred": True,
        "frames": [],
    }
    for index, image in enumerate(frames):
        data = np.asarray(image)
        meta["frames"].append({"file": f"frame_{index:03d}.png", "opaquePixels": int((data[..., 3] == 255).sum())})
    return frames, meta


def main() -> int:
    frames, meta = build()
    if "--check" in sys.argv:
        for index, image in enumerate(frames):
            existing = OUT / f"frame_{index:03d}.png"
            if not existing.exists() or not np.array_equal(np.asarray(Image.open(existing).convert("RGBA")), np.asarray(image)):
                print(f"stale: {existing.relative_to(ROOT)}")
                return 1
        print(f"ok: {len(frames)} frames match the source")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for index, image in enumerate(frames):
        image.save(OUT / f"frame_{index:03d}.png", optimize=True)
    for entry in meta["frames"]:
        entry["sha256"] = hashlib.sha256((OUT / entry["file"]).read_bytes()).hexdigest()
    (OUT / "source.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(frames)} frames to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
