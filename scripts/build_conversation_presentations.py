#!/usr/bin/env python3
"""Build only Miles/Franziska discussion derivatives; preserve legacy courtroom packs.

Run from repository root with declared requirements-assets.txt dependencies:
  backend/.venv/Scripts/python.exe scripts/build_conversation_presentations.py [--verify]
Sources are read-only. Re-running is deterministic; --verify never writes.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import extract_ds_character as ds
from extract_animated_character_assets import extract

ROOT = ds.CHAR_ROOT


def install_group(folder: str, group: dict, verify: bool) -> None:
    path = ROOT / folder / "character.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    expected = copy.deepcopy(manifest)
    expected["defaultPresentation"] = "conversation"
    expected["presentationGroups"] = {
        "conversation": group,
        "courtroom": {key: copy.deepcopy(manifest[key]) for key in ("animations", "emotions", "waiting")},
    }
    if verify:
        assert expected == manifest, folder
    else:
        path.write_text(json.dumps(expected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def miles(verify: bool) -> dict:
    sheet = ds.load_sheet(ds.AA1 + "Miles Edgeworth.png")
    poses = {
        "discussion_neutral": ([1, 2, 3, 4], [5, 6, 7, 8]),
        "discussion_aside": ([9, 10, 11, 12], [13, 14, 15, 16]),
        "discussion_stern": ([17, 18, 19, 20], [21, 22, 23, 24]),
        "discussion_thinking": ([25, 26, 27, 28], [29, 30, 31, 32]),
        "discussion_sad": ([33, 34, 35, 36], [39, 40, 41, 42]),
        "discussion_crossed": ([51, 52, 53, 54], [55, 56, 57, 58]),
        "discussion_smirk": ([63, 64, 65, 66], [71, 72, 73, 74]),
    }
    animations, audit = {}, {}
    for name, (idle, talk) in poses.items():
        frames = {n: ds.build_frame(sheet, n)[0] for n in idle + talk}
        clips = [ds.Clip(idle), ds.Clip(talk)]
        anchor, shifts = ds.register(frames, clips, idle[0], [(49, 49, 49), (82, 82, 82)], "shift")
        canvas, offsets = ds.make_canvas(frames, clips, anchor)
        animation = {"canvas": {"width": canvas[0], "height": canvas[1]}}
        composed = []
        for mode, clip, offs in zip(("idle", "talking"), clips, offsets):
            paths = []
            for n, offset in zip(clip.nums, offs):
                relative = f"conversation/{name}/{mode}/frame_{n:03d}.png"
                target = ROOT / "edgeworth" / relative
                # Shared registered union canvas is explicit; crops retain all source pixels.
                frame = Image.fromarray(frames[n])
                if verify:
                    with Image.open(target) as actual:
                        assert actual.convert("RGBA").tobytes() == frame.tobytes()
                        assert actual.size == frame.size
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    frame.save(target, format="PNG", compress_level=9)
                paths.append(relative)
                composed.append(ds.compose(frames, n, offset, canvas))
            animation[mode] = {"fps": 6, "loop": True, "frames": paths, "offsets": offs}
            if mode == "idle":
                animation[mode].update(frameDurations=ds.BLINK, holdJitterMs=1800)
        animations[name] = animation
        audit[name] = {"canvas": list(canvas), "sourceSprites": idle + talk,
                       "shifts": {str(n): list(shifts[n][:2]) for n in sorted(shifts)},
                       "maxLowerBodyResidualPixels": max(ds.residual(composed[0], f) for f in composed)}
    emotion_poses = {
        "neutral": "neutral", "happy": "smirk", "excited": "smirk", "thinking": "thinking",
        "surprised": "aside", "sad": "sad", "anxious": "sad", "playful": "smirk",
        "grateful": "neutral", "laughing": "smirk", "explaining": "neutral", "polite": "neutral",
        "relaxed": "smirk", "serious": "stern", "determined": "stern", "angry": "crossed",
        "suspicious": "crossed",
    }
    group = {"animations": animations,
             "emotions": {emotion: {"animation": f"discussion_{pose}"} for emotion, pose in emotion_poses.items()},
             "waiting": {"emotion": "thinking", "animation": "discussion_thinking"}}
    install_group("edgeworth", group, verify)
    return {"source": sheet.path.name, "sourceSha256": hashlib.sha256(sheet.path.read_bytes()).hexdigest(),
            "method": "Exact source pixels, integer body registration, one union canvas per idle/talk pose", "poses": audit}


def franziska(verify: bool) -> dict:
    source = ds.ARCHIVE / "Franziska"
    reports = {}
    for path in sorted(source.glob("*.webp")):
        reports[path.stem] = extract(path, ROOT / "franziska" / "conversation" / path.stem, verify)

    def clip(stem: str, loop: bool = True) -> dict:
        report = reports[stem]
        return {"fps": 10, "loop": loop,
                "frames": [f"conversation/{stem}/{f['file']}" for f in report["frames"]],
                "frameDurations": [f["durationMs"] for f in report["frames"]],
                "offsets": [[0, 0] for _ in report["frames"]]}

    prefix = "AA_Franziska_von_Karma_"
    animations = {}
    for name, idle, talking in [
        ("discussion_forward", "Normal_Forward_1", "Normal_Forward_2"),
        ("discussion_mocking", "Mocking_1", "Mocking_2"),
        ("discussion_pointing", "Pointing_1", "Pointing_2"),
    ]:
        animations[name] = {"canvas": {"width": 256, "height": 192},
                            "idle": clip(prefix + idle), "talking": clip(prefix + talking)}
    animations["discussion_disdain"] = {"canvas": {"width": 256, "height": 192},
                                         "idle": clip(prefix + "Distain_1"), "talking": clip("Franziska-hmph29")}
    animations["discussion_crying"] = {"canvas": {"width": 256, "height": 192},
                                       "idle": clip("Franziska_cries"), "talking": clip(prefix + "Crying_2")}
    emotion_poses = {
        "neutral": "forward", "happy": "mocking", "excited": "pointing", "thinking": "disdain",
        "surprised": "forward", "sad": "crying", "anxious": "disdain", "playful": "mocking",
        "grateful": "forward", "laughing": "mocking", "explaining": "pointing", "polite": "forward",
        "relaxed": "mocking", "serious": "forward", "determined": "pointing", "angry": "pointing",
        "suspicious": "disdain", "embarrassed": "disdain",
    }
    emotions = {emotion: {"animation": f"discussion_{pose}"} for emotion, pose in emotion_poses.items()}
    emotions["angry"]["reaction"] = "whip_crack"  # shared reaction, same semantic ID/SFX/cooldown
    install_group("franziska", {"animations": animations, "emotions": emotions,
                                "waiting": {"emotion": "thinking", "animation": "discussion_disdain"}}, verify)
    return {"sources": [{"source": r["source"], "format": r["format"], "canvas": r["canvas"],
                         "frames": r["frameCount"], "durationMs": sum(f["durationMs"] for f in r["frames"])}
                        for r in reports.values()],
            "method": "Pillow/libwebp source disposal/blend composition; unchanged full 256x192 transparent canvas"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    report = {"edgeworth": miles(args.verify), "franziska": franziska(args.verify)}
    path = ROOT / "conversation-extraction.json"
    if args.verify:
        assert json.loads(path.read_text(encoding="utf-8")) == report
    else:
        path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
