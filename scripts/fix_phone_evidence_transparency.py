#!/usr/bin/env python3
"""Rebuild the blue cellphone evidence icon with only its exterior matte transparent.

The source Court Record sheet stores every icon on an opaque slot background.  Starting from
the crop boundary, this script flood-fills pixels matching the corner colour and clears only
that connected exterior.  Matching grey pixels enclosed by the handset are deliberately kept.
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "references" / "court-record" / "evidences_profiles_full.png"
OUTPUT = ROOT / "frontend" / "public" / "assets" / "court-record" / "evidence" / "cellphone_blue.png"
RECT = (288, 501, 352, 565)


def remove_exterior_matte(image: Image.Image) -> tuple[Image.Image, int]:
    result = image.convert("RGBA")
    pixels = result.load()
    width, height = result.size
    matte = pixels[0, 0][:3]
    pending = deque(
        [(x, y) for x in range(width) for y in (0, height - 1)]
        + [(x, y) for y in range(1, height - 1) for x in (0, width - 1)]
    )
    exterior: set[tuple[int, int]] = set()
    while pending:
        point = pending.popleft()
        if point in exterior:
            continue
        x, y = point
        if pixels[x, y][:3] != matte:
            continue
        exterior.add(point)
        if x:
            pending.append((x - 1, y))
        if x + 1 < width:
            pending.append((x + 1, y))
        if y:
            pending.append((x, y - 1))
        if y + 1 < height:
            pending.append((x, y + 1))
    for x, y in exterior:
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = red, green, blue, 0
    return result, len(exterior)


def main() -> int:
    if not SOURCE.is_file():
        raise SystemExit(f"missing source sheet: {SOURCE}")
    source = Image.open(SOURCE)
    icon, cleared = remove_exterior_matte(source.crop(RECT))
    if icon.size != (64, 64):
        raise SystemExit(f"unexpected crop size: {icon.size}")
    alpha = icon.getchannel("A")
    if alpha.getextrema() != (0, 255):
        raise SystemExit(f"expected binary foreground/background alpha, got {alpha.getextrema()}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    icon.save(OUTPUT, optimize=True)
    print(f"{OUTPUT.relative_to(ROOT)}: cleared {cleared} edge-connected matte pixels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
