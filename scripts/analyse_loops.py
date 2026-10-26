#!/usr/bin/env python3
"""Offline batch loop analyser for the built-in soundtrack (D-044 methodology, docs/MUSIC.md).

Measures loop points for every looping track of frontend/public/assets/music/soundtrack.json from the
INSTALLED runtime MP3s (never from any other location) and, with --write, stores the accepted ones.
Nothing here is an original Nintendo DS loop point, and nothing is verified by listening: every
written loop carries "status": "measured_not_auditioned".

Requirements (offline tooling only, not needed to run the app):
    pip install numpy imageio-ffmpeg      # imageio-ffmpeg ships a static ffmpeg; or have ffmpeg on PATH
    python scripts/analyse_loops.py                       # dry run over all installed tracks
    python scripts/analyse_loops.py --ids a,b --verbose   # selected manifest ids
    python scripts/analyse_loops.py --write               # add accepted loops to soundtrack.json
    python scripts/analyse_loops.py --write --replace-if-better   # also re-measure existing loops

Method (documented thresholds are unchanged from D-044):
  1. Decode to 44,100 Hz mono float (every channel averaged).
  2. Candidate lags: log-band + chroma frames (~46 ms hop), cosine self-similarity along every lag
     diagonal; the longest strongly repeating run per lag is a candidate (non-maximum suppression).
  3. The lag is refined at full rate by cross-correlation; the loop start slides later at that lag
     (a start at the top of the file lacks the decaying tail that precedes the loop end).
  4. Each candidate is scored on:
       coverage  - share of 3 s windows (0.5 s stride) of the 10 ms RMS envelope after the seam, from the seam
                   until 2 s before the fade, whose NCC with the same window after the loop START is > 0.95;
       envelope  - mean of those NCCs;
       seam      - 50 ms full-rate NCC after the jump, with the end refined by +-300 samples.
  5. Accept only when coverage >= 0.70, envelope >= 0.92, seam >= 0.95 and the loop lasts >= 8 s.
     confidence = coverage x envelope x seam. Among passing candidates the pick is the best
     confidence x length preference (longer loops preferred up to 40 s); ties keep the earliest start.
Tracks that do not pass stay loop: null with the best failing metrics recorded as "loopReason".
"""

from __future__ import annotations

import argparse
import re
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from concurrent.futures import ProcessPoolExecutor

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "frontend" / "public" / "assets" / "music"
MANIFEST = MUSIC / "soundtrack.json"

SR = 44100
ENV_HOP = 441  # 10 ms
ENV_WIN = 300  # 3 s of envelope
ENV_STRIDE = 50  # 0.5 s
SEAM_WIN = 2205  # 50 ms
SEAM_NUDGE = 300
FRAME_HOP = 2048  # ~46 ms
FRAME_FFT = 4096

COVERAGE_MIN = 0.70
ENVELOPE_MIN = 0.92
SEAM_MIN = 0.95
NCC_WINDOW_PASS = 0.95
MIN_LOOP_S = 8.0
PREFERRED_LOOP_S = 40.0
MIN_WINDOWS = 4
REPLACE_MARGIN = 0.05
TARGET_LUFS = -15.0  # loudness the per-track "gain" aims for (EBU R128 integrated, measured by ffmpeg ebur128)
PEAK_CEILING_DB = -1.0  # a boosted track must keep its sample peak under this
MAX_GAIN = 2.0
METHOD = "lag-diagonal+xcorr-v1"
STATUS = "measured_not_auditioned"
PROVENANCE = "curated-analysis"


# ----------------------------------------------------------------------------- decoding

