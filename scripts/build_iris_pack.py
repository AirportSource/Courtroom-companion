"""Build Iris's runtime visuals from the supplied pixel-art animation GIFs.

The source archive is read-only. Each ``(a)`` GIF is the idle/blink sequence and
each ``(b)`` GIF is the talking sequence. Pillow reconstructs the complete GIF
frames (including disposal) before they are cropped to a shared pose canvas.
Pixels, palette colours, frame order, and per-frame durations are preserved;
there is no scaling, resampling, or recolouring.

The hooded sources are inventoried in source.json but deliberately excluded from
the conversation pack so changing emotion cannot change Iris's costume.

Usage:  python scripts/build_iris_pack.py
        python scripts/build_iris_pack.py --check
        python scripts/build_iris_pack.py --qa-dir build/iris-ds-qa
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path("assets/characters/sprites_iris")
PACK = ROOT / "frontend/public/assets/characters/iris"
ACTIVE_POSES = ("normal", "blush", "crying", "serious", "surprised", "thinking")
SOURCE_ONLY_POSES = ("hood", "hood-oh")
SOURCE_SUFFIXES = ("a", "b")
PORTRAIT_CROP = (96, 28, 160, 92)
SELECTION_SIZE = 170

# The supplied thinking talking GIF has a truncated final data block. Pillow can
# still deterministically decode all 37 complete logical frames. Keep this
# explicit rather than silently substituting or dropping the source animation.
ImageFile.LOAD_TRUNCATED_IMAGES = True


@dataclass(frozen=True)
class DecodedGif:
    path: Path
    frames: tuple[Image.Image, ...]
    durations: tuple[int, ...]
    disposal: tuple[int | None, ...]


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def source_path(pose: str, suffix: str) -> Path:
    return ROOT / SOURCE_DIR / f"iris-{pose}({suffix}).gif"


def decode(path: Path) -> DecodedGif:
    image = Image.open(path)
    frames: list[Image.Image] = []
    durations: list[int] = []
    disposal: list[int | None] = []
    for index in range(image.n_frames):
        image.seek(index)
        # convert() returns the complete composited logical frame, not a partial
        # GIF update rectangle. copy() disconnects it from the mutable decoder.
        frames.append(image.convert("RGBA").copy())
        durations.append(int(image.info.get("duration", 100)))
        disposal.append(getattr(image, "disposal_method", None))
    if not frames or any(frame.size != (256, 192) for frame in frames):
        raise ValueError(f"{path}: expected non-empty 256x192 animation")
    return DecodedGif(path, tuple(frames), tuple(durations), tuple(disposal))


def union_bbox(decoded: tuple[DecodedGif, DecodedGif]) -> tuple[int, int, int, int]:
    boxes = [frame.getbbox() for gif in decoded for frame in gif.frames]
    if any(box is None for box in boxes):
        raise ValueError(f"{decoded[0].path}: empty frame")
    valid = [box for box in boxes if box is not None]
    return (
        min(box[0] for box in valid),
        min(box[1] for box in valid),
        max(box[2] for box in valid),
        max(box[3] for box in valid),
    )


def install_pose(pose: str) -> tuple[dict, dict, dict[str, Image.Image]]:
    idle = decode(source_path(pose, "a"))
    talking = decode(source_path(pose, "b"))
    bbox = union_bbox((idle, talking))
    unique: dict[str, tuple[str, Image.Image]] = {}
    images: dict[str, Image.Image] = {}

    def sequence(gif: DecodedGif) -> list[str]:
        paths: list[str] = []
        for frame in gif.frames:
            crop = frame.crop(bbox)
            digest = sha_bytes(crop.tobytes())
            if digest not in unique:
                rel = f"sprites/{pose}/{pose}_frame_{len(unique):03d}.png"
                unique[digest] = (rel, crop)
                images[rel] = crop
            paths.append(unique[digest][0])
        return paths

    idle_paths = sequence(idle)
    talking_paths = sequence(talking)
    width, height = bbox[2] - bbox[0], bbox[3] - bbox[1]
    animation = {
        "canvas": {"width": width, "height": height},
        "idle": {
            "fps": 10,
            "loop": True,
            "frameDurations": list(idle.durations),
            "holdJitterMs": 0,
            "frames": idle_paths,
            "offsets": [[0, 0] for _ in idle_paths],
        },
        "talking": {
            "fps": 10,
            "loop": True,
            "frameDurations": list(talking.durations),
            "frames": talking_paths,
            "offsets": [[0, 0] for _ in talking_paths],
        },
    }
    metrics = {
        "canvas": [width, height],
        "sourceBbox": list(bbox),
        "idleFrames": len(idle.frames),
        "talkingFrames": len(talking.frames),
        "uniqueFrames": len(unique),
        "idleDurationMs": sum(idle.durations),
        "talkingDurationMs": sum(talking.durations),
        "disposalMethods": sorted({value for value in idle.disposal + talking.disposal if value is not None}),
    }
    sources = {
        suffix: {
            "path": (SOURCE_DIR / f"iris-{pose}({suffix}).gif").as_posix(),
            "sha256": sha(source_path(pose, suffix)),
            "frames": len(decoded.frames),
        }
        for suffix, decoded in (("a", idle), ("b", talking))
    }
    return animation, {"sources": sources, "metrics": metrics}, images


def portraits() -> dict[str, Image.Image]:
    normal = decode(source_path("normal", "a")).frames[0]
    portrait = normal.crop(PORTRAIT_CROP)
    bbox = normal.getbbox()
    if bbox is None:
        raise ValueError("normal source frame is empty")
    figure = normal.crop(bbox)
    selection = Image.new("RGBA", (SELECTION_SIZE, SELECTION_SIZE))
    selection.alpha_composite(figure, ((SELECTION_SIZE - figure.width) // 2, SELECTION_SIZE - figure.height))
    return {"portraits/court_record.png": portrait, "portraits/selection.png": selection}


def build_outputs() -> tuple[dict, dict, dict[str, Image.Image]]:
    animations: dict[str, dict] = {}
    inventory: dict[str, dict] = {}
    images: dict[str, Image.Image] = {}
    for pose in ACTIVE_POSES:
        animation, details, pose_images = install_pose(pose)
        animations[pose] = animation
        inventory[pose] = details
        images.update(pose_images)
    images.update(portraits())

    excluded = {}
    for pose in SOURCE_ONLY_POSES:
        excluded[pose] = {
            "reason": "hooded costume excluded from normal conversation to prevent emotion-driven outfit changes",
            "sources": {
                suffix: {
                    "path": (SOURCE_DIR / f"iris-{pose}({suffix}).gif").as_posix(),
                    "sha256": sha(source_path(pose, suffix)),
                    "frames": len(decode(source_path(pose, suffix)).frames),
                }
                for suffix in SOURCE_SUFFIXES
            },
        }
    provenance = {
        "sourceDirectory": SOURCE_DIR.as_posix(),
        "sourcePlatform": "supplied pixel-art animation GIFs; original game/platform provenance not independently verified",
        "sourceCanvas": [256, 192],
        "extraction": {
            "builder": "scripts/build_iris_pack.py",
            "method": "Pillow GIF disposal reconstruction, shared-pose alpha crop, exact RGBA pixels; no scaling or recolouring",
            "idleSuffix": "(a)",
            "talkingSuffix": "(b)",
            "loadTruncatedImages": True,
            "truncatedSource": "assets/characters/sprites_iris/iris-thinking(b).gif",
        },
        "activePoses": inventory,
        "sourceOnlyPoses": excluded,
        "portrait": {
            "from": "assets/characters/sprites_iris/iris-normal(a).gif frame 0",
            "crop": [PORTRAIT_CROP[0], PORTRAIT_CROP[1], 64, 64],
            "nativePixelScale": True,
        },
        "selectionPreview": {
            "from": "assets/characters/sprites_iris/iris-normal(a).gif frame 0",
            "canvas": [SELECTION_SIZE, SELECTION_SIZE],
            "nativePixelScale": True,
        },
    }
    return animations, provenance, images


def update_manifest(animations: dict) -> dict:
    manifest = json.loads((PACK / "character.json").read_text(encoding="utf-8"))
    emotions = {
        "neutral": {"animation": "normal"},
        "happy": {"animation": "blush"},
        "polite": {"animation": "normal"},
        "grateful": {"animation": "blush"},
        "serious": {"animation": "serious"},
        "surprised": {"animation": "surprised"},
        "thinking": {"animation": "thinking"},
        "sad": {"animation": "crying"},
        "anxious": {"animation": "serious"},
        "embarrassed": {"animation": "blush"},
    }
    waiting = {"emotion": "thinking", "animation": "thinking"}
    manifest["animations"] = animations
    manifest["reactions"] = {}
    manifest["emotions"] = emotions
    manifest["waiting"] = waiting
    manifest["unassignedFrames"] = []
    group = manifest["presentationGroups"]["conversation"]
    group["inheritReactions"] = False
    group["animations"] = animations
    group["emotions"] = emotions
    group["waiting"] = waiting
    return manifest


def write_qa(path: Path, animations: dict, images: dict[str, Image.Image]) -> None:
    path.mkdir(parents=True, exist_ok=True)
    backgrounds = ROOT / "frontend/public/assets/backgrounds"
    candidates = sorted(backgrounds.glob("*.png"))
    bg = Image.open(candidates[0]).convert("RGBA") if candidates else Image.new("RGBA", (256, 192), (64, 64, 64, 255))
    if bg.size != (256, 192):
        bg = bg.resize((256, 192), Image.Resampling.NEAREST)
    cols = 3
    rows = (len(ACTIVE_POSES) + cols - 1) // cols
    for scale in (1, 3):
        sheet = Image.new("RGBA", (cols * 256 * scale, rows * 206 * scale), (48, 48, 48, 255))
        draw = ImageDraw.Draw(sheet)
        for index, pose in enumerate(ACTIVE_POSES):
            rel = animations[pose]["idle"]["frames"][0]
            frame = images[rel]
            cell = bg.copy()
            cell.alpha_composite(frame, ((256 - frame.width) // 2, 192 - frame.height))
            cell = cell.resize((256 * scale, 192 * scale), Image.Resampling.NEAREST)
            x = (index % cols) * 256 * scale
            y = (index // cols) * 206 * scale
            sheet.alpha_composite(cell, (x, y + 14 * scale))
            draw.text((x + 3 * scale, y + 2 * scale), pose, fill=(255, 255, 255, 255))
        sheet.convert("RGB").save(path / f"iris_poses_{scale}x.png")


def png_bytes(image: Image.Image) -> bytes:
    with tempfile.SpooledTemporaryFile() as handle:
        image.save(handle, format="PNG", compress_level=9)
        handle.seek(0)
        return handle.read()


def compare(expected: dict[str, Image.Image], manifest: dict, provenance: dict) -> list[str]:
    stale: list[str] = []
    for rel, image in expected.items():
        path = PACK / rel
        if not path.is_file() or path.read_bytes() != png_bytes(image):
            stale.append(rel)
    expected_sprites = {PACK / rel for rel in expected if rel.startswith("sprites/")}
    actual_sprites = set((PACK / "sprites").rglob("*.png")) if (PACK / "sprites").exists() else set()
    stale.extend(path.relative_to(PACK).as_posix() for path in sorted(actual_sprites - expected_sprites))
    if json.loads((PACK / "character.json").read_text(encoding="utf-8")) != manifest:
        stale.append("character.json")
    installed_source = json.loads((PACK / "source.json").read_text(encoding="utf-8"))
    expected_source = dict(provenance)
    expected_source["files"] = {rel: sha_bytes(png_bytes(image)) for rel, image in expected.items()}
    if installed_source != expected_source:
        stale.append("source.json")
    return stale


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--qa-dir", type=Path)
    args = parser.parse_args()
    animations, provenance, images = build_outputs()
    manifest = update_manifest(animations)
    if args.check:
        stale = compare(images, manifest, provenance)
        for rel in stale:
            print(f"stale: {rel}")
        print(f"{len(images) - len([p for p in stale if p in images])}/{len(images)} generated images match")
        return 1 if stale else 0

    sprites = (PACK / "sprites").resolve()
    pack = PACK.resolve()
    if sprites.parent != pack:
        raise RuntimeError(f"unsafe sprite cleanup target: {sprites}")
    if sprites.exists():
        shutil.rmtree(sprites)
    for rel, image in images.items():
        path = PACK / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(png_bytes(image))
    (PACK / "character.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    provenance["files"] = {rel: sha(PACK / rel) for rel in images}
    (PACK / "source.json").write_text(json.dumps(provenance, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.qa_dir:
        write_qa(ROOT / args.qa_dir, animations, images)
    print(f"installed {len(images)} native-scale pixel-art images across {len(ACTIVE_POSES)} poses")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
