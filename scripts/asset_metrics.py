"""Image metrics shared by the HD->DS conversion scripts (Pillow + numpy only).

Run as a CLI to print metrics for images:   python asset_metrics.py a.png b.png
Run with --self-test to check the metric functions on synthetic data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


# ---------------------------------------------------------------- basics
def load_rgba(path: str | Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.uint8)


def luminance(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb[..., :3].astype(np.float64)
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def colour_count(rgba: np.ndarray, only_opaque: bool = True) -> int:
    px = rgba.reshape(-1, rgba.shape[-1])
    if only_opaque and px.shape[1] == 4:
        px = px[px[:, 3] > 0]
    if px.size == 0:
        return 0
    packed = (px[:, 0].astype(np.uint32) << 16) | (px[:, 1].astype(np.uint32) << 8) | px[:, 2]
    return int(np.unique(packed).size)


def semi_alpha_pct(rgba: np.ndarray) -> float:
    a = rgba[..., 3]
    return float(100.0 * np.count_nonzero((a > 0) & (a < 255)) / a.size)


def alpha_coverage_pct(rgba: np.ndarray) -> float:
    return float(100.0 * np.count_nonzero(rgba[..., 3] > 0) / rgba[..., 3].size)


# ---------------------------------------------------------------- style
def _box_mean(x: np.ndarray, k: int) -> np.ndarray:
    """Mean over a k x k window ('valid'), via an integral image."""
    c = np.pad(x, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def style_metrics(rgb: np.ndarray) -> dict:
    """Distribution-level style numbers: sharpness, contrast, saturation, dithering."""
    rgb = rgb[..., :3]
    y = luminance(rgb)
    gx = np.abs(np.diff(y, axis=1))
    gy = np.abs(np.diff(y, axis=0))
    g = np.concatenate([gx.ravel(), gy.ravel()])
    f = rgb.astype(np.float64) / 255.0
    mx, mn = f.max(-1), f.min(-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0)
    # high-frequency energy: share of luminance variance removed by a 3x3 box blur
    hf = y[1:-1, 1:-1] - _box_mean(y, 3)
    hf_energy = float((hf ** 2).mean() / max(y.var(), 1e-9))
    # local contrast: mean std-dev in 8x8 windows
    m1 = _box_mean(y, 8)
    m2 = _box_mean(y * y, 8)
    local_std = float(np.sqrt(np.maximum(m2 - m1 * m1, 0)).mean())
    # dithering: pixels forming a 2-colour checkerboard 2x2 cell
    a, b = rgb[:-1, :-1].astype(np.int32), rgb[:-1, 1:].astype(np.int32)
    c, d = rgb[1:, :-1].astype(np.int32), rgb[1:, 1:].astype(np.int32)
    eq = lambda p, q: (p == q).all(-1)
    checker = eq(a, d) & eq(b, c) & ~eq(a, b)
    return {
        "grad_mean": round(float(g.mean()), 3),
        "grad_p99": round(float(np.percentile(g, 99)), 2),
        "edge_px_pct": round(float(100 * (g > 24).mean()), 3),   # strong edges
        "soft_edge_px_pct": round(float(100 * ((g > 4) & (g <= 24)).mean()), 3),  # gradients/AA
        "flat_px_pct": round(float(100 * (g <= 1).mean()), 2),   # exactly-flat neighbours
        "hf_energy": round(hf_energy, 4),
        "local_std8": round(local_std, 2),
        "lum_mean": round(float(y.mean()), 2),
        "lum_std": round(float(y.std()), 2),
        "lum_p5_p95": [round(float(np.percentile(y, 5)), 1), round(float(np.percentile(y, 95)), 1)],
        "sat_mean": round(float(sat.mean()), 3),
        "sat_p95": round(float(np.percentile(sat, 95)), 3),
        "checker_dither_pct": round(float(100 * checker.mean()), 3),
    }


def palette_top_share(rgb: np.ndarray, n: int = 16) -> float:
    """Share of pixels covered by the n most common colours (palette 'peakiness')."""
    px = rgb.reshape(-1, 3).astype(np.uint32)
    packed = (px[:, 0] << 16) | (px[:, 1] << 8) | px[:, 2]
    _, counts = np.unique(packed, return_counts=True)
    counts = np.sort(counts)[::-1]
    return float(counts[:n].sum() / counts.sum())


# ---------------------------------------------------------------- similarity
def ssim(a: np.ndarray, b: np.ndarray, k: int = 7) -> float:
    """Mean SSIM of two same-sized 2-D float arrays (0..255), uniform k x k window."""
    assert a.shape == b.shape, (a.shape, b.shape)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = _box_mean(a, k), _box_mean(b, k)
    va = _box_mean(a * a, k) - ma * ma
    vb = _box_mean(b * b, k) - mb * mb
    cov = _box_mean(a * b, k) - ma * mb
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    return float(s.mean())


def ssim_rgb(a: np.ndarray, b: np.ndarray) -> float:
    return ssim(luminance(a), luminance(b))


# ---------------------------------------------------------------- self test
def _self_test() -> None:
    rng = np.random.default_rng(1)
    flat = np.full((32, 32, 3), 128, np.uint8)
    noise = rng.integers(0, 256, (32, 32, 3), dtype=np.uint8)
    assert abs(ssim_rgb(flat, flat) - 1.0) < 1e-9
    assert ssim_rgb(noise, flat) < 0.2
    assert colour_count(np.dstack([flat, np.full((32, 32), 255, np.uint8)])) == 1
    checker = np.zeros((32, 32, 3), np.uint8)
    checker[::2, ::2] = 255
    checker[1::2, 1::2] = 255
    assert style_metrics(checker)["checker_dither_pct"] > 90
    assert style_metrics(flat)["checker_dither_pct"] == 0
    rgba = np.zeros((4, 4, 4), np.uint8)
    rgba[0, 0] = (1, 2, 3, 128)
    assert semi_alpha_pct(rgba) == 100 / 16
    print("asset_metrics self-test OK")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("images", nargs="*")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        _self_test()
        return 0
    for p in args.images:
        rgba = load_rgba(p)
        out = {"file": str(p), "size": [rgba.shape[1], rgba.shape[0]],
               "colours": colour_count(rgba), "semi_alpha_pct": round(semi_alpha_pct(rgba), 3),
               **style_metrics(rgba)}
        print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