def find_ffmpeg(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise SystemExit("ffmpeg not found: put it on PATH, pass --ffmpeg, or `pip install imageio-ffmpeg`")


def decode_mono(path: Path, ffmpeg: str) -> np.ndarray:
    cmd = [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype="<f4").astype(np.float64)


# ----------------------------------------------------------------------------- measures

def rms_envelope(x: np.ndarray) -> np.ndarray:
    n = len(x) // ENV_HOP
    return np.sqrt((x[: n * ENV_HOP].reshape(n, ENV_HOP) ** 2).mean(axis=1))


def fade_start_index(env: np.ndarray) -> int:
    """Envelope index where the closing fade/ending begins (the last time the 1 s level is >= 60 % of the body)."""
    kernel = np.ones(100) / 100
    smooth = np.convolve(env, kernel, mode="same")
    peak = smooth.max()
    if peak <= 0:
        return len(env)
    body = np.median(smooth[smooth > 0.2 * peak])
    above = np.nonzero(smooth >= 0.6 * body)[0]
    return int(above[-1]) if len(above) else len(env)


def window_ncc(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Row-wise Pearson correlation of two (n, w) arrays. Two flat rows count as identical."""
    a = a - a.mean(axis=1, keepdims=True)
    b = b - b.mean(axis=1, keepdims=True)
    na = np.sqrt((a * a).sum(axis=1))
    nb = np.sqrt((b * b).sum(axis=1))
    flat = (na < 1e-9) & (nb < 1e-9)
    denom = np.where((na < 1e-12) | (nb < 1e-12), 1.0, na * nb)
    out = (a * b).sum(axis=1) / denom
    out = np.where((na < 1e-12) | (nb < 1e-12), 0.0, out)
    return np.where(flat, 1.0, out)


def seam_best(x: np.ndarray, start: int, end: int) -> tuple[int, float]:
    """Refine `end` by +-SEAM_NUDGE samples; returns (end, NCC of the 50 ms after start vs after end)."""
    if start + SEAM_WIN > len(x) or end - SEAM_NUDGE < 0 or end + SEAM_NUDGE + SEAM_WIN > len(x):
        return end, 0.0
    a = x[start : start + SEAM_WIN]
    a = a - a.mean()
    region = x[end - SEAM_NUDGE : end + SEAM_NUDGE + SEAM_WIN]
    cross = np.correlate(region, a, mode="valid")  # (2*NUDGE+1,) dot products with the raw region
    csum = np.concatenate(([0.0], np.cumsum(region)))
    csq = np.concatenate(([0.0], np.cumsum(region * region)))
    idx = np.arange(2 * SEAM_NUDGE + 1)
    sums = csum[idx + SEAM_WIN] - csum[idx]
    sqs = csq[idx + SEAM_WIN] - csq[idx]
    var = np.maximum(sqs - sums * sums / SEAM_WIN, 0.0)
    denom = np.sqrt(var) * np.sqrt((a * a).sum())
    ncc = np.where(denom > 1e-9, cross / np.where(denom > 1e-9, denom, 1.0), 0.0)
    best = int(np.argmax(ncc))
    return end - SEAM_NUDGE + best, float(ncc[best])


def score_loop(x: np.ndarray, env: np.ndarray, fade_idx: int, start: int, end: int) -> dict:
    """Metrics for one (start, end). `end` is nudged by the seam refinement."""
    end, seam = seam_best(x, start, end)
    s_i, e_i = round(start / ENV_HOP), round(end / ENV_HOP)
    limit = fade_idx - 200  # until 2 s before the fade
    count = (limit - e_i - ENV_WIN) // ENV_STRIDE + 1
    if count < MIN_WINDOWS or s_i + (count - 1) * ENV_STRIDE + ENV_WIN > len(env):
        return dict(start=start, end=end, coverage=0.0, envelope=0.0, seam=seam, windows=max(count, 0))
    idx = np.arange(count)[:, None] * ENV_STRIDE + np.arange(ENV_WIN)[None, :]
    ncc = window_ncc(env[s_i + idx], env[e_i + idx])
    return dict(
        start=start,
        end=end,
        coverage=float((ncc > NCC_WINDOW_PASS).mean()),
        envelope=float(ncc.mean()),
        seam=seam,
        windows=int(count),
    )


def finish(m: dict) -> dict:
    length_s = (m["end"] - m["start"]) / SR
    m["confidence"] = m["coverage"] * m["envelope"] * max(m["seam"], 0.0)
    m["loopSeconds"] = length_s
    m["passes"] = bool(
        m["coverage"] >= COVERAGE_MIN
        and m["envelope"] >= ENVELOPE_MIN
        and m["seam"] >= SEAM_MIN
        and length_s >= MIN_LOOP_S
        and m["windows"] >= MIN_WINDOWS
    )
    m["preference"] = m["confidence"] * (0.85 + 0.15 * min(1.0, length_s / PREFERRED_LOOP_S))
    return m


# ----------------------------------------------------------------------------- candidate lags

def frame_features(x: np.ndarray) -> np.ndarray:
    frames = np.lib.stride_tricks.sliding_window_view(x, FRAME_FFT)[::FRAME_HOP]
    spec = np.abs(np.fft.rfft(frames * np.hanning(FRAME_FFT), axis=1)) ** 2
    freqs = np.fft.rfftfreq(FRAME_FFT, 1 / SR)
    edges = np.geomspace(50, 12000, 33)
    band_idx = np.searchsorted(freqs, edges)
    band = np.add.reduceat(spec, band_idx[:-1], axis=1)[:, :32]
    band_db = 10 * np.log10(band + 1e-10)
    band_db = np.maximum(band_db, band_db.max() - 70)
    chroma = np.zeros((len(spec), 12))
    sel = (freqs >= 60) & (freqs <= 2000)
    pc = np.round(12 * np.log2(freqs[sel] / 440.0) + 69).astype(int) % 12
    for c in range(12):
        chroma[:, c] = spec[:, sel][:, pc == c].sum(axis=1)
    chroma = chroma / (chroma.sum(axis=1, keepdims=True) + 1e-12)
    feats = np.concatenate([band_db / 10.0, chroma * 12.0], axis=1)
    feats = feats - feats.mean(axis=0, keepdims=True)
    return feats / (np.linalg.norm(feats, axis=1, keepdims=True) + 1e-9)


def longest_run(mask: np.ndarray) -> tuple[int, int]:
    padded = np.concatenate(([0], mask.astype(np.int8), [0]))
    delta = np.diff(padded)
    starts, ends = np.nonzero(delta == 1)[0], np.nonzero(delta == -1)[0]
    if len(starts) == 0:
        return 0, 0
    k = int(np.argmax(ends - starts))
    return int(ends[k] - starts[k]), int(starts[k])


def candidate_lags(feats: np.ndarray, thresholds: tuple[float, ...] = (0.80, 0.70, 0.60), per_threshold: int = 6) -> list[tuple[int, int, int, float]]:
    """(lag_frames, run_start_frame, run_len, mean_similarity) of the longest repeating run per lag.

    Runs are found at several similarity thresholds (a later pass of a recording may differ in
    orchestration); the exact metrics decide, not this stage. Non-maximum suppression per threshold.
    """
    t = len(feats)
    lag_min = int(MIN_LOOP_S * SR / FRAME_HOP)
    run_min = int(6 * SR / FRAME_HOP)
    kernel = np.ones(5) / 5
    found: dict[float, list[tuple[int, int, int, float]]] = {thr: [] for thr in thresholds}
    for lag in range(lag_min, t - run_min):
        sim = np.einsum("ij,ij->i", feats[: t - lag], feats[lag:])
        sim = np.convolve(sim, kernel, mode="same")
        for thr in thresholds:
            run, start = longest_run(sim > thr)
            if run >= run_min:
                found[thr].append((lag, start, run, float(sim[start : start + run].mean())))
    kept: list[tuple[int, int, int, float]] = []
    for thr in thresholds:
        ranked = sorted(found[thr], key=lambda c: c[2] * c[3], reverse=True)
        taken: list[tuple[int, int, int, float]] = []
        for cand in ranked:
            if all(abs(cand[0] - k[0]) > 4 for k in taken):
                taken.append(cand)
            if len(taken) >= per_threshold:
                break
        for cand in taken:
            if all(abs(cand[0] - k[0]) > 4 or abs(cand[1] - k[1]) > 20 for k in kept):
                kept.append(cand)
    return kept


def refine_lag(x: np.ndarray, anchor: int, lag: int, search: int = 3500) -> int:
    """Full-rate cross-correlation refinement of the repeat lag around `lag`."""
    n = 2 * SR
    a0 = anchor + SR // 2
    if a0 + lag + search + n > len(x) or a0 + n > len(x) or a0 + lag - search < 0:
        return lag
    a = x[a0 : a0 + n] - x[a0 : a0 + n].mean()
    region = x[a0 + lag - search : a0 + lag + search + n]
    size = 1 << (len(region) + n).bit_length()
    cross = np.fft.irfft(np.fft.rfft(region, size) * np.conj(np.fft.rfft(a, size)), size)[: 2 * search + 1]
    csq = np.concatenate(([0.0], np.cumsum(region * region)))
    csum = np.concatenate(([0.0], np.cumsum(region)))
    idx = np.arange(2 * search + 1)
    var = np.maximum((csq[idx + n] - csq[idx]) - (csum[idx + n] - csum[idx]) ** 2 / n, 1e-12)
    ncc = cross / (np.sqrt(var) * np.sqrt((a * a).sum()) + 1e-12)
    return lag - search + int(np.argmax(ncc))


def analyse_samples(x: np.ndarray, verbose: bool = False) -> dict:
    """Best loop for one decoded track: {'best': metrics|None, 'failBest': metrics|None, 'candidates': [...]}."""
    env = rms_envelope(x)
    fade_idx = fade_start_index(env)
    feats = frame_features(x)
    results = []
    for lag_f, run_start_f, run_len_f, sim in candidate_lags(feats):
        s0 = run_start_f * FRAME_HOP
        lag = refine_lag(x, s0, lag_f * FRAME_HOP)
        best_for_lag = None
        for start in range(max(0, s0 - SR), s0 + 25 * SR, SR // 10):
            if start + lag + SEAM_NUDGE + SEAM_WIN >= len(x):
                break
            m = finish(score_loop(x, env, fade_idx, start, start + lag))
            m["lagFrames"], m["runSeconds"], m["frameSimilarity"] = lag_f, run_len_f * FRAME_HOP / SR, sim
            # candidates for one lag: passing beats failing; then preference; then the earliest start
            key = (m["passes"], round(m["preference"], 2))
            if best_for_lag is None or key > best_for_lag[0]:
                best_for_lag = (key, m)
        if best_for_lag:
            results.append(best_for_lag[1])
            if verbose:
                m = best_for_lag[1]
                print(f"    lag {m['loopSeconds']:.2f}s start {m['start']/SR:.2f}s cov {m['coverage']:.2f} env {m['envelope']:.3f} "
                      f"seam {m['seam']:.3f} conf {m['confidence']:.2f} pass={m['passes']}")
    passing = [m for m in results if m["passes"]]
    best = max(passing, key=lambda m: (round(m["preference"], 2), -m["start"])) if passing else None
    fail_best = max(results, key=lambda m: m["confidence"]) if results and not best else None
    return {"best": best, "failBest": fail_best, "candidates": results, "durationSamples": len(x), "fadeSeconds": fade_idx / 100}


def measure_existing(x: np.ndarray, start: int, end: int) -> dict:
    env = rms_envelope(x)
    m = finish(score_loop(x, env, fade_start_index(env), start, end))
    return m


# ----------------------------------------------------------------------------- loudness

def measure_loudness(path: Path, ffmpeg: str) -> tuple[float, float]:
    """(integrated LUFS, sample peak dBFS) from ffmpeg's ebur128 filter."""
    out = subprocess.run([ffmpeg, "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    tail = out[out.rfind("Summary:"):]
    lufs = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))  # type: ignore[union-attr]
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail).group(1))  # type: ignore[union-attr]
    return lufs, peak


