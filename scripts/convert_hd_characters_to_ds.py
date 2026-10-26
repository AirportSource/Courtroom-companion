"""Reduce HD character sprites (3DS Trilogy / PC Trilogy HD sheets) to Nintendo-DS-style frames.

Raster reduction only (no generative imagery).  Per ANIMATION GROUP the script uses one scale
factor, one shared registration (the sheet cell origin, so frames never jitter), one union crop
and one shared palette; alpha is binary (no semi-transparent pixels).  Relative heights between
characters come from the platform scale factor, never from per-character normalisation.

    # list the frames the segmenter finds (and write a numbered overview PNG)
    python convert_hd_characters_to_ds.py SHEET --list [--overview overview.png]
    # convert two animations of one character (frame indices in reading order)
    python convert_hd_characters_to_ds.py SHEET --out DIR --name godot --platform 3ds \
           --profile B --anim idle=0-4 --anim talk=5-9
    python convert_hd_characters_to_ds.py --self-test

Sheet kinds are auto-detected: 'filler' (3DS: opaque blue filler + 1 px cell borders),
'alpha' (PC HD atlas: transparent gutters; NOTE these are part atlases, see --list) and
'solid' (DS: opaque solid background colour).
Safety: never writes inside the sheet's folder or inside frontend/public.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_metrics as M  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent

# HD pixels -> DS pixels, derived from registered DS/HD pairs (see report).  Filled by calibration.
PLATFORM_SCALE = {"3ds": 0.71, "pc": 0.148}


# ---------------------------------------------------------------- profiles
@dataclass(frozen=True)
class Profile:
    name: str
    resample: str = "lanczos"      # lanczos | box
    alpha_threshold: int = 128     # binary alpha cut (0-255) on the premultiplied-resampled alpha
    colours: int = 16              # shared palette size per animation group (opaque colours)
    kmeans_iters: int = 4
    min_speck: int = 1             # drop alpha components smaller than this many px
    fill_holes: int = 0            # fill transparent holes up to this many px inside the sprite


PROFILES = {
    "A": Profile("A", colours=32, kmeans_iters=2, min_speck=1),
    "B": Profile("B", colours=20, kmeans_iters=4, min_speck=2, fill_holes=1),
    "C": Profile("C", resample="box", colours=15, kmeans_iters=6, min_speck=3, fill_holes=2),
}


# ---------------------------------------------------------------- segmentation
@dataclass(frozen=True)
class Frame:
    index: int
    box: tuple[int, int, int, int]      # x0, y0, x1, y1 in the sheet (exclusive end)

    @property
    def size(self) -> tuple[int, int]:
        return (self.box[2] - self.box[0], self.box[3] - self.box[1])


def detect_kind(rgba: np.ndarray) -> tuple[str, tuple[int, int, int, int]]:
    """Return (kind, background-or-filler RGBA)."""
    a = rgba[..., 3]
    corner = tuple(int(v) for v in rgba[0, 0])
    if a.min() == 255:
        return "solid", corner
    return ("filler", corner) if corner[3] == 255 else ("alpha", (0, 0, 0, 0))


def _reading_order(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    boxes = sorted(boxes, key=lambda b: (b[1] + b[3]) / 2)
    rows: list[list] = []
    for b in boxes:
        cy = (b[1] + b[3]) / 2
        if rows and abs(cy - rows[-1][0]) < 0.4 * (b[3] - b[1]):
            rows[-1][1].append(b)
        else:
            rows.append([cy, [b]])
    return [b for _, r in rows for b in sorted(r, key=lambda b: b[0])]


def segment(rgba: np.ndarray, merge: int | None = None, min_area: int = 1500) -> tuple[str, list[Frame]]:
    kind, bg = detect_kind(rgba)
    if kind == "filler":                       # cells are the regions bounded by the filler grid
        mask = ~(rgba == np.array(bg, np.uint8)).all(-1)
        lab, n = ndi.label(mask)               # 4-connected
        merge_px = 0
    else:
        mask = ~(rgba == np.array(bg, np.uint8)).all(-1) if kind == "solid" else rgba[..., 3] > 16
        merge_px = 2 if merge is None else merge
        if kind == "alpha" and merge is None:
            merge_px = 12
        grown = ndi.binary_dilation(mask, iterations=merge_px) if merge_px else mask
        lab, n = ndi.label(grown, structure=np.ones((3, 3)))
    boxes = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None:
            continue
        region = (lab[sl] == i)
        if kind != "filler":
            region &= mask[sl]
            ys, xs = np.nonzero(region)
            if len(ys) == 0:
                continue
            box = (sl[1].start + int(xs.min()), sl[0].start + int(ys.min()),
                   sl[1].start + int(xs.max()) + 1, sl[0].start + int(ys.max()) + 1)
        else:
            box = (sl[1].start, sl[0].start, sl[1].stop, sl[0].stop)
        if int(region.sum()) >= min_area or (kind != "filler" and (box[2] - box[0]) * (box[3] - box[1]) >= min_area * 4):
            boxes.append(box)
    return kind, [Frame(i, b) for i, b in enumerate(_reading_order(boxes))]


def extract(rgba: np.ndarray, fr: Frame, kind: str) -> np.ndarray:
    x0, y0, x1, y1 = fr.box
    cell = rgba[y0:y1, x0:x1].copy()
    if kind == "solid":
        bg = rgba[0, 0]
        cell[(cell == bg).all(-1)] = (0, 0, 0, 0)
        cell[..., 3] = np.where(cell[..., 3] > 0, 255, 0)
    return cell


def parse_indices(spec: str) -> list[int]:
    out: list[int] = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out += range(int(a), int(b) + 1)
        else:
            out.append(int(part))
    return out


# ---------------------------------------------------------------- scaling + alpha cleanup
def scale_cell(cell: np.ndarray, scale: float, size: tuple[int, int], how: str) -> np.ndarray:
    """Premultiplied-alpha resample of a whole cell onto the shared output grid."""
    im = Image.fromarray(cell, "RGBA").convert("RGBa")
    flt = Image.LANCZOS if how == "lanczos" else Image.BOX
    out = im.resize(size, flt, box=(0, 0, cell.shape[1], cell.shape[0])).convert("RGBA")
    return np.asarray(out, np.uint8).copy()


def clean_alpha(rgba: np.ndarray, prof: Profile) -> np.ndarray:
    a = rgba[..., 3] >= prof.alpha_threshold
    if prof.fill_holes:
        inv, n = ndi.label(~a)
        if n:
            sizes = ndi.sum(np.ones_like(inv), inv, index=np.arange(1, n + 1))
            border = set(np.unique(np.concatenate([inv[0], inv[-1], inv[:, 0], inv[:, -1]])))
            for i, s in enumerate(sizes, start=1):
                if s <= prof.fill_holes and i not in border:
                    a[inv == i] = True
    if prof.min_speck > 1:
        lab, n = ndi.label(a, structure=np.ones((3, 3)))
        if n:
            sizes = ndi.sum(a, lab, index=np.arange(1, n + 1))
            for i, s in enumerate(sizes, start=1):
                if s < prof.min_speck:
                    a[lab == i] = False
    out = rgba.copy()
    # hole pixels take the colour of their nearest sprite pixel
    if (a & (rgba[..., 3] < prof.alpha_threshold)).any():
        idx = ndi.distance_transform_edt(rgba[..., 3] < prof.alpha_threshold, return_distances=False, return_indices=True)
        filled = rgba[idx[0], idx[1]]
        sel = a & (rgba[..., 3] < prof.alpha_threshold)
        out[sel] = filled[sel]
    out[..., 3] = np.where(a, 255, 0)
    out[~a, :3] = 0
    return out


# ---------------------------------------------------------------- shared palette
_W = np.array([3.0, 4.0, 2.0])


def _nearest(px: np.ndarray, pal: np.ndarray, chunk: int = 16384) -> np.ndarray:
    out = np.empty(len(px), np.int32)
    p = pal.astype(np.float64) * _W
    for i in range(0, len(px), chunk):
        d = (((px[i:i + chunk, None, :].astype(np.float64) * _W) - p[None]) ** 2).sum(-1)
        out[i:i + chunk] = d.argmin(1)
    return out


def shared_palette(frames: list[np.ndarray], colours: int, iters: int) -> np.ndarray:
    px = np.concatenate([f[f[..., 3] > 0][:, :3] for f in frames]) if frames else np.zeros((0, 3), np.uint8)
    if len(px) == 0:
        return np.zeros((1, 3), np.uint8)
    if len(np.unique(px, axis=0)) <= colours:
        return np.unique(px, axis=0)
    strip = Image.fromarray(px.reshape(-1, 1, 3), "RGB")
    q = strip.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[: 3 * colours], np.float64).reshape(-1, 3)
    sample = px[:: max(1, len(px) // 80000)]
    for _ in range(iters):
        idx = _nearest(sample, pal)
        for k in range(len(pal)):
            m = idx == k
            if m.any():
                pal[k] = sample[m].mean(0)
    return np.clip(np.rint(pal), 0, 255).astype(np.uint8)


def apply_palette(f: np.ndarray, pal: np.ndarray) -> np.ndarray:
    out = f.copy()
    m = f[..., 3] > 0
    if m.any():
        out[m, :3] = pal[_nearest(f[m][:, :3], pal)]
    return out


# ---------------------------------------------------------------- animation group
def convert_group(cells: list[np.ndarray], scale: float, prof: Profile, kind_cell_registered: bool = True) -> dict:
    """cells: RGBA HD frames of ONE animation (same registration). Returns frames + metadata."""
    H = max(c.shape[0] for c in cells)
    W = max(c.shape[1] for c in cells)
    padded = []
    for c in cells:                                # top-left registered (cell origin), pad bottom/right
        p = np.zeros((H, W, 4), np.uint8)
        p[: c.shape[0], : c.shape[1]] = c
        padded.append(p)
    size = (max(1, round(W * scale)), max(1, round(H * scale)))
    scaled = [clean_alpha(scale_cell(p, scale, size, prof.resample), prof) for p in padded]
    return {"scaled": scaled, "cell_size": size}


def finish_groups(groups: dict[str, dict], prof: Profile, shared: bool) -> dict[str, dict]:
    """Palette + union crop for each group (optionally one palette across all groups)."""
    pals = {}
    if shared:
        allf = [f for g in groups.values() for f in g["scaled"]]
        pal = shared_palette(allf, prof.colours, prof.kmeans_iters)
        pals = {k: pal for k in groups}
    else:
        pals = {k: shared_palette(g["scaled"], prof.colours, prof.kmeans_iters) for k, g in groups.items()}
    out = {}
    for k, g in groups.items():
        q = [apply_palette(f, pals[k]) for f in g["scaled"]]
        union = np.zeros(q[0].shape[:2], bool)
        for f in q:
            union |= f[..., 3] > 0
        ys, xs = np.nonzero(union)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        cw, ch = g["cell_size"]
        out[k] = {
            "frames": [f[y0:y1, x0:x1] for f in q],
            "palette": pals[k],
            "crop": [x0, y0, x1, y1],
            "cell_size": [cw, ch],
            # reference anchor = bottom-centre of the cell, expressed in canvas pixels
            "anchor": [cw / 2 - x0, ch - y0],
        }
    return out


def group_metrics(res: dict) -> dict:
    frames = res["frames"]
    allpx = np.concatenate([f.reshape(-1, 4) for f in frames])
    vis = allpx[allpx[:, 3] > 0]
    pal = {tuple(c) for c in res["palette"].tolist()}
    per_frame_cols = [M.colour_count(f) for f in frames]
    in_pal = float(np.mean([tuple(c) in pal for c in np.unique(vis[:, :3], axis=0)])) if len(vis) else 1.0
    boxes, feet = [], []
    for f in frames:
        ys, xs = np.nonzero(f[..., 3] > 0)
        boxes.append([int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])
        low = ys >= ys.max() - max(2, (ys.max() - ys.min()) // 6)      # lowest sixth of the silhouette
        feet.append(float(xs[low].mean()))
    return {
        "frames": len(frames), "canvas": [frames[0].shape[1], frames[0].shape[0]],
        "colours_union": M.colour_count(allpx.reshape(-1, 1, 4)), "colours_per_frame_max": max(per_frame_cols),
        "palette_size": int(len(res["palette"])), "palette_consistency": round(in_pal, 4),
        "semi_alpha_pct": round(max(M.semi_alpha_pct(f) for f in frames), 4),
        "bbox_bottom_drift_px": int(max(b[3] for b in boxes) - min(b[3] for b in boxes)),
        "foot_centre_drift_px": round(max(feet) - min(feet), 2),
        "anchor_drift_px": 0,       # by construction: every frame shares the cell origin and union crop
        "cell_size": res["cell_size"], "anchor": res["anchor"],
    }


def save_png(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr, "RGBA").save(path, format="PNG", optimize=False, compress_level=9)


# ---------------------------------------------------------------- driver
def check_output_dir(out: Path, sheet: Path) -> None:
    out = out.resolve()
    for b in ((REPO_ROOT / "frontend" / "public").resolve(), sheet.resolve().parent):
        if out == b or b in out.parents:
            sys.exit(f"refusing: output {out} is inside {b}")
    if any(p.lower() == "extract_assets_ace" for p in out.parts):
        sys.exit(f"refusing: output {out} is inside the source archive")


def run(sheet: Path, out: Path, name: str, scale: float, prof: Profile, anims: dict[str, list[int]],
        shared_palette_flag: bool = False) -> dict:
    check_output_dir(out, sheet)
    rgba = np.asarray(Image.open(sheet).convert("RGBA"), np.uint8)
    kind, frames = segment(rgba)
    groups = {}
    for an, idxs in anims.items():
        cells = [extract(rgba, frames[i], kind) for i in idxs]
        groups[an] = convert_group(cells, scale, prof)
    done = finish_groups(groups, prof, shared_palette_flag)
    report = {"character": name, "sheet": sheet.name, "kind": kind, "scale": scale, "profile": asdict(prof), "animations": {}}
    for an, res in done.items():
        d = out / name / an
        d.mkdir(parents=True, exist_ok=True)
        for i, f in enumerate(res["frames"]):
            save_png(f, d / f"{an}_frame_{i:03d}.png")
        report["animations"][an] = {"source_frames": anims[an], **group_metrics(res)}
    (out / name).mkdir(parents=True, exist_ok=True)
    (out / name / f"metrics_{prof.name}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    return report


def overview(rgba: np.ndarray, kind: str, frames: list[Frame], path: Path, max_w: int = 1400) -> None:
    bgc = (120, 160, 120, 255)
    canvas = Image.new("RGBA", (rgba.shape[1], rgba.shape[0]), bgc)
    canvas.alpha_composite(Image.fromarray(rgba, "RGBA"))
    d = ImageDraw.Draw(canvas)
    for f in frames:
        d.rectangle(f.box, outline=(255, 255, 0, 255))
        d.text((f.box[0] + 3, f.box[1] + 3), str(f.index), fill=(255, 255, 255, 255))
    s = min(1.0, max_w / canvas.width)
    canvas.convert("RGB").resize((int(canvas.width * s), int(canvas.height * s)), Image.LANCZOS).save(path)


# ---------------------------------------------------------------- self test
def _self_test() -> None:
    sheet = np.zeros((200, 420, 4), np.uint8)
    sheet[:] = (102, 128, 230, 255)
    for i in range(2):                                   # two 100x180 transparent cells with a blob
        x = 2 + i * 105
        sheet[2:182, x:x + 100] = (0, 0, 0, 0)
        yy, xx = np.mgrid[0:180, 0:100]
        blob = ((xx - 50 - i * 2) ** 2 + (yy - 120) ** 2) < 35 ** 2
        sheet[2:182, x:x + 100][blob] = (200, 30 + i * 20, 40, 255)
    kind, frames = segment(sheet)
    assert kind == "filler" and len(frames) == 2, (kind, len(frames))
    with tempfile.TemporaryDirectory() as td:
        sh = Path(td) / "src" / "s.png"
        sh.parent.mkdir()
        Image.fromarray(sheet, "RGBA").save(sh)
        hashes = []
        for k in range(2):
            rep = run(sh, Path(td) / f"o{k}", "t", 0.5, PROFILES["B"], {"a": [0, 1]})
            files = sorted((Path(td) / f"o{k}" / "t" / "a").glob("*.png"))
            hashes.append([M.sha256(p) for p in files])
        assert hashes[0] == hashes[1], "non-deterministic"
        m = rep["animations"]["a"]
        assert m["semi_alpha_pct"] == 0 and m["palette_consistency"] == 1.0 and m["anchor_drift_px"] == 0
        try:
            check_output_dir(sh.parent / "o", sh)
        except SystemExit:
            pass
        else:
            raise AssertionError("output next to source not refused")
    print("convert_hd_characters_to_ds self-test OK")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", nargs="?", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--name", default="character")
    ap.add_argument("--platform", choices=sorted(PLATFORM_SCALE))
    ap.add_argument("--scale", type=float, help="DS px per HD px (overrides --platform)")
    ap.add_argument("--profile", default="B", choices=sorted(PROFILES))
    ap.add_argument("--anim", action="append", default=[], metavar="NAME=I,J-K", help="animation group (frame indices)")
    ap.add_argument("--shared-palette", action="store_true", help="one palette across all --anim groups")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--overview", type=Path)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    if a.self_test:
        _self_test()
        return 0
    if not a.sheet:
        ap.error("SHEET required")
    rgba = np.asarray(Image.open(a.sheet).convert("RGBA"), np.uint8)
    kind, frames = segment(rgba)
    if a.list:
        print(f"kind={kind} frames={len(frames)}")
        for f in frames:
            print(f"{f.index:3d} box={f.box} size={f.size}")
        if a.overview:
            overview(rgba, kind, frames, a.overview)
        return 0
    scale = a.scale or PLATFORM_SCALE.get(a.platform or "")
    if not (a.out and a.anim and scale):
        ap.error("--out, --anim and --platform/--scale are required")
    anims = {n: parse_indices(s) for n, s in (x.split("=", 1) for x in a.anim)}
    rep = run(a.sheet, a.out, a.name, scale, PROFILES[a.profile], anims, a.shared_palette)
    print(json.dumps(rep["animations"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
