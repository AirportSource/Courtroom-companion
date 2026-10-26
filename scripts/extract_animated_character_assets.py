#!/usr/bin/env python3
"""Decode animated WebP/GIF/APNG into deterministic, full-canvas RGBA PNG frames.

Pillow's format decoders apply source disposal/blending before convert('RGBA').
No frame is cropped, resized, recoloured or interpolated. Source is read-only.
Usage: python scripts/extract_animated_character_assets.py SOURCE OUTPUT [--verify]
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


def webp_controls(source: Path) -> list[dict]:
    """Expose ANMF controls for audit; libwebp performs the actual compositing."""
    data = source.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return []
    controls, pos = [], 12
    while pos + 8 <= len(data):
        kind, size = data[pos:pos + 4], int.from_bytes(data[pos + 4:pos + 8], "little")
        body = data[pos + 8:pos + 8 + size]
        if kind == b"ANMF":
            u24 = lambda start: int.from_bytes(body[start:start + 3], "little")
            controls.append({"x": 2 * u24(0), "y": 2 * u24(3), "width": u24(6) + 1,
                             "height": u24(9) + 1, "durationMs": u24(12),
                             "disposeToBackground": bool(body[15] & 1),
                             "blend": not bool(body[15] & 2)})
        pos += 8 + size + size % 2
    return controls


def extract(source: Path, output: Path, verify: bool = False) -> dict:
    source = source.resolve(strict=True)
    output = output.resolve()
    if output == source.parent or source.parent in output.parents:
        raise ValueError("Output must be separate from the source directory")
    with Image.open(source) as image:
        report = {"source": source.name, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                  "format": image.format, "canvas": {"width": image.width, "height": image.height},
                  "animated": bool(getattr(image, "is_animated", False)),
                  "frameCount": getattr(image, "n_frames", 1), "loop": image.info.get("loop"),
                  "webpFrameControls": webp_controls(source), "frames": [],
                  "method": "Pillow composited RGBA full-canvas; no crop or resize"}
        if not verify:
            output.mkdir(parents=True, exist_ok=True)
        for index in range(report["frameCount"]):
            image.seek(index)
            frame = image.convert("RGBA")  # load first: WebP duration is populated by the decoder here
            duration = image.info.get("duration", 100)
            if not isinstance(duration, (int, float)) or duration <= 0:
                raise ValueError(f"{source.name} frame {index}: invalid duration {duration}")
            name = f"frame_{index:03d}.png"
            record = {"file": name, "durationMs": duration,
                      "rgbaSha256": hashlib.sha256(frame.tobytes()).hexdigest(),
                      "alphaRange": list(frame.getchannel("A").getextrema())}
            if "disposal_method" in dir(image):
                record["disposal"] = image.disposal_method
            if "blend_op" in dir(image):
                record["blend"] = image.blend_op
            if verify:
                with Image.open(output / name) as actual:
                    assert actual.size == image.size
                    assert actual.convert("RGBA").tobytes() == frame.tobytes(), (source.name, index)
            else:
                frame.save(output / name, format="PNG", compress_level=9)
            report["frames"].append(record)
        if verify:
            assert json.loads((output / "source.json").read_text(encoding="utf-8")) == report
        else:
            (output / "source.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    result = extract(args.source, args.output, args.verify)
    print(f"{result['source']}: {result['format']} {result['canvas']} {result['frameCount']} frames verified={args.verify}")