def gain_for(lufs: float, peak: float) -> float:
    """Linear gain bringing the track to TARGET_LUFS, capped so boosted peaks stay under PEAK_CEILING_DB."""
    wanted = 10 ** ((TARGET_LUFS - lufs) / 20)
    cap = min(MAX_GAIN, 10 ** ((PEAK_CEILING_DB - peak) / 20)) if peak < PEAK_CEILING_DB else 1.0
    return round(min(wanted, max(cap, 1.0)) if wanted > 1 else wanted, 2)


# ----------------------------------------------------------------------------- manifest

def loop_entry(m: dict) -> dict:
    return {
        "startSample": int(m["start"]),
        "endSample": int(m["end"]),
        "sampleRate": SR,
        "confidence": round(float(m["confidence"]), 2),
        "provenance": PROVENANCE,
        "method": METHOD,
        "status": STATUS,
        "note": (
            f"Offline batch analysis ({METHOD}, 44.1 kHz mono): post-seam 3 s envelope coverage {m['coverage']:.3f} over "
            f"{m['windows']} windows; envelope identity {m['envelope']:.4f}; full-rate seam correlation {m['seam']:.4f}; "
            f"loop {m['loopSeconds']:.1f} s. Not an original DS loop point; not verified by listening."
        ),
    }


