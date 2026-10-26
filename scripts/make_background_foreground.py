"""Cut a background's foreground layer (D-096): the parts that stand in front of characters.

bg_03 (detention center visitor room): the window frame and the counter are drawn in front of the
person on the other side of the glass, as in the games. Measured on the 256x192 plate:
left frame + bevel x 0-13, right bevel + frame x 240-255, sill line from y 153 down (black frame
y 156-167, counter y 168-191). Pixels are copied 1:1; everything else is transparent.

Usage: python scripts/make_background_foreground.py [--check]
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BACKGROUNDS = ROOT / "frontend" / "public" / "assets" / "backgrounds"
# id: (source plate, output, [(x0, y0, x1, y1) boxes kept, end-exclusive])
LAYERS = {
    "bg_03": ("background_03_256x192.png", "background_03_foreground.png",
              [(0, 0, 14, 192), (240, 0, 256, 192), (0, 153, 256, 192)]),
}


def build(source: str, boxes: list[tuple[int, int, int, int]]) -> Image.Image:
    plate = np.asarray(Image.open(BACKGROUNDS / source).convert("RGBA"))
    keep = np.zeros(plate.shape[:2], dtype=bool)
    for x0, y0, x1, y1 in boxes:
        keep[y0:y1, x0:x1] = True
    out = np.zeros_like(plate)
    out[keep] = plate[keep]
    return Image.fromarray(out, "RGBA")


def main() -> int:
    stale = False
    for source, target, boxes in LAYERS.values():
        image = build(source, boxes)
        path = BACKGROUNDS / target
        if "--check" in sys.argv:
            if not path.exists() or not np.array_equal(np.asarray(Image.open(path).convert("RGBA")), np.asarray(image)):
                print(f"stale: {path.relative_to(ROOT)}")
                stale = True
        else:
            image.save(path, optimize=True)
            print(f"wrote {path.relative_to(ROOT)}")
    return 1 if stale else 0


if __name__ == "__main__":
    raise SystemExit(main())
