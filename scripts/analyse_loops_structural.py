#!/usr/bin/env python3
"""Structural loop analyser v2 for the built-in soundtrack (docs/MUSIC.md, "2026-10-26 structural loop pass").

Why: scripts/analyse_loops.py (D-044) demands that the 10 ms RMS *envelope* of the second pass match the first
at NCC > 0.95. The original DS renders (D-088) repeat musically but not waveform- or envelope-identically
(reverb/LFO state, sub-ms timing), so most of them failed that test and fell back to "whole file" even though they
clearly contain INTRO? + LOOP BODY + repeat. This analyser decides on musical structure first and measures the seam
second:

  1. Frame features (32 log-band + 12 chroma, hop 2048 = 46 ms; shared with analyse_loops.py).
  2. Lag profile: for every candidate lag L (6 s .. 0.8 T) the cosine self-similarity along the diagonal,
     smoothed over ~0.7 s, thresholded, gaps up to 1.5 s merged -> the longest repeated run [r0, r1] and its mean
     similarity. Candidates are ranked by run length x similarity; lags shorter than min(0.4 T, 30 s) are only
     accepted as flagged short loops ("short"), the preferred loop is the longest musically repeated section.
  3. Lag refinement at full rate (cross-correlation at several anchors, median).
  4. Phase: the composition restarts at s_k = r0 + k L. Every k whose seam region has >= 3 s of repeated material
     after it and whose end is not inside the closing fade is evaluated; the LATEST k whose seam is as good as the
     best one (within 0.04) is chosen, so as much of the composition as possible plays before the first loop-back.
  5. Seam: start and end are searched at full rate (25 ms pre- and post-seam waveform NCC, +-300 samples for the end),
     then both are slid together (+-250 samples) to the best zero-crossing alignment (stereo click ratio).
  6. Evidence recorded per track: lag, repeat run, similarity, tail similarity, seam NCCs, click ratio, level step,
     tempo / beats-per-loop, first-loop-back share, confidence.

Deterministic (no randomness). Everything is measured on the installed runtime files at 44,100 Hz mono (stereo for
the click check): ffmpeg's MP3 handling is sample-identical to Chrome's decodeAudioData (checked for D-085); FLAC
(32,728 Hz) is resampled by ffmpeg while Chrome resamples to the context rate; both place a given time to < 1 sample
at 44.1 kHz, so the positions are stored in 44,100 Hz samples (the engine divides by loop.sampleRate).
Nothing is an original DS loop point; nothing is verified by listening (status measured_not_auditioned).

    python scripts/analyse_loops_structural.py --report scripts/data/ds_loop_analysis_v2.json [--ids a,b] [--all-installed]
    python scripts/analyse_loops_structural.py --report ... --write       # store loops / reasons in soundtrack.json
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyse_loops as A  # noqa: E402  (shared decoding, features, envelope helpers)

SR = A.SR
HOP = A.FRAME_HOP
HOP_S = HOP / SR
METHOD = "structural-lag-run+seam-v2"
SMOOTH_FRAMES = 15  # ~0.7 s
SIM_THRESHOLD = 0.72
GAP_MERGE_S = 1.5
MIN_REPEAT_RUN_S = 10.0
MIN_LAG_S = 6.0
SEAM_W = 2205  # 50 ms
SEAM_W_COARSE = 1102
SEAM_PASS = 0.75  # combined seam score (post NCC, plus 25% pre NCC for later phases)
POST_PASS = 0.85  # 50 ms waveform NCC of the content after the jump vs the render's own continuation at the loop end
CLICK_MAX = 3.0
LEVEL_STEP_MAX_DB = 4.0
K_TOLERANCE = 0.04
ACCEPT_SIM = 0.80
WEAK_SIM = 0.75  # accepted only when the repeated run covers a whole cycle (run >= lag); confidence is reduced
MIN_SUPPORT_AFTER_S = 3.0

SCOPE_LOOP_STATUS = "measured_not_auditioned"


# ----------------------------------------------------------------------------- decoding

def decode_stereo(path: Path, ffmpeg: str) -> np.ndarray:
    cmd = [ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"]
    out = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype="<f4").astype(np.float64).reshape(-1, 2)


# ----------------------------------------------------------------------------- lag profile

def merge_runs(mask: np.ndarray, gap: int) -> tuple[int, int]:
    """Longest run of True in `mask` after bridging gaps of at most `gap` frames. Returns (start, end) frames or (0, 0)."""
    idx = np.nonzero(mask)[0]
    if len(idx) == 0:
        return 0, 0
    best = (0, 0)
    start = prev = int(idx[0])
    for i in idx[1:]:
        i = int(i)
        if i - prev > gap + 1:
            if prev - start > best[1] - best[0]:
                best = (start, prev)
            start = i
        prev = i
    if prev - start > best[1] - best[0]:
        best = (start, prev)
    return best


def lag_candidates(feats: np.ndarray, duration_s: float, per_track: int = 8) -> list[dict]:
    t = len(feats)
    kernel = np.ones(SMOOTH_FRAMES) / SMOOTH_FRAMES
    gap = int(GAP_MERGE_S / HOP_S)
    lag_lo = int(MIN_LAG_S / HOP_S)
    lag_hi = min(int(0.8 * t), t - int(MIN_REPEAT_RUN_S / HOP_S))
    found = []
    for lag in range(lag_lo, lag_hi):
        sim = np.einsum("ij,ij->i", feats[: t - lag], feats[lag:])
        sm = np.convolve(sim, kernel, mode="same")
        a, b = merge_runs(sm > SIM_THRESHOLD, gap)
        if (b - a) * HOP_S < MIN_REPEAT_RUN_S:
            continue
        found.append({
            "lagFrames": lag, "r0f": a, "r1f": b,
            "run": (b - a) * HOP_S, "sim": float(sim[a : b + 1].mean()),
            "score": (b - a) * HOP_S * float(sim[a : b + 1].mean()) ** 2,
        })
    found.sort(key=lambda c: -c["score"])
    picked: list[dict] = []
    for cand in found:
        if all(abs(cand["lagFrames"] - p["lagFrames"]) > int(1.0 / HOP_S) for p in picked):
            picked.append(cand)
        if len(picked) >= per_track:
            break
    return picked


def refine_lag_median(x: np.ndarray, r0: float, r1: float, lag: int) -> int:
    anchors = np.linspace(r0 + 0.5, max(r0 + 0.5, r1 - 3.0), 6)
    vals = [A.refine_lag(x, int(a * SR), lag, search=int(0.4 * SR)) for a in anchors]
    return int(np.median(vals))


# ----------------------------------------------------------------------------- seam scoring

def ncc_matrix(ref: np.ndarray, region: np.ndarray, width: int) -> np.ndarray:
    """NCC (Pearson) of `ref` (width,) against every width-window of `region` (stride 1), via FFT cross-correlation + running sums."""
    rc = ref - ref.mean()
    cross = fftconvolve(region, rc[::-1], mode="valid")
    csum = np.concatenate(([0.0], np.cumsum(region)))
    csq = np.concatenate(([0.0], np.cumsum(region * region)))
    n = len(region) - width + 1
    idx = np.arange(n)
    sums = csum[idx + width] - csum[idx]
    var = np.maximum((csq[idx + width] - csq[idx]) - sums * sums / width, 0.0)
    denom = np.sqrt(var) * np.sqrt((rc * rc).sum())
    return np.where(denom > 1e-9, cross[:n] / np.where(denom > 1e-9, denom, 1.0), 0.0)


def seam_scores(x: np.ndarray, s: int, e0: int, width: int, nudge: int, step: int = 1, use_pre: bool = True) -> tuple[int, float, float, float]:
    """Best end e in e0 +- nudge. Returns (e, score, pre_ncc, post_ncc); pre is NaN when no pre-seam material exists."""
    lo, hi = e0 - nudge, e0 + nudge
    if hi + width > len(x) or lo - width < 0 or s + width > len(x):
        return e0, -1.0, float("nan"), -1.0
    post_ref = x[s : s + width]
    post = ncc_matrix(post_ref, x[lo : hi + width], width)[:: step]
    cand = np.arange(lo, hi + 1)[:: step]
    if use_pre and s - width >= 0:
        pre_ref = x[s - width : s]
        pre = ncc_matrix(pre_ref, x[lo - width : hi], width)[:: step]
        score = 0.75 * post + 0.25 * pre  # the post-seam match is the primary criterion (see docstring, 5)
    else:
        pre = np.full_like(post, np.nan)
        score = post
    i = int(np.argmax(score))
    return int(cand[i]), float(score[i]), float(pre[i]), float(post[i])


def click_ratio(st: np.ndarray, s: int, e: int) -> float:
    """Worst-channel |step across the seam| relative to the local sample-to-sample step (rms over +-441 samples)."""
    ratios = []
    for c in range(st.shape[1]):
        ch = st[:, c]
        jump = abs(ch[e - 1] - ch[s])
        seg = np.concatenate((np.diff(ch[max(0, s - 441) : s + 441]), np.diff(ch[e - 441 : e + 441])))
        ref = float(np.sqrt((seg * seg).mean())) + 1e-9
        ratios.append(jump / ref)
    return float(max(ratios))


def zero_cross_align(x: np.ndarray, st: np.ndarray, s: int, e: int, span: int = 120) -> tuple[int, int, float]:
    """Slide (s, e) together by up to +-span samples to the lowest stereo click ratio, preferring rising zero crossings
    on the mono mix (the continuity of the sign of the slope is part of the click ratio). The lag e - s is unchanged."""
    best = (click_ratio(st, s, e), 0, s, e)
    for d in range(-span, span + 1):
        s2, e2 = s + d, e + d
        if s2 < 1 or e2 + 1 >= len(x):
            continue
        slope_ok = (x[s2] - x[s2 - 1]) >= 0 and (x[e2] - x[e2 - 1]) >= 0 and x[s2 - 1] <= 0 <= x[s2]
        cr = click_ratio(st, s2, e2) * (0.8 if slope_ok else 1.0)  # mild preference for true rising zero crossings
        if (cr, abs(d)) < (best[0], abs(best[1])):
            best = (cr, d, s2, e2)
    return best[2], best[3], click_ratio(st, best[2], best[3])


def rms(seg: np.ndarray) -> float:
    return float(np.sqrt((seg * seg).mean())) + 1e-9


def db(a: float, b: float) -> float:
    return float(20 * np.log10(a / b))


# ----------------------------------------------------------------------------- tempo

def tempo_estimate(x: np.ndarray) -> dict:
    """Onset-flux autocorrelation tempo (60-200 bpm, hop 512). Informational: used to report how many beats/bars the loop spans."""
    hop, n = 512, 1024
    wins = np.lib.stride_tricks.sliding_window_view(x[: min(len(x), 90 * SR)], n)[::hop]
    spec = np.abs(np.fft.rfft(wins * np.hanning(n), axis=1))
    lg = np.log1p(spec[:, 2:200] * 20)
    flux = np.maximum(lg[1:] - lg[:-1], 0).sum(axis=1)
    flux = flux - flux.mean()
    ac = np.correlate(flux, flux, mode="full")[len(flux) - 1 :]
    lo, hi = int(0.30 * SR / hop), int(1.0 * SR / hop)
    k = lo + int(np.argmax(ac[lo:hi]))
    # parabolic refinement
    if 1 <= k < len(ac) - 1:
        a, b, c = ac[k - 1], ac[k], ac[k + 1]
        k = k + 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
    period = k * hop / SR
    return {"beatSeconds": round(period, 4), "bpm": round(60.0 / period, 1)}


def onset_curve(x: np.ndarray) -> tuple[np.ndarray, int, int]:
    """Positive log-spectral flux, hop 256 / window 1024 (5.8 ms resolution). Returns (flux, hop, window)."""
    hop, n = 256, 1024
    wins = np.lib.stride_tricks.sliding_window_view(x, n)[::hop]
    lg = np.log1p(np.abs(np.fft.rfft(wins * np.hanning(n), axis=1))[:, 2:260] * 20)
    flux = np.concatenate(([0.0], np.maximum(lg[1:] - lg[:-1], 0).sum(axis=1)))
    return flux, hop, n


def onset_candidates(flux: np.ndarray, hop: int, win: int, center_s: float, before: float, after: float) -> list[tuple[int, float]]:
    """Strong onset peaks (sample position just BEFORE the attack, strength 0-1) within [center-before, center+after]."""
    lo = max(1, int((center_s - before) * SR / hop))
    hi = min(len(flux) - 2, int((center_s + after) * SR / hop))
    if hi <= lo:
        return []
    seg = flux[lo : hi + 1]
    top = float(seg.max())
    out = []
    if top <= 0:
        return out
    for i in range(lo, hi + 1):
        v = flux[i]
        if v >= 0.5 * top and v >= flux[max(0, i - 3) : i + 4].max():
            # the window ends at i*hop + win; the attack lies in its last part: stand ~25 ms before that end
            out.append((int(i * hop + win - 0.025 * SR), float(v / top)))
    return out


def beat_report(loop_s: float, beat_s: float) -> dict:
    beats = loop_s / beat_s
    out = {"beatsInLoop": round(beats, 2)}
    best = None
    for mult, name in ((1, "beat"), (2, "half-bar-or-double"), (4, "bar (4 beats)"), (3, "bar (3 beats)")):
        err = abs(beats / mult - round(beats / mult)) * mult
        if best is None or err < best[0]:
            best = (err, name)
    out["gridErrorBeats"] = round(best[0], 3)  # distance of the loop length from a whole number of beats (0 = exact)
    return out


# ----------------------------------------------------------------------------- per-track analysis

def evaluate_candidate(x: np.ndarray, st: np.ndarray, feats: np.ndarray, env_fade_s: float, cand: dict, duration_s: float, onsets: tuple) -> dict | None:
    flux, fhop, fwin = onsets
    r0, r1 = cand["r0f"] * HOP_S, cand["r1f"] * HOP_S
    lag0 = cand["lagFrames"] * HOP
    lag = refine_lag_median(x, r0, r1, lag0)
    lag_s = lag / SR
    end_limit = min(duration_s - 0.2, env_fade_s + 1.0)
    phases = []
    k = 0
    while True:
        s_k = r0 + k * lag_s
        e_k = s_k + lag_s
        if s_k + MIN_SUPPORT_AFTER_S > r1 or e_k > end_limit:
            break
        phases.append((k, s_k))
        k += 1
    if not phases:
        return None
    options = []
    for k, s_k in phases:
        best = None
        cands = onset_candidates(flux, fhop, fwin, s_k, 0.6, 0.9) or [(int(s_k * SR), 0.0)]
        if k == 0 and s_k < 0.9:
            cands = cands + [(int(max(0.0, s_k) * SR), 0.0)]  # the repeat-run start itself (file starts on the downbeat)
        for s, strength in cands:
            s = max(0, s)
            e0 = s + lag
            e, sc, pre, post = seam_scores(x, s, e0, SEAM_W_COARSE, 200, step=2, use_pre=k > 0)
            if sc < 0:
                continue
            # prefer strong onsets and the phase boundary itself (0.02 per second of distance)
            key = sc + 0.03 * strength - 0.02 * abs(s / SR - s_k)
            if best is None or key > best[0]:
                best = (key, s, e)
        if best is None:
            continue
        _, s, e = best
        # fine: re-search the start within +-441 samples, end within +-300 at full rate
        fine = None
        for s2 in range(max(0, s - 150), s + 151, 3):
            e2, sc, pre, post = seam_scores(x, s2, e, SEAM_W, 300, use_pre=k > 0)
            if sc < 0:
                continue
            if fine is None or sc > fine[0]:
                fine = (sc, s2, e2, pre, post)
        if fine is None:
            continue
        sc, s, e, pre, post = fine
        tail = None
        n = int(4.0 / HOP_S)
        sf, ef = int(s / HOP), int(e / HOP)
        if sf - n >= 0 and ef <= len(feats):
            tail = float(np.einsum("ij,ij->i", feats[sf - n : sf], feats[ef - n : ef]).mean())
        options.append({"k": k, "s": s, "e": e, "seam": sc, "pre": pre, "post": post, "tail": tail, "phaseSeconds": s_k})
    if not options:
        return None
    best_seam = max(o["seam"] for o in options)
    # latest phase whose seam is within tolerance of the best, with a sane tail context when it exists
    ok = [o for o in options if o["post"] >= POST_PASS and o["seam"] >= max(SEAM_PASS, best_seam - K_TOLERANCE) and (o["tail"] is None or o["tail"] >= 0.75)]
    chosen = max(ok, key=lambda o: o["k"]) if ok else max(options, key=lambda o: o["seam"])
    k = chosen["k"]
    s, e = chosen["s"], chosen["e"]
    s, e, click = zero_cross_align(x, st, s, e)
    # re-measure after the common slide
    e_chk, sc, pre, post = seam_scores(x, s, e, SEAM_W, 0, use_pre=k > 0)
    sfr = int(s / HOP)
    efr = int(e / HOP)
    body = int(min(len(feats) - efr, efr - sfr))
    body_sim = float(np.einsum("ij,ij->i", feats[sfr : sfr + body], feats[efr : efr + body]).mean()) if body > 10 else None
    level_step = db(rms(x[s : s + SR // 4]), rms(x[e - SR // 4 : e]))
    natural_step = db(rms(x[e : e + SR // 4]), rms(x[e - SR // 4 : e])) if e + SR // 4 <= len(x) else 0.0
    return {
        "lagSeconds": round(lag_s, 4), "lagSamples": int(lag), "lagFrameGuess": round(cand["lagFrames"] * HOP_S, 3),
        "repeatRun": {"start": round(r0, 2), "end": round(r1, 2), "seconds": round(r1 - r0, 2), "meanSimilarity": round(cand["sim"], 4)},
        "phaseIndex": chosen["k"], "phasesEvaluated": [{"k": o["k"], "start": round(o["s"] / SR, 3), "end": round(o["e"] / SR, 3), "seam": round(o["seam"], 4),
                                                         "tailSimilarity": (None if o["tail"] is None else round(o["tail"], 3))} for o in options],
        "start": int(s), "end": int(e), "loopSeconds": round((e - s) / SR, 3),
        "seamNcc": round(sc, 4), "preSeamNcc": (None if np.isnan(pre) else round(pre, 4)), "postSeamNcc": round(post, 4),
        "clickRatio": round(click, 3),
        "levelStepDb": round(level_step, 2), "naturalStepDb": round(natural_step, 2),
        "bodySimilarity": (None if body_sim is None else round(body_sim, 4)),
        "tailSimilarity": (None if chosen["tail"] is None else round(chosen["tail"], 3)),
        "firstLoopBackShare": round(e / len(x), 4),
    }


def seam_report(x: np.ndarray, st: np.ndarray, feats: np.ndarray, s: int, e: int) -> dict:
    """The same seam measurements for an arbitrary (s, e) pair: used for the loop that was in the manifest before this pass."""
    _, sc, pre, post = seam_scores(x, s, e, SEAM_W, 0, use_pre=s >= e - s)
    sf, ef = int(s / HOP), int(e / HOP)
    body = int(min(len(feats) - ef, ef - sf))
    n = int(4.0 / HOP_S)
    return {
        "start": int(s), "end": int(e), "loopSeconds": round((e - s) / SR, 3), "firstLoopBackShare": round(e / len(x), 4),
        "seamNcc": round(sc, 4), "preSeamNcc": (None if np.isnan(pre) else round(pre, 4)), "postSeamNcc": round(post, 4),
        "clickRatio": round(click_ratio(st, s, e), 3),
        "levelStepDb": round(db(rms(x[s : s + SR // 4]), rms(x[e - SR // 4 : e])), 2),
        "bodySimilarity": (round(float(np.einsum("ij,ij->i", feats[sf : sf + body], feats[ef : ef + body]).mean()), 4) if body > 10 else None),
        "tailSimilarity": (round(float(np.einsum("ij,ij->i", feats[sf - n : sf], feats[ef - n : ef]).mean()), 3) if sf - n >= 0 and ef <= len(feats) else None),
    }


def analyse_track(job: tuple) -> tuple[str, dict]:
    track_id, path, ffmpeg, previous = job
    x = A.decode_mono(Path(path), ffmpeg)
    st = decode_stereo(Path(path), ffmpeg)
    duration_s = len(x) / SR
    env = A.rms_envelope(x)
    fade_s = A.fade_start_index(env) / 100.0
    feats = A.frame_features(x)
    cands = lag_candidates(feats, duration_s)
    onsets = onset_curve(x)
    min_len = min(0.4 * duration_s, 30.0)
    out: dict = {"duration": round(duration_s, 3), "fadeStartSeconds": round(fade_s, 2), "minPreferredLoopSeconds": round(min_len, 2),
                 "tempo": tempo_estimate(x), "lagCandidates": [
                     {"lag": round(c["lagFrames"] * HOP_S, 2), "run": round(c["run"], 1), "start": round(c["r0f"] * HOP_S, 1), "similarity": round(c["sim"], 3)}
                     for c in cands]}
    evaluated = []
    for cand in cands:
        if cand["lagFrames"] * HOP_S < 12.0:
            continue
        ev = evaluate_candidate(x, st, feats, fade_s, cand, duration_s, onsets)
        if ev is None:
            continue
        ev["long"] = ev["loopSeconds"] >= min_len
        ev["structuralSim"] = ev["repeatRun"]["meanSimilarity"]
        ev["credible"] = bool(
            (ev["structuralSim"] >= ACCEPT_SIM or (ev["structuralSim"] >= WEAK_SIM and ev["repeatRun"]["seconds"] >= ev["lagSeconds"]))
            and ev["repeatRun"]["seconds"] >= MIN_REPEAT_RUN_S
            and ev["seamNcc"] >= SEAM_PASS
            and ev["postSeamNcc"] >= POST_PASS
            and ev["clickRatio"] <= CLICK_MAX
            and abs(ev["levelStepDb"] - ev["naturalStepDb"]) <= LEVEL_STEP_MAX_DB
        )
        evaluated.append(ev)
    out["evaluated"] = evaluated
    if previous:
        out["previousLoop"] = seam_report(x, st, feats, int(previous["startSample"]), int(previous["endSample"]))
        out["previousLoop"]["method"] = previous.get("method")
    credible = [c for c in evaluated if c["credible"]]
    # Prefer the longest musically repeated section among credible long candidates, else a credible short one.
    pool = [c for c in credible if c["long"]] or credible
    best = None
    if pool:
        best = max(pool, key=lambda c: (c["repeatRun"]["seconds"] * c["structuralSim"] ** 2 * (0.5 + 0.5 * c["seamNcc"]), -c["start"]))
        out["short"] = not best["long"]
    out["best"] = best
    if best:
        beats = beat_report(best["loopSeconds"], out["tempo"]["beatSeconds"])
        best.update(beats)
        support = min(1.0, best["repeatRun"]["seconds"] / 20.0)
        conf = best["structuralSim"] * min(1.0, best["seamNcc"] + 0.05) * (0.9 + 0.1 * support) * (0.9 if out["short"] else 1.0) * (0.85 if best["structuralSim"] < ACCEPT_SIM else 1.0)
        best["confidence"] = round(min(0.95, conf), 2)
    else:
        out["reason"] = reject_reason(out, evaluated, duration_s)
    return track_id, out


def reject_reason(out: dict, evaluated: list[dict], duration_s: float) -> str:
    """Per-track reason in the loopReason style (jingle; non-looping cue; insufficient repeated material; uncertain seam; needs audition)."""
    cands = out["lagCandidates"]
    top = cands[0] if cands else None
    if not cands:
        if duration_s < 60:
            return (f"non-looping cue ({duration_s:.0f} s, jingle/ending length): no lag between 6 s and 0.8 of the track keeps a musical self-similarity "
                    f"above {SIM_THRESHOLD} for {MIN_REPEAT_RUN_S:.0f} s (structural v2); the whole file plays once and restarts. Not auditioned.")
        return ("insufficient repeated material: no lag between 6 s and 0.8 of the track keeps a musical self-similarity above "
                f"{SIM_THRESHOLD} for {MIN_REPEAT_RUN_S:.0f} s (structural v2); non-looping or through-composed cue, the whole file plays once. Not auditioned.")
    if evaluated:
        b = max(evaluated, key=lambda c: (c["postSeamNcc"], c["structuralSim"]))
        parts = []
        if b["structuralSim"] < WEAK_SIM or (b["structuralSim"] < ACCEPT_SIM and b["repeatRun"]["seconds"] < b["lagSeconds"]):
            parts.append(f"repeat similarity {b['structuralSim']:.2f} over {b['repeatRun']['seconds']:.0f} s (needs >= {ACCEPT_SIM}, or >= {WEAK_SIM} over a whole cycle)")
        if b["seamNcc"] < SEAM_PASS or b["postSeamNcc"] < POST_PASS:
            parts.append(f"post-seam NCC {b['postSeamNcc']:.2f} (combined {b['seamNcc']:.2f}) below {POST_PASS}/{SEAM_PASS}")
        if b["clickRatio"] > CLICK_MAX:
            parts.append(f"seam click ratio {b['clickRatio']:.1f} > {CLICK_MAX}")
        if abs(b["levelStepDb"] - b["naturalStepDb"]) > LEVEL_STEP_MAX_DB:
            parts.append("level discontinuity at the seam")
        kind = "uncertain seam" if any(p.startswith(("post-seam", "seam click", "level")) for p in parts) else "insufficient repeated material"
        return (f"{kind}: best structural candidate {b['start']/SR:.2f}-{b['end']/SR:.2f} s (lag {b['lagSeconds']:.1f} s, repeat run "
                f"{b['repeatRun']['seconds']:.0f} s) is not credible: " + "; ".join(parts or ["below thresholds"]) + ". Needs human audition. Not auditioned.")
    return (f"insufficient repeated material: strongest repeat lag {top['lag']:.1f} s runs only {top['run']:.0f} s (similarity {top['similarity']:.2f}), "
            f"shorter than the {12.0:.0f} s minimum loop or with no usable phase before the closing fade (structural v2); the whole file plays once. Not auditioned.")


# ----------------------------------------------------------------------------- manifest

def loop_entry(best: dict, previous: dict | None = None) -> dict:
    tweak = ""
    if previous:
        tweak = (f" Supersedes the earlier {previous.get('method', 'measured')} loop {previous['startSample']/previous['sampleRate']:.2f}-"
                 f"{previous['endSample']/previous['sampleRate']:.2f} s (same repeat period, later phase so more of the track plays before the first loop-back).")
    return {
        "startSample": int(best["start"]),
        "endSample": int(best["end"]),
        "sampleRate": SR,
        "confidence": best["confidence"],
        "provenance": "curated-analysis",
        "method": METHOD,
        "status": SCOPE_LOOP_STATUS,
        "note": (
            f"Structural analysis ({METHOD}, 44.1 kHz): repeat lag {best['lagSeconds']:.2f} s, repeated run "
            f"{best['repeatRun']['seconds']:.0f} s (mean similarity {best['structuralSim']:.2f}); seam NCC {best['seamNcc']:.3f}, click ratio "
            f"{best['clickRatio']:.2f}; loop {best['loopSeconds']:.1f} s, first loop-back at {best['firstLoopBackShare']*100:.0f}% of the track. "
            f"Not an original DS loop point; not verified by listening.{tweak}"
        ),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ids", help="comma-separated manifest track ids")
    ap.add_argument("--scope", choices=["migrated", "all"], default="migrated",
                    help="migrated: the 55 DS replacements + the 4 REVIEW tracks + maya_fey_turnabout_sisters_2001; all: every installed track")
    ap.add_argument("--report", help="write the per-track evidence JSON here")
    ap.add_argument("--write", action="store_true", help="store loops / whole-file reasons for the analysed tracks in soundtrack.json")
    ap.add_argument("--ffmpeg")
    ap.add_argument("--jobs", type=int, default=min(6, os.cpu_count() or 1))
    args = ap.parse_args(argv)

    raw = A.MANIFEST.read_bytes()
    manifest = json.loads(raw.decode("utf-8"))
    audit = json.loads((A.ROOT / "scripts" / "data" / "ds_audio_migration.json").read_text(encoding="utf-8"))
    migrated = {k for k, v in audit["tracks"].items() if v["action"] in ("REPLACE", "REVIEW")} | {"maya_fey_turnabout_sisters_2001"}
    ffmpeg = A.find_ffmpeg(args.ffmpeg)
    wanted = set(args.ids.split(",")) if args.ids else None
    jobs = []
    for tid, entry in manifest["tracks"].items():
        if not entry.get("src") or entry.get("category") == "excluded":
            continue
        if wanted is not None and tid not in wanted:
            continue
        if wanted is None and args.scope == "migrated" and tid not in migrated:
            continue
        path = A.MUSIC / entry["src"]
        if path.exists():
            jobs.append((tid, str(path), ffmpeg, entry.get("loop")))
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(analyse_track, jobs))
    report = {tid: info for tid, info in results}
    for tid, info in results:
        b = info.get("best")
        if b:
            print(f"{tid}: LOOP {b['start']/SR:.3f}-{b['end']/SR:.3f}s ({b['loopSeconds']:.1f}s, back at {b['firstLoopBackShare']*100:.0f}%) "
                  f"sim {b['structuralSim']:.2f} seam {b['seamNcc']:.2f} click {b['clickRatio']:.1f} conf {b['confidence']}{' SHORT' if info['short'] else ''}")
        else:
            print(f"{tid}: whole-file ({info['reason'][:110]})")
    writable = {k for k, v in audit["tracks"].items() if v["action"] == "REPLACE"} | {"maya_fey_turnabout_sisters_2001"}
    for tid, info in results:
        entry = manifest["tracks"][tid]
        prev = entry.get("loop")
        b = info.get("best")
        if tid not in writable:
            info["disposition"] = "evidence only: pre-expansion KEEP / REVIEW entry preserved by D-088, manifest untouched"
            continue
        # A strict-v1 loop of the same period and phase (start within 1 s) is kept: it already has the better waveform seam.
        if (b and prev and prev.get("method") == "lag-diagonal+xcorr-v1" and abs(prev["startSample"] - b["start"]) < SR
                and abs((prev["endSample"] - prev["startSample"]) - (b["end"] - b["start"])) < SR // 10
                and info.get("previousLoop", {}).get("postSeamNcc", 0) >= b["postSeamNcc"]):
            info["disposition"] = "kept previous measured loop (same period and phase, equal or better seam)"
            info["keptPrevious"] = True
            continue
        info["disposition"] = "applied: structural loop" if b else "applied: whole-file fallback with reason"
        if args.write:
            if b:
                entry["loop"] = loop_entry(b, prev)
                entry.pop("loopReason", None)
                if "loopStatus" in entry:
                    entry["loopStatus"] = SCOPE_LOOP_STATUS
            else:
                entry["loop"] = None
                entry["loopReason"] = info["reason"]
                if "loopStatus" in entry:
                    entry["loopStatus"] = "whole_file"
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.write:
        A.write_manifest(raw, manifest)
        print("soundtrack.json updated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