def reason_text(result: dict, error: str | None = None) -> str:
    if error:
        return error
    m = result["failBest"]
    if m is None:
        return "no repeating section of at least 8 s found (no candidate lag)"
    why = []
    if m["coverage"] < COVERAGE_MIN:
        why.append(f"coverage {m['coverage']:.2f} < {COVERAGE_MIN}")
    if m["envelope"] < ENVELOPE_MIN:
        why.append(f"envelope identity {m['envelope']:.3f} < {ENVELOPE_MIN}")
    if m["seam"] < SEAM_MIN:
        why.append(f"seam correlation {m['seam']:.3f} < {SEAM_MIN}")
    if m["windows"] < MIN_WINDOWS:
        why.append(f"only {m['windows']} windows after the seam")
    if m["loopSeconds"] < MIN_LOOP_S:
        why.append(f"loop {m['loopSeconds']:.1f} s < {MIN_LOOP_S:.0f} s")
    return "best candidate " + f"{m['start']/SR:.2f}-{m['end']/SR:.2f} s fails: " + "; ".join(why or ["below thresholds"])


def write_manifest(raw: bytes, data: dict) -> None:
    newline = "\r\n" if b"\r\n" in raw else "\n"
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    MANIFEST.write_bytes(text.replace("\n", newline).encode("utf-8"))


