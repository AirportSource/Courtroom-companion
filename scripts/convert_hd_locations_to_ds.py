"""Reduce HD location plates (1920x1080 / 3840x1080) to Nintendo-DS-style backgrounds.

Raster reduction only (no generative imagery):  crop -> area/Lanczos downsample ->
adaptive soften (only when above the DS high-frequency range) -> palette reduction
(median-cut + k-means refine, light ordered dither in B/C) -> opaque RGB PNG.  Deterministic: same input + options give
byte-identical output.  Writes a <name>.metrics.json beside every PNG.

    python convert_hd_locations_to_ds.py INPUT [INPUT ...] --out DIR [--profile A|B|C]
           [--framing auto|stage|full] [--resample box|area|lanczos] [--no-metrics]
    python convert_hd_locations_to_ds.py --self-test

Safety: refuses to write inside any input directory, inside the HD source archive
or inside frontend/public (this script never installs runtime assets).
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
import asset_metrics as M  # noqa: E402

STAGE_W, STAGE_H = 256, 192
REPO_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------- profiles
@dataclass(frozen=True)
class Profile:
    name: str
    resample: str = "area"      # box | area | lanczos
    soften_hf: float = 0.0      # adaptive softening: blur just enough to bring high-frequency energy
                                # down to this value (0 = off). DS plates: hf_energy 0.015-0.124, mean 0.067
    sharpen: float = 0.0        # unsharp-mask percent (0 = off); only if measurements justify it
    contrast: float = 1.0       # linear contrast about the mean luminance (1 = off)
    colours: int = 256          # palette size
    kmeans_iters: int = 0       # Lloyd refinement of the median-cut palette
    dither_amp: float = 0.0     # ordered-dither amplitude in RGB levels (0 = none); DS plates show ~1.5% checker px
    flatten: int = 0            # median-filter size (odd) to flatten texture, 0 = off


PROFILES = {
    # A: conservative - faithful reduction, only the 256-colour limit of DS plates.
    "A": Profile("A", resample="area", colours=256, kmeans_iters=0),
    # B: DS-balanced - tuned to the measured distribution of native DS backgrounds.
    "B": Profile("B", resample="area", soften_hf=0.09, colours=224, kmeans_iters=3, dither_amp=3.0),
    # C: stronger pixel reduction - fewer colours, flattened texture, hard palette steps.
    "C": Profile("C", resample="area", soften_hf=0.07, colours=64, kmeans_iters=3, dither_amp=4.0),
}


# ---------------------------------------------------------------- geometry
def crop_box(w: int, h: int, framing: str) -> tuple[float, float, float, float]:
    """Source crop (x0, y0, x1, y1). Height always maps to 192 px (one scale per plate)."""
    scale = STAGE_H / h
    if framing == "auto":
        framing = "full" if w / h >= 1.95 else "stage"      # panoramas keep full width
    if framing == "full":
        return (0.0, 0.0, float(w), float(h))
    # 'stage': centre crop to the DS 4:3 aspect (256 px wide at the plate's scale; 512 for 2x)
    cw = STAGE_W / scale
    n = max(1, int(w * scale // STAGE_W)) if w / h >= 1.95 else 1  # whole stage widths for panoramas
    cw = n * cw
    x0 = (w - cw) / 2
    return (x0, 0.0, x0 + cw, float(h))


def out_size(w: int, h: int, box: tuple[float, float, float, float]) -> tuple[int, int]:
    scale = STAGE_H / h
    return (max(1, round((box[2] - box[0]) * scale)), STAGE_H)


# ---------------------------------------------------------------- resampling
def downsample(im: Image.Image, box, size, how: str) -> Image.Image:
    if how == "box":
        return im.resize(size, Image.BOX, box=box)
    if how == "lanczos":
        return im.resize(size, Image.LANCZOS, box=box)
    if how == "area":
        # exact integer reduce() first (pure averaging), then fractional BOX to the target
        cropped = im.crop(tuple(int(round(v)) for v in box))
        f = max(1, min(cropped.width // size[0], cropped.height // size[1]))
        if f > 1:
            cropped = cropped.reduce(f)
        return cropped.resize(size, Image.BOX)
    raise ValueError(how)


# ---------------------------------------------------------------- palette
_W = np.array([3.0, 4.0, 2.0])  # perceptual-ish channel weights for nearest-colour search


def _nearest(px: np.ndarray, pal: np.ndarray, chunk: int = 8192) -> np.ndarray:
    out = np.empty(len(px), np.int32)
    p = pal.astype(np.float64) * _W
    for i in range(0, len(px), chunk):
        d = (((px[i:i + chunk, None, :].astype(np.float64) * _W) - p[None]) ** 2).sum(-1)
        out[i:i + chunk] = d.argmin(1)
    return out


_BAYER4 = (np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) + 0.5) / 16.0 - 0.5


def quantize(im: Image.Image, colours: int, kmeans_iters: int, dither_amp: float = 0.0) -> Image.Image:
    base = im.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(base.getpalette()[: 3 * colours], np.float64).reshape(-1, 3)
    arr = np.asarray(im, np.uint8).reshape(-1, 3)
    if kmeans_iters:
        sample = arr[:: max(1, len(arr) // 60000)]
        for _ in range(kmeans_iters):
            idx = _nearest(sample, pal)
            for k in range(len(pal)):
                m = idx == k
                if m.any():
                    pal[k] = sample[m].mean(0)
    pal = np.clip(np.rint(pal), 0, 255).astype(np.uint8)
    work = arr
    if dither_amp:
        h, w = im.height, im.width
        noise = np.tile(_BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w].reshape(-1, 1) * dither_amp
        work = np.clip(arr + noise, 0, 255)
    idx = _nearest(work, pal)
    return Image.fromarray(pal[idx].reshape(im.height, im.width, 3), "RGB")


# ---------------------------------------------------------------- softening
def _hf(im: Image.Image) -> float:
    return M.style_metrics(np.asarray(im, np.uint8))["hf_energy"]


def soften_to(im: Image.Image, target_hf: float) -> Image.Image:
    """Gaussian-blur only as much as needed to reach `target_hf` (no-op if already softer)."""
    if _hf(im) <= target_hf:
        return im
    lo, hi = 0.0, 1.0
    for _ in range(8):                                  # bisection on sigma, fixed count -> deterministic
        mid = (lo + hi) / 2
        if _hf(im.filter(ImageFilter.GaussianBlur(mid))) > target_hf:
            lo = mid
        else:
            hi = mid
    return im.filter(ImageFilter.GaussianBlur(hi))


# ---------------------------------------------------------------- pipeline
def convert(im: Image.Image, prof: Profile, framing: str = "auto") -> Image.Image:
    rgb = im.convert("RGB")                       # location plates are opaque; alpha dropped
    box = crop_box(rgb.width, rgb.height, framing)
    out = downsample(rgb, box, out_size(rgb.width, rgb.height, box), prof.resample)
    if prof.soften_hf:
        out = soften_to(out, prof.soften_hf)
    if prof.flatten:
        out = out.filter(ImageFilter.MedianFilter(prof.flatten))
    if prof.sharpen:
        out = out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=int(prof.sharpen), threshold=2))
    if prof.contrast != 1.0:
        a = np.asarray(out, np.float64)
        m = M.luminance(a).mean()
        out = Image.fromarray(np.clip((a - m) * prof.contrast + m, 0, 255).astype(np.uint8), "RGB")
    return quantize(out, prof.colours, prof.kmeans_iters, prof.dither_amp)


def save_png(im: Image.Image, path: Path) -> None:
    im.save(path, format="PNG", optimize=False, compress_level=9)   # no metadata -> deterministic


def reference_area(im: Image.Image, framing: str) -> Image.Image:
    """Plain area-downscale of the same crop: composition reference for SSIM."""
    rgb = im.convert("RGB")
    box = crop_box(rgb.width, rgb.height, framing)
    return downsample(rgb, box, out_size(rgb.width, rgb.height, box), "area")


def output_metrics(src: Path, dst: Path, img: Image.Image, ref: Image.Image, prof: Profile, framing: str) -> dict:
    a = np.asarray(img, np.uint8)
    rgba = np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])
    return {
        "source": src.name, "output": dst.name, "profile": prof.name, "framing": framing,
        "params": asdict(prof), "size": [img.width, img.height], "mode": img.mode,
        "colours": M.colour_count(rgba), "semi_alpha_pct": 0.0,
        "ssim_vs_area_source": round(M.ssim_rgb(a, np.asarray(ref, np.uint8)), 4),
        **M.style_metrics(a), "sha256": M.sha256(dst),
    }


# ---------------------------------------------------------------- IO safety
def check_output_dir(out: Path, inputs: list[Path]) -> None:
    out = out.resolve()
    banned = [(REPO_ROOT / "frontend" / "public").resolve()]
    banned += [p.resolve() if p.is_dir() else p.resolve().parent for p in inputs]
    for b in banned:
        if out == b or b in out.parents:
            sys.exit(f"refusing: output {out} is inside {b}")
    for part in out.parts:
        if part.lower() == "extract_assets_ace":
            sys.exit(f"refusing: output {out} is inside the source archive")


def collect(inputs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for p in inputs:
        files += sorted(p.rglob("*.png")) if p.is_dir() else [p]
    return files


def run(inputs: list[Path], out: Path, prof: Profile, framing: str, metrics: bool = True) -> list[dict]:
    check_output_dir(out, inputs)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for src in collect(inputs):
        with Image.open(src) as im:
            im.load()
            res = convert(im, prof, framing)
            dst = out / f"{src.stem}_{prof.name}.png"
            save_png(res, dst)
            if metrics:
                row = output_metrics(src, dst, res, reference_area(im, framing), prof, framing)
                dst.with_suffix(".metrics.json").write_text(json.dumps(row, indent=1), encoding="utf-8")
                rows.append(row)
    return rows


# ---------------------------------------------------------------- self test
def _self_test() -> None:
    rng = np.random.default_rng(7)
    base = rng.integers(0, 256, (27, 48, 3), dtype=np.uint8)
    img = Image.fromarray(base, "RGB").resize((1920, 1080), Image.BICUBIC)
    with tempfile.TemporaryDirectory() as td:
        src_dir = Path(td) / "src"
        src_dir.mkdir()
        img.save(src_dir / "t.png")
        outs = []
        for name in "ABC":
            for i in range(2):
                o = Path(td) / f"out{name}{i}"
                rows = run([src_dir], o, PROFILES[name], "auto")
                outs.append((name, rows[0]["sha256"]))
        assert outs[0][1] == outs[1][1] and outs[2][1] == outs[3][1], "non-deterministic"
        r = rows[0]
        assert r["size"] == [256, 192] and r["mode"] == "RGB" and r["colours"] <= 64
        try:
            check_output_dir(src_dir / "x", [src_dir])
        except SystemExit:
            pass
        else:
            raise AssertionError("output inside source not refused")
    assert out_size(3840, 1080, crop_box(3840, 1080, "auto")) == (683, 192)
    assert out_size(1920, 1080, crop_box(1920, 1080, "stage")) == (256, 192)
    assert out_size(3840, 1080, crop_box(3840, 1080, "stage")) == (512, 192)
    print("convert_hd_locations_to_ds self-test OK")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--profile", default="B", choices=sorted(PROFILES))
    ap.add_argument("--framing", default="auto", choices=["auto", "stage", "full"])
    ap.add_argument("--resample", choices=["box", "area", "lanczos"])
    ap.add_argument("--no-metrics", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    if a.self_test:
        _self_test()
        return 0
    if not a.inputs or not a.out:
        ap.error("INPUT and --out are required")
    prof = PROFILES[a.profile]
    if a.resample:
        prof = replace(prof, resample=a.resample)
    rows = run(a.inputs, a.out, prof, a.framing, not a.no_metrics)
    for r in rows:
        print(f"{r['output']}: {r['size']} colours={r['colours']} ssim={r['ssim_vs_area_source']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