def measure_track(job: tuple) -> tuple[str, dict]:
    """Decode + analyse one track (runs in a worker process). Returns (track_id, info)."""
    track_id, path, existing, ffmpeg, verbose = job
    x = None
    try:
        x = decode_mono(Path(path), ffmpeg)
        result = analyse_samples(x, verbose)
        error = None
    except Exception as exc:  # decoding failure etc. keeps the track unlooped, with the reason
        result, error = {"best": None, "failBest": None, "candidates": []}, f"analysis failed: {exc}"
    info: dict = {"duration": (len(x) / SR if x is not None else None)}
    if existing and x is not None:
        old = measure_existing(x, existing["startSample"], existing["endSample"])
        info["existing"] = {k: round(old[k], 4) for k in ("coverage", "envelope", "seam", "confidence", "loopSeconds")} | {"passes": old["passes"]}
    best = result["best"]
    if best:
        info["best"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in best.items()}
    else:
        info["reason"] = reason_text(result, error)
    return track_id, info


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ids", help="comma-separated manifest track ids (default: every installed track)")
    parser.add_argument("--write", action="store_true", help="store accepted loops / reasons in soundtrack.json")
    parser.add_argument("--replace-if-better", action="store_true",
                        help="re-measure existing loops and replace one only when the new loop's confidence is strictly higher")
    parser.add_argument("--gains", action="store_true",
                        help="only measure loudness and (with --write) store per-track gain toward "
                             f"{TARGET_LUFS:.0f} LUFS (and loudnessLufs); no loop analysis")
    parser.add_argument("--report", help="write the full per-track JSON report to this file")
    parser.add_argument("--ffmpeg", help="path to ffmpeg (default: PATH, then imageio-ffmpeg)")
    parser.add_argument("--jobs", type=int, default=min(4, os.cpu_count() or 1), help="parallel worker processes")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    raw = MANIFEST.read_bytes()
    manifest = json.loads(raw.decode("utf-8"))
    ffmpeg = find_ffmpeg(args.ffmpeg)
    if args.gains:
        for track_id, entry in manifest["tracks"].items():
            if not entry.get("src") or not (MUSIC / entry["src"]).exists():
                continue
            lufs, peak = measure_loudness(MUSIC / entry["src"], ffmpeg)
            gain = gain_for(lufs, peak)
            print(f"{track_id}: {lufs:.1f} LUFS, peak {peak:.1f} dBFS -> gain {gain}")
            if args.write:
                entry["gain"], entry["loudnessLufs"] = gain, lufs
        if args.write:
            write_manifest(raw, manifest)
            print("soundtrack.json updated")
        return 0
    wanted = set(args.ids.split(",")) if args.ids else None
    jobs = []
    for track_id, entry in manifest["tracks"].items():
        if (wanted is not None and track_id not in wanted) or not entry.get("src"):
            continue
        if not (MUSIC / entry["src"]).exists():
            print(f"{track_id}: not installed, skipped")
            continue
        jobs.append((track_id, str(MUSIC / entry["src"]), entry.get("loop"), ffmpeg, args.verbose))
    report: dict[str, dict] = {}
    if args.jobs > 1 and len(jobs) > 1:
        with ProcessPoolExecutor(max_workers=args.jobs) as pool:
            results = list(pool.map(measure_track, jobs))
    else:
        results = [measure_track(job) for job in jobs]
    for (track_id, info), job in zip(results, jobs):
        entry = manifest["tracks"][track_id]
        existing = entry.get("loop")
        best = info.get("best")
        print(track_id)
        if best:
            print(f"  loop {best['start']/SR:.3f}-{best['end']/SR:.3f}s ({best['loopSeconds']:.1f}s) conf {best['confidence']:.2f} "
                  f"cov {best['coverage']:.2f} env {best['envelope']:.3f} seam {best['seam']:.3f}")
        else:
            print(f"  no loop: {info['reason']}")
        if existing and info.get("existing"):
            print(f"  existing loop re-measured: conf {info['existing']['confidence']:.2f} pass={info['existing']['passes']}")
        report[track_id] = info
        if not args.write:
            continue
        if existing:
            existing.setdefault("status", STATUS)
            existing.setdefault("method", "curated-chrome-analysis-v1")
            old = info.get("existing")
            # Replace only when the new loop is clearly better: the old one fails the thresholds, or +0.05 confidence.
            better = bool(best) and (old is None or (not old["passes"]) or best["confidence"] >= old["confidence"] + REPLACE_MARGIN)
            if args.replace_if_better and better:
                print("  replacing the existing loop (re-measured strictly better)")
                entry["loop"] = loop_entry(best)
            elif old is not None and not old["passes"]:
                existing["note"] = (existing.get("note", "") + f" Independent re-measure ({METHOD}): coverage {old['coverage']:.2f}, "
                                    f"envelope {old['envelope']:.3f}, seam {old['seam']:.3f} - below the D-044 thresholds; kept unchanged, needs listening.").strip()
        elif best:
            entry["loop"] = loop_entry(best)
            entry.pop("loopReason", None)
        else:
            entry["loop"] = None
            entry["loopReason"] = info["reason"]
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.write:
        write_manifest(raw, manifest)
        print("soundtrack.json updated")
    looped = sum(1 for r in report.values() if "best" in r)
    print(f"{len(report)} tracks measured: {looped} with a loop, {len(report) - looped} without")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
