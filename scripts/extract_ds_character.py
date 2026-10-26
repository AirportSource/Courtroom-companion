#!/usr/bin/env python3
"""Extract native DS character sprite sheets into a Courtroom Companion character pack.

Method (D-027 / D-064, generalised and automated):
  * the sheet background is the most common colour; pixels of exactly that colour are transparent;
  * sprites are the 8-connected components of non-background pixels. No resampling, no recolouring;
  * labels ("x Talk" / "x2" brackets), the "Ripped by ..." credit box and other low-fill or tiny components are not
    sprites. Brackets are read: "x Talk" marks the talking frames of a row, "x2"/"x3" marks frames played repeatedly;
  * sprites are numbered in reading order (rows, then x) and cropped to their exact bounding box; pixels of
    neighbouring sprites inside the box are transparent;
  * an "extras" region merges effect fragments (whip trails, sparks) into the animation frame they belong to;
  * a pose = idle (blink) frames + talking (mouth) frames. Frames are registered to the first idle frame by the
    integer (dx, dy) that maximises the number of identical opaque pixels (the static body dominates), or, for
    one-shot reactions with large motion, by their body anchor (centroid x of the body palette colours);
  * the pose canvas is symmetric around the body anchor, so every pose of a character places the body at the same
    stage x (the renderer centres the canvas bottom-centre on the stage); offsets are non-negative integers;
  * every output PNG is verified pixel-exact against the sheet.

Usage (repository root; needs Pillow, numpy, scipy):
    python -I scripts/extract_ds_character.py list  <sheet file name> [--min-h N]
    python -I scripts/extract_ds_character.py build <edgeworth|franziska|larry|pearl|all> [--scratch DIR]
    python -I scripts/extract_ds_character.py verify <character|all>
The source archive (read-only) defaults to C:\\Users\\adria\\Desktop\\extract_assets_ace\\characters, or $DS_ARCHIVE.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = Path(os.environ.get("DS_ARCHIVE", r"C:\Users\adria\Desktop\extract_assets_ace\characters"))
CHAR_ROOT = REPO / "frontend" / "public" / "assets" / "characters"
PORTRAIT_GREY = (120, 120, 120)  # same as Maya's court-record portrait background
LOWER_BODY = 0.40  # fraction of the canvas height (from the bottom) used for alignment residuals


# ----------------------------------------------------------------------------------------------
# sheet segmentation
# ----------------------------------------------------------------------------------------------
@dataclass
class Sprite:
    idx: int
    x0: int
    y0: int
    x1: int  # exclusive
    y1: int
    ids: list
    row: int = 0
    mark: str = ""  # "T" under an "x Talk" bracket, "rep" under an "x2"/"x3" bracket

    @property
    def w(self) -> int:
        return self.x1 - self.x0

    @property
    def h(self) -> int:
        return self.y1 - self.y0


@dataclass
class Sheet:
    path: Path
    rgb: np.ndarray
    bg: tuple
    lab: np.ndarray
    comps: dict  # id -> dict(x0, y0, x1, y1, area)
    sprites: list = field(default_factory=list)
    dropped: list = field(default_factory=list)
    brackets: list = field(default_factory=list)  # (x0, x1, y, kind)

    def by_idx(self) -> dict:
        return {s.idx: s for s in self.sprites}


def load_sheet(name: str, min_h: int = 30, min_w: int = 16, min_area: int = 300) -> Sheet:
    path = ARCHIVE / name
    rgba = np.array(Image.open(path).convert("RGBA"))
    if rgba[..., 3].min() < 255:
        raise SystemExit(f"{name}: has transparent pixels, expected a solid-background sheet")
    rgb = rgba[..., :3]
    cols, counts = np.unique(rgb.reshape(-1, 3), axis=0, return_counts=True)
    bg = tuple(int(v) for v in cols[counts.argmax()])
    fg = ~np.all(rgb == np.array(bg, dtype=np.uint8), axis=2)
    lab, n = ndimage.label(fg, structure=np.ones((3, 3), dtype=int))
    comps = {}
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        ys, xs = sl
        comps[i] = dict(id=i, x0=xs.start, x1=xs.stop, y0=ys.start, y1=ys.stop, area=int((lab[sl] == i).sum()))

    def fill(c):
        return c["area"] / max((c["x1"] - c["x0"]) * (c["y1"] - c["y0"]), 1)

    big = [c for c in comps.values() if (c["y1"] - c["y0"]) >= min_h and (c["x1"] - c["x0"]) >= min_w
           and c["area"] >= min_area and fill(c) >= 0.12]  # low fill: credit box outline, sparse effect streaks
    big_ids = {c["id"] for c in big}
    sheet = Sheet(path, rgb, bg, lab, comps)
    owner = {c["id"]: [c["id"]] for c in big}
    for c in comps.values():
        if c["id"] in big_ids:
            continue
        host = next((b for b in big if c["x0"] >= b["x0"] and c["x1"] <= b["x1"] and c["y0"] >= b["y0"]
                     and c["y1"] <= b["y1"]), None)
        if host is not None:  # detached pixels inside a sprite's box belong to it
            owner[host["id"]].append(c["id"])
        else:
            sheet.dropped.append(((c["x0"], c["y0"], c["x1"], c["y1"]), f"area {c['area']}"))
    # label brackets: wide thin dropped components; "x Talk" text contains a component of area >= 60
    for (x0, y0, x1, y1), _ in sheet.dropped:
        if x1 - x0 >= 60 and y1 - y0 <= 8:
            near = [c for c in comps.values() if c["x0"] >= x0 and c["x1"] <= x1 and c["y1"] <= y0 + 1
                    and c["y0"] >= y0 - 14 and (c["x1"] - c["x0"]) < 20]
            sheet.brackets.append((x0, x1, y0, "T" if any(c["area"] >= 60 for c in near) else "rep"))
    sprites = [Sprite(0, b["x0"], b["y0"], b["x1"], b["y1"], owner[b["id"]]) for b in big]
    sprites.sort(key=lambda s: (s.y0, s.x0))
    rows: list = []
    for s in sprites:  # rows = clusters of vertically overlapping sprites
        for r in rows:
            top, bot = min(q.y0 for q in r), max(q.y1 for q in r)
            if min(bot, s.y1) - max(top, s.y0) > 0.5 * min(s.h, bot - top):
                r.append(s)
                break
        else:
            rows.append([s])
    rows.sort(key=lambda r: min(q.y0 for q in r))
    out, n = [], 0
    for ri, r in enumerate(rows, start=1):
        r.sort(key=lambda s: s.x0)
        for s in r:
            n += 1
            s.idx, s.row = n, ri
            tol = 0.6 * s.w
            for x0, x1, y, kind in sheet.brackets:
                if x0 - tol <= (s.x0 + s.x1) / 2 <= x1 + tol and 0 <= s.y0 - y <= 60:
                    s.mark = kind
            out.append(s)
    sheet.sprites = out
    return sheet


def build_frame(sheet: Sheet, idx: int, extras: dict | None = None):
    """RGBA array of sprite `idx` (plus merged effect fragments) and its sheet bbox (x0, y0, x1, y1)."""
    s = sheet.by_idx()[idx]
    ids = list(s.ids)
    x0, y0, x1, y1 = s.x0, s.y0, s.x1, s.y1
    for rx0, ry0, rx1, ry1 in (extras or {}).get(idx, []):
        for c in sheet.comps.values():
            if c["x0"] >= rx0 and c["x1"] <= rx1 and c["y0"] >= ry0 and c["y1"] <= ry1 and c["id"] not in ids:
                ids.append(c["id"])
                x0, y0, x1, y1 = min(x0, c["x0"]), min(y0, c["y0"]), max(x1, c["x1"]), max(y1, c["y1"])
    sl = (slice(y0, y1), slice(x0, x1))
    mask = np.isin(sheet.lab[sl], ids)
    out = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
    out[..., :3] = np.where(mask[..., None], sheet.rgb[sl], 0)
    out[..., 3] = np.where(mask, 255, 0)
    return out, (x0, y0, x1, y1)


# ----------------------------------------------------------------------------------------------
# registration
# ----------------------------------------------------------------------------------------------
def _place(a, ox, oy, H, W):
    c = np.zeros((H, W, 4), dtype=np.uint8)
    c[oy:oy + a.shape[0], ox:ox + a.shape[1]] = a
    return c


def best_shift(ref: np.ndarray, img: np.ndarray, search: int = 6):
    """(dx, dy, equal/union, equal_count): shift of `img` vs `ref`, both bottom-aligned at 0, left edges at 0.

    Maximises the number of identical opaque pixels; ties prefer the smallest shift. Positive dx = right, dy = down.
    """
    H = max(ref.shape[0], img.shape[0]) + 2 * search
    W = max(ref.shape[1], img.shape[1]) + 2 * search
    r = _place(ref, search, H - search - ref.shape[0], H, W)
    ropq, rrgb = r[..., 3] > 0, r[..., :3]
    best = None
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            c = _place(img, search + dx, H - search - img.shape[0] + dy, H, W)
            copq = c[..., 3] > 0
            cnt = int((ropq & copq & np.all(c[..., :3] == rrgb, axis=2)).sum())
            key = (cnt, -(abs(dx) + abs(dy)))
            if best is None or key > best[0]:
                best = (key, dx, dy, cnt, int((ropq | copq).sum()))
    _, dx, dy, cnt, union = best
    return dx, dy, cnt / max(union, 1), cnt


def anchor_x(rgba: np.ndarray, colours, rows_frac: float = 0.35) -> float:
    """Body anchor: centre x of the given palette colours in the bottom rows (else of all opaque pixels there)."""
    h = rgba.shape[0]
    sub = rgba[int(h * (1 - rows_frac)):]
    opq = sub[..., 3] > 0
    m = np.zeros(opq.shape, dtype=bool)
    for c in colours:
        m |= np.all(sub[..., :3] == np.array(c, dtype=np.uint8), axis=2)
    m &= opq
    if m.sum() < 20:
        m = opq
    xs = np.nonzero(m)[1]
    return (float(xs.min()) + float(xs.max()) + 1.0) / 2.0


@dataclass
class Clip:
    nums: list  # sprite numbers in playback order (repeats allowed)
    placed: list = field(default_factory=list)  # (dx, dy) in reference coordinates, per entry of nums


def register(frames: dict, clips: list, ref_num: int, colours, method: str):
    """Fill clip.placed. `frames` maps sprite number -> RGBA. Returns (anchor_int, per-number (dx, dy, eq))."""
    ref = frames[ref_num]
    a_ref = anchor_x(ref, colours)
    info = {}
    for n in {n for c in clips for n in c.nums}:
        if n == ref_num:
            info[n] = (0, 0, 1.0)
        elif method == "anchor":
            info[n] = (int(round(a_ref - anchor_x(frames[n], colours))), 0, -1.0)
        else:
            dx, dy, eq, _ = best_shift(ref, frames[n])
            info[n] = (dx, dy, eq)
    for c in clips:
        c.placed = [(info[n][0], info[n][1]) for n in c.nums]
    return int(round(a_ref)), info


def make_canvas(frames: dict, clips: list, a_int: int):
    """Canvas (w, h) symmetric around the anchor + per-clip offsets (non-negative ints)."""
    left = right = top = bottom = None
    for c in clips:
        for n, (dx, dy) in zip(c.nums, c.placed):
            h, w = frames[n].shape[:2]
            L, R, T, B = dx, dx + w, dy - h, dy  # bottom edge at dy (positive = down), reference bottom = 0
            left = L if left is None else min(left, L)
            right = R if right is None else max(right, R)
            top = T if top is None else min(top, T)
            bottom = B if bottom is None else max(bottom, B)
    half = max(a_int - left, right - a_int, 1)
    W = 2 * half
    cx0 = a_int - half
    Hc = bottom - top
    offs = []
    for c in clips:
        offs.append([[dx - cx0, (dy - frames[n].shape[0]) - top] for n, (dx, dy) in zip(c.nums, c.placed)])
    return (W, Hc), offs


def compose(frames: dict, num: int, off, canvas) -> np.ndarray:
    W, H = canvas
    c = np.zeros((H, W, 4), dtype=np.uint8)
    f = frames[num]
    c[off[1]:off[1] + f.shape[0], off[0]:off[0] + f.shape[1]] = f
    return c


def residual(a: np.ndarray, b: np.ndarray) -> int:
    """Pixels of the lower body (bottom LOWER_BODY of the canvas) that differ between two composed frames."""
    y0 = int(a.shape[0] * (1 - LOWER_BODY))
    A, B = a[y0:], b[y0:]
    return int(((A != B).any(axis=2)).sum())


# ----------------------------------------------------------------------------------------------
# character specs (sprite numbers = reading order of `scripts/extract_ds_character.py list <sheet>`)
# ----------------------------------------------------------------------------------------------
JFA = "DS _ DSi - Phoenix Wright_ Ace Attorney_ Justice for All - Characters - "
AA1 = "DS _ DSi - Phoenix Wright_ Ace Attorney - Characters - "

BLINK = [2600, 70, 90, 70]  # same blink timing as Maya (D-027)


def rng(a, b):
    return list(range(a, b + 1))


def ack(emotion, lines_by_lang):
    return {"emotion": emotion, "lines": lines_by_lang}


SPECS = {
    # ------------------------------------------------------------------------------------------
    "edgeworth": dict(
        folder="edgeworth", id="miles_edgeworth", prefix="edgeworth", displayName="Miles Edgeworth",
        names={"en": "Miles Edgeworth", "fr": "Miles Edgeworth", "ja": "御剣怜侍", "it": "Miles Edgeworth",
               "es": "Miles Edgeworth"},
        voice={"blip": "blip_male", "shout": "edgeworth"},
        sheet=AA1 + "Miles Edgeworth (in Court).png",
        colours=[(49, 49, 49), (82, 82, 82)],
        poses=[
            dict(name="neutral_stand", idle=rng(1, 4), talk=rng(5, 8)),
            dict(name="pointing", idle=rng(25, 28), talk=rng(29, 32)),
            dict(name="open_hands", idle=rng(42, 45), talk=rng(46, 49)),
            dict(name="arms_crossed", idle=rng(54, 57), talk=rng(58, 61)),
            dict(name="thinking_temple", idle=[64, 66, 67, 66]),
            dict(name="reading_document", idle=rng(70, 73), talk=rng(74, 77)),
            dict(name="fists_hunched", idle=rng(81, 84), talk=rng(85, 88)),
            dict(name="anguish_closeup", idle=rng(89, 92), talk=rng(93, 96)),
            dict(name="startled", idle=[78]),
            dict(name="laugh", idle=[79]),
            dict(name="smirk_cuff", idle=[80]),
        ],
        reactions=[
            dict(name="thinking_gesture", frames=[62, 63, 64, 65, 64, 65, 64, 65, 66, 67, 68, 69], fps=10),
            dict(name="finger_tap", frames=rng(50, 53) * 2, fps=8),
            dict(name="hands_open_bow", frames=[36, 37, 38, 39, 40, 41, 38, 39, 40, 41], fps=8),
        ],
        emotions={
            "neutral": ("neutral_stand", None), "happy": ("open_hands", None), "excited": ("pointing", None),
            "thinking": ("thinking_temple", "thinking_gesture"), "surprised": ("startled", None),
            "sad": ("anguish_closeup", None), "anxious": ("fists_hunched", None), "playful": ("smirk_cuff", None),
            "grateful": ("open_hands", "hands_open_bow"), "laughing": ("laugh", None),
            "explaining": ("reading_document", None), "polite": ("open_hands", "hands_open_bow"),
            "relaxed": ("smirk_cuff", None), "serious": ("arms_crossed", None), "determined": ("pointing", None),
            "angry": ("fists_hunched", None), "suspicious": ("arms_crossed", "finger_tap"),
        },
        waiting=("thinking", "thinking_temple"),
        portrait=dict(num=1, dy=-1),
        ack=ack("determined", {
            "en": ["Very well. I'll take care of it.", "Leave it to me. It will be done properly.",
                   "Give me a moment. I'll see to it.", "Understood. I'll put it together."],
            "fr": ["Très bien. Je m'en occupe.", "Laissez-moi faire. Ce sera fait correctement.",
                   "Un instant. Je m'en charge.", "Compris. Je vais préparer cela."],
            "ja": ["いいだろう。私が引き受けよう。", "任せておけ。きちんと仕上げる。", "少し待て。私が対応する。", "了解した。用意しよう。"],
            "it": ["Molto bene. Me ne occupo io.", "Lascia fare a me. Sarà fatto come si deve.",
                   "Un momento. Ci penso io.", "Capito. Lo preparo subito."],
            "es": ["Muy bien. Yo me encargo.", "Déjamelo a mí. Se hará como es debido.",
                   "Un momento. Yo me ocupo.", "Entendido. Lo prepararé."],
        }),
    ),
    # ------------------------------------------------------------------------------------------
    "franziska": dict(
        folder="franziska", id="franziska_von_karma", prefix="franziska", displayName="Franziska von Karma",
        names={"en": "Franziska von Karma", "fr": "Franziska von Karma", "ja": "狩魔冥", "it": "Franziska von Karma",
               "es": "Franziska von Karma"},
        voice={"blip": "blip_female"},
        sheet=JFA + "Franziska (Courtroom).png",
        colours=[(49, 49, 49), (82, 82, 82)],
        extras={  # whip trail / slash streak / sparks drawn next to the frame they belong to
            23: [(555, 510, 640, 602)],
            24: [(791, 550, 905, 604)],
            26: [(1027, 555, 1105, 604)],
            27: [(1256, 535, 1330, 585)],
        },
        poses=[
            dict(name="arms_crossed", idle=[1, 2, 3, 2], talk=rng(4, 7), idle_dur=[1800, 140, 140, 140], jitter=1200),
            dict(name="whip_coil", idle=rng(12, 15), talk=rng(16, 19)),
            dict(name="whip_overhead", idle=rng(33, 36), talk=rng(37, 40)),
            dict(name="reach_out", idle=rng(45, 48), talk=rng(49, 52)),
            dict(name="lecture_finger", idle=rng(60, 63), talk=rng(64, 67)),
            dict(name="arms_crossed_aside", idle=rng(72, 75), talk=rng(80, 83)),
            dict(name="angry_fists", idle=rng(88, 91), talk=rng(92, 95)),
            dict(name="glare_closeup", idle=rng(96, 99), talk=rng(100, 103)),
        ],
        reactions=[
            dict(name="whip_crack", frames=[20, 21, 22, 23, 24, 26, 27, 28], fps=10),
            dict(name="whip_raise", frames=rng(29, 32), fps=8),
            dict(name="whip_twirl", frames=rng(8, 11), fps=8),
            dict(name="arm_flourish", frames=rng(41, 44), fps=8),
            dict(name="fists_clench", frames=rng(84, 87), fps=8),
        ],
        emotions={
            "neutral": ("arms_crossed", None), "happy": ("whip_coil", None), "excited": ("whip_overhead", "whip_raise"),
            "thinking": ("arms_crossed_aside", None), "surprised": ("angry_fists", "fists_clench"),
            "sad": ("glare_closeup", None), "anxious": ("arms_crossed_aside", None),
            "playful": ("whip_coil", "whip_twirl"), "grateful": ("whip_coil", None),
            "laughing": ("whip_overhead", None), "explaining": ("lecture_finger", None),
            "polite": ("arms_crossed", None), "relaxed": ("whip_coil", None), "serious": ("arms_crossed_aside", None),
            "determined": ("reach_out", "arm_flourish"), "angry": ("angry_fists", "whip_crack"),
            "suspicious": ("arms_crossed_aside", None), "embarrassed": ("angry_fists", None),
        },
        waiting=("thinking", "arms_crossed_aside"),
        portrait=dict(num=12, dy=0),
        ack=ack("determined", {
            "en": ["Hmph. Very well. I will handle it.", "Wait a moment. It will be done perfectly.",
                   "Naturally. I never settle for less than perfect.", "Don't hover. I'll take care of it."],
            "fr": ["Hmph. Très bien. Je m'en occupe.", "Un instant. Ce sera parfait.",
                   "Naturellement. Je ne me contente jamais de moins que la perfection.",
                   "Ne restez pas à côté de moi. Je m'en charge."],
            "ja": ["ふん、いいわ。私がやってあげる。", "少し待ちなさい。完璧に仕上げるわ。", "当然よ。私に妥協はないの。",
                   "そばで見張らないで。私がやるわ。"],
            "it": ["Hmph. Molto bene. Ci penso io.", "Un momento. Sarà fatto alla perfezione.",
                   "Naturalmente. Non mi accontento mai di meno della perfezione.",
                   "Non farmi pressione. Me ne occupo io."],
            "es": ["Hmph. Muy bien. Yo me encargo.", "Un momento. Quedará perfecto.",
                   "Naturalmente. Nunca me conformo con menos que la perfección.", "No me presiones. Yo me ocupo."],
        }),
    ),
    # ------------------------------------------------------------------------------------------
    "larry": dict(
        folder="larry", id="larry_butz", prefix="larry", displayName="Larry Butz",
        names={"en": "Larry Butz", "fr": "Larry Butz", "ja": "矢張政志", "it": "Larry Butz", "es": "Larry Butz"},
        voice={"blip": "blip_male"},
        sheet=AA1 + "Larry Butz.png",
        colours=[(197, 197, 205), (255, 238, 222), (82, 172, 172)],
        poses=[
            dict(name="neutral", idle=rng(1, 4), talk=rng(5, 8)),
            dict(name="smug_hips", idle=[9, 12, 13, 14], talk=rng(15, 18)),
            dict(name="blush", idle=[19, 24], idle_dur=[2600, 90], talk=rng(20, 23)),
            dict(name="thumbs_up", idle=[39, 43, 44, 45], talk=rng(46, 50)),
            dict(name="cheer_grin", idle=[51], talk=rng(59, 62)),
            dict(name="furious", idle=rng(25, 28), idle_dur=[200, 200, 200, 200], jitter=0),
            dict(name="sob", idle=rng(31, 34), talk=rng(35, 38)),
            dict(name="head_scratch", idle=[63], talk=rng(65, 68)),
            dict(name="thinking_chin", idle=rng(69, 72), talk=rng(73, 76)),
        ],
        reactions=[
            dict(name="rage", frames=[25, 26, 25, 26, 27, 28, 27, 28, 29, 30], fps=8),
            dict(name="cheer", frames=rng(51, 58), fps=8),
            dict(name="scratch", frames=[63, 64, 63, 64, 63, 64], fps=6),
        ],
        emotions={
            "neutral": ("neutral", None), "happy": ("cheer_grin", None), "excited": ("thumbs_up", "cheer"),
            "thinking": ("thinking_chin", None), "surprised": ("blush", None), "sad": ("sob", None),
            "anxious": ("head_scratch", "scratch"), "playful": ("smug_hips", None), "grateful": ("blush", None),
            "laughing": ("cheer_grin", "cheer"), "explaining": ("smug_hips", None), "polite": ("neutral", None),
            "relaxed": ("smug_hips", None), "serious": ("neutral", None), "determined": ("thumbs_up", None),
            "angry": ("furious", "rage"), "embarrassed": ("head_scratch", "scratch"),
        },
        waiting=("thinking", "thinking_chin"),
        portrait=dict(num=1, dy=16),
        ack=ack("excited", {
            "en": ["You got it, pal! Leave it to me!", "Sure thing! Gimme a sec!", "On it! This'll be awesome!",
                   "No problem, I'll whip something up!"],
            "fr": ["Ça marche, mon pote ! Laisse-moi faire !", "Pas de souci ! Une petite seconde !",
                   "J'm'en occupe ! Ça va être génial !", "Aucun problème, je te prépare ça !"],
            "ja": ["任せろって！俺に任せとけ！", "オッケー！ちょっと待っててくれよ！", "まっかせて！めちゃくちゃいいの作るぜ！",
                   "問題なし！すぐ用意するからさ！"],
            "it": ["Ricevuto, amico! Lascia fare a me!", "Certo! Dammi un secondo!", "Ci penso io! Sarà fantastico!",
                   "Nessun problema, ti preparo qualcosa!"],
            "es": ["¡Hecho, amigo! ¡Déjamelo a mí!", "¡Claro! ¡Dame un segundo!", "¡Voy! ¡Va a quedar genial!",
                   "¡Sin problema, te preparo algo!"],
        }),
    ),
    # ------------------------------------------------------------------------------------------
    "pearl": dict(
        folder="pearl", id="pearl_fey", prefix="pearl", displayName="Pearl Fey",
        names={"en": "Pearl Fey", "fr": "Pearl Fey", "ja": "綾里春美", "it": "Pearl Fey", "es": "Pearl Fey"},
        voice={"blip": "blip_female"},
        sheet=JFA + "Pearl Fey.png",
        colours=[(189, 74, 148), (131, 49, 106)],
        poses=[
            dict(name="neutral", idle=rng(1, 4), talk=rng(5, 8)),
            dict(name="hand_over_mouth", idle=rng(13, 16), talk=rng(17, 20)),
            dict(name="crying", idle=[21, 22, 23, 21, 22, 23, 24, 25, 26, 24, 25, 26], idle_dur=[140] * 12, jitter=0,
                 talk=rng(27, 30), method="anchor"),
            dict(name="sad_clasped", idle=rng(31, 34), talk=rng(35, 38)),
            dict(name="cheeks_blush", idle=rng(39, 42), talk=rng(43, 46)),
            dict(name="pout", idle=rng(47, 50), talk=rng(51, 54)),
            dict(name="curious", idle=rng(55, 58), talk=rng(59, 62)),
            dict(name="hands_worried_a", idle=rng(63, 66)),
            dict(name="hands_worried", idle=rng(67, 70), talk=rng(71, 74)),
            dict(name="happy_arms", idle=[80], talk=[81, 82, 83]),
        ],
        reactions=[
            dict(name="gasp", frames=rng(9, 12), fps=8),
            dict(name="cheer", frames=rng(75, 79), fps=8),
        ],
        emotions={
            "neutral": ("neutral", None), "happy": ("happy_arms", None), "excited": ("happy_arms", "cheer"),
            "thinking": ("hands_worried_a", None), "surprised": ("hand_over_mouth", "gasp"),
            "sad": ("sad_clasped", None), "anxious": ("hands_worried", None), "playful": ("happy_arms", None),
            "grateful": ("cheeks_blush", None), "laughing": ("happy_arms", "cheer"), "explaining": ("curious", None),
            "polite": ("curious", None), "relaxed": ("neutral", None), "serious": ("pout", None),
            "determined": ("pout", None), "angry": ("pout", None), "embarrassed": ("cheeks_blush", None),
            "crying": ("crying", None),
        },
        waiting=("thinking", "hands_worried_a"),
        portrait=dict(num=1, dy=8),
        ack=ack("happy", {
            "en": ["Yes! Please leave it to me!", "Okay! I'll do my very best!",
                   "Just a moment, please. I'll make something nice!", "Understood! I'll get it ready for you!"],
            "fr": ["Oui ! Laissez-moi faire !", "D'accord ! Je ferai de mon mieux !",
                   "Un instant, s'il vous plaît. Je vais préparer ça !", "Compris ! Je vous prépare ça !"],
            "ja": ["はい！私に任せてください！", "わかりました！がんばります！", "少しだけ待ってくださいね。いいものを作ります！",
                   "了解です！すぐ用意しますね！"],
            "it": ["Sì! Lasci fare a me!", "Va bene! Farò del mio meglio!",
                   "Un momento, per favore. Preparo qualcosa di bello!", "Capito! Glielo preparo subito!"],
            "es": ["¡Sí! ¡Déjemelo a mí!", "¡De acuerdo! ¡Haré lo mejor que pueda!",
                   "Un momento, por favor. ¡Prepararé algo bonito!", "¡Entendido! ¡Se lo preparo enseguida!"],
        }),
    ),
}


# ----------------------------------------------------------------------------------------------
# build
# ----------------------------------------------------------------------------------------------
def save_png(path: Path, rgba: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path, format="PNG", compress_level=9)


def durations(spec: dict, n: int):
    if "idle_dur" in spec:
        assert len(spec["idle_dur"]) == n, spec["name"]
        return spec["idle_dur"]
    if n == 1:
        return [1000]
    return (BLINK + [70] * max(0, n - 4))[:n]


def portrait_image(frame: np.ndarray, dy: int) -> Image.Image:
    """64x64 1:1 crop of the head from a native frame on the portrait grey (no scaling)."""
    opq = frame[..., 3] > 0
    ys, xs = np.nonzero(opq[:30])
    cx = int(round((xs.min() + xs.max() + 1) / 2))
    x0, y0 = cx - 32, int(ys.min()) + dy
    base = Image.new("RGBA", (64, 64), PORTRAIT_GREY + (255,))
    fr = Image.fromarray(frame, "RGBA")
    base.paste(fr, (-x0, -y0), fr)  # paste with the frame's own alpha: 1:1, no resampling
    return base


def build(key: str, scratch: Path | None) -> dict:
    spec = SPECS[key]
    sheet = load_sheet(spec["sheet"])
    extras = spec.get("extras")
    out_dir = CHAR_ROOT / spec["folder"]
    prefix, colours = spec["prefix"], spec["colours"]
    used = {n for p in spec["poses"] for n in p.get("idle", []) + p.get("talk", [])}
    used |= {n for r in spec["reactions"] for n in r["frames"]} | {spec["portrait"]["num"]}
    frames = {n: build_frame(sheet, n, extras)[0] for n in sorted(used)}
    report = {"sheet": sheet.path.name, "bg": sheet.bg,
              "palette_colours": int(len(np.unique(sheet.rgb.reshape(-1, 3), axis=0))), "sprites_on_sheet": len(sheet.sprites),
              "frame_heights": sorted({int(frames[n].shape[0]) for n in frames}), "clips": {}}
    anims, reacts, written, blocks = {}, {}, [], []

    def rel(anim, clip, n):
        return f"sprites/{anim}/{clip}/{prefix}_frame_{n:03d}.png"

    for p in spec["poses"]:
        idle, talk = p["idle"], p.get("talk", [])
        # The validator requires a talking clip. A pose without mouth frames talks with its own idle frames:
        # a looping motion (explicit idle_dur) keeps moving, a blink cycle holds its first (eyes open) frame.
        if not talk:
            talk = list(dict.fromkeys(idle)) if "idle_dur" in p else [idle[0]]
        clips = [Clip(idle), Clip(talk)]
        a_int, info = register(frames, clips, idle[0], colours, p.get("method", "shift"))
        canvas, offs = make_canvas(frames, clips, a_int)
        comp = {}
        for c, o in zip(clips, offs):
            for n, off in zip(c.nums, o):
                comp.setdefault(n, compose(frames, n, off, canvas))
        res = {n: residual(comp[idle[0]], comp[n]) for n in comp}
        report["clips"][p["name"]] = dict(
            canvas=list(canvas), idle=len(idle), talking=len(talk), method=p.get("method", "shift"),
            max_lower_body_residual_px=max(res.values()), shifts={str(n): list(info[n][:2]) for n in sorted(info)})
        anim = {"canvas": {"width": canvas[0], "height": canvas[1]},
                "idle": {"fps": 6, "loop": True, "frameDurations": durations(p, len(idle)),
                         "holdJitterMs": p.get("jitter", 1800), "frames": [rel(p["name"], "idle", n) for n in idle],
                         "offsets": offs[0]}}
        written += [(out_dir / rel(p["name"], "idle", n), frames[n]) for n in sorted(set(idle))]
        anim["talking"] = {"fps": 6, "loop": True, "frames": [rel(p["name"], "talking", n) for n in talk],
                           "offsets": offs[1]}
        written += [(out_dir / rel(p["name"], "talking", n), frames[n]) for n in sorted(set(talk))]
        anims[p["name"]] = anim
        blocks.append((p["name"], "pose", canvas, [(f"i{n}", comp[n]) for n in idle], [(f"t{n}", comp[n]) for n in talk]))

    for r in spec["reactions"]:
        clip = Clip(r["frames"])
        a_int, info = register(frames, [clip], r["frames"][0], colours, r.get("method", "anchor"))
        canvas, offs = make_canvas(frames, [clip], a_int)
        comp = {}
        for n, off in zip(clip.nums, offs[0]):
            comp.setdefault(n, compose(frames, n, off, canvas))
        reacts[r["name"]] = {"canvas": {"width": canvas[0], "height": canvas[1]}, "fps": r.get("fps", 10), "loop": False,
                             "frames": [rel(r["name"], "reaction", n) for n in clip.nums], "offsets": offs[0]}
        written += [(out_dir / rel(r["name"], "reaction", n), frames[n]) for n in sorted(set(clip.nums))]
        report["clips"]["reaction:" + r["name"]] = dict(canvas=list(canvas), frames=len(clip.nums), method="anchor",
                                                        shifts={str(n): list(info[n][:2]) for n in sorted(info)})
        blocks.append((r["name"], "reaction", canvas, [(f"r{n}", comp[n]) for n in clip.nums], []))

    for path, arr in written:
        save_png(path, arr)

    port = portrait_image(frames[spec["portrait"]["num"]], spec["portrait"]["dy"])
    (out_dir / "portraits").mkdir(parents=True, exist_ok=True)
    port.save(out_dir / "portraits" / "court_record.png", format="PNG", compress_level=9)

    emotions = {}
    for emo, (anim, react) in spec["emotions"].items():
        assert anim in anims and (react is None or react in reacts), (emo, anim, react)
        emotions[emo] = {"animation": anim} if react is None else {"reaction": react, "animation": anim}
    wemo, wanim = spec["waiting"]
    assert wanim in anims
    manifest = {
        "schemaVersion": 1, "id": spec["id"], "displayName": spec["displayName"], "names": spec["names"],
        "anchor": "bottom-center", "render": {"scale": 1, "offsetX": 0, "offsetY": 0}, "voice": spec["voice"],
        "courtRecordPortrait": {"src": "portraits/court_record.png", "width": 64, "height": 64},
        "waiting": {"emotion": wemo, "animation": wanim},
        "taskAcknowledgements": {"artifact": spec["ack"]},
        "defaultEmotion": "neutral", "fallbackEmotion": "neutral", "readiness": "partial",
        "animations": anims, "reactions": reacts, "emotions": emotions, "unassignedFrames": [],
    }
    (out_dir / "character.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if scratch is not None:
        scratch.mkdir(parents=True, exist_ok=True)
        contact_sheet(scratch / f"{key}_contact.png", spec["displayName"], blocks, port)
        stage_overview(scratch / f"{key}_stage.png", blocks)
    report["png_files"] = len(written)
    return report


def contact_sheet(path: Path, title: str, blocks: list, portrait: Image.Image) -> None:
    """Every clip at 2x inside its canvas (cyan line = body anchor, magenta = canvas) plus an onion overlay."""
    S, maxw, pad = 2, 2300, 6
    bg = (96, 96, 96, 255)
    rows = []
    for name, kind, (W, H), idle, talk in blocks:
        entries = list(idle) + list(talk)
        onion = Image.new("RGBA", (W, H), bg)
        for _, arr in entries:
            layer = Image.fromarray(arr, "RGBA")
            layer.putalpha(layer.getchannel("A").point(lambda v: 110 if v else 0))
            onion.alpha_composite(layer)
        cells = [("onion", onion)] + [(lab, Image.fromarray(arr, "RGBA")) for lab, arr in entries]
        rows.append(("title", f"{name} ({kind}) canvas {W}x{H}", 0))
        line, x = [], 0
        for lab, im in cells:
            if x + W * S + pad > maxw and line:
                rows.append(("cells", line, H))
                line, x = [], 0
            line.append((lab, im, W, H))
            x += W * S + pad
        rows.append(("cells", line, H))
    total_h = 24 + sum(14 if r[0] == "title" else r[2] * S + 6 for r in rows)
    im_out = Image.new("RGBA", (maxw, max(total_h, 140)), (60, 60, 60, 255))
    d = ImageDraw.Draw(im_out)
    d.text((6, 4), f"{title}: native 1:1 frames at {S}x (portrait at right, 2x)", fill=(255, 255, 255, 255))
    im_out.alpha_composite(portrait.resize((128, 128), Image.NEAREST), (maxw - 134, 4))
    y = 24
    for r in rows:
        if r[0] == "title":
            d.text((6, y), r[1], fill=(255, 255, 160, 255))
            y += 14
            continue
        x = 0
        for lab, im, W, H in r[1]:
            tile = Image.new("RGBA", (W, H), bg)
            tile.alpha_composite(im)
            tile = tile.resize((W * S, H * S), Image.NEAREST)
            dd = ImageDraw.Draw(tile)
            dd.line([(W * S // 2, 0), (W * S // 2, H * S)], fill=(0, 255, 255, 255), width=1)
            dd.rectangle([0, 0, W * S - 1, H * S - 1], outline=(255, 0, 255, 255))
            dd.text((2, 2), lab, fill=(255, 255, 0, 255))
            im_out.alpha_composite(tile, (x, y))
            x += W * S + pad
        y += r[2] * S + 6
    im_out.convert("RGB").save(path)


def stage_overview(path: Path, blocks: list) -> None:
    """First frame of every clip on a 256x192 stage cell, placed as the renderer does (canvas bottom-centre at
    (128, 192)): shows the body staying at the same stage position from pose to pose (cyan line = stage centre)."""
    cols = 6
    cells = [(n, k, c, (idle or talk)[0][1]) for n, k, c, idle, talk in blocks]
    rows = (len(cells) + cols - 1) // cols
    im = Image.new("RGBA", (cols * 258, rows * 206), (60, 60, 60, 255))
    d = ImageDraw.Draw(im)
    for i, (name, kind, (W, H), arr) in enumerate(cells):
        ox, oy = (i % cols) * 258, (i // cols) * 206
        cell = Image.new("RGBA", (256, 192), (96, 96, 96, 255))
        cell.alpha_composite(Image.fromarray(arr, "RGBA"), ((256 - W) // 2, 192 - H))
        ImageDraw.Draw(cell).line([(128, 0), (128, 192)], fill=(0, 255, 255, 255))
        im.alpha_composite(cell, (ox, oy + 12))
        d.text((ox + 2, oy), f"{name} ({kind})", fill=(255, 255, 160, 255))
    im.convert("RGB").save(path)


def verify(key: str) -> list:
    """Reload every referenced PNG and compare it with a fresh crop of the sheet."""
    spec = SPECS[key]
    sheet = load_sheet(spec["sheet"])
    extras = spec.get("extras")
    out_dir = CHAR_ROOT / spec["folder"]
    manifest = json.loads((out_dir / "character.json").read_text(encoding="utf-8"))
    clips = [(f"{a}.{k}", c, an["canvas"]) for a, an in manifest["animations"].items() for k, c in an.items()
             if k in ("idle", "talking")]
    clips += [(f"reaction:{r}", c, c["canvas"]) for r, c in manifest["reactions"].items()]
    problems, checked, by = [], 0, sheet.by_idx()
    for label, clip, cv in clips:
        if len(clip["offsets"]) != len(clip["frames"]):
            problems.append(f"{label}: offsets/frames length")
        for f, off in zip(clip["frames"], clip["offsets"]):
            n = int(Path(f).stem.rsplit("_", 1)[1])
            png = np.array(Image.open(out_dir / f).convert("RGBA"))
            ref, _ = build_frame(sheet, n, extras)
            checked += 1
            if png.shape != ref.shape or not np.array_equal(png, ref):
                problems.append(f"{f}: differs from the sheet crop")
            if not np.isin(png[..., 3], (0, 255)).all():
                problems.append(f"{f}: semi-transparent pixels")
            if off[0] < 0 or off[1] < 0 or off[0] + png.shape[1] > cv["width"] or off[1] + png.shape[0] > cv["height"]:
                problems.append(f"{f}: does not fit canvas {cv} at {off}")
            if not (extras and n in extras):
                s = by[n]
                exp = int(np.isin(sheet.lab[s.y0:s.y1, s.x0:s.x1], s.ids).sum())
                if int((png[..., 3] > 0).sum()) != exp:
                    problems.append(f"{f}: opaque pixel count != sheet component pixels")
    print(f"[{key}] verified {checked} frame references, {len(problems)} problems")
    return problems


def cmd_list(name: str, min_h: int) -> None:
    sheet = load_sheet(name, min_h=min_h)
    print(f"{sheet.path.name} bg={sheet.bg} {sheet.rgb.shape[1]}x{sheet.rgb.shape[0]} sprites={len(sheet.sprites)} "
          f"dropped={len(sheet.dropped)}")
    cur = 0
    for s in sheet.sprites:
        if s.row != cur:
            cur = s.row
            print(f"-- row {cur}")
        print(f"  #{s.idx:03d} x={s.x0:4d} y={s.y0:4d} w={s.w:3d} h={s.h:3d} bottom={s.y1} {s.mark}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("list")
    p.add_argument("sheet")
    p.add_argument("--min-h", type=int, default=30)
    for c in ("build", "verify"):
        p = sub.add_parser(c)
        p.add_argument("character")
        if c == "build":
            p.add_argument("--scratch", type=Path, default=None)
    a = ap.parse_args()
    if a.cmd == "list":
        cmd_list(a.sheet, a.min_h)
    elif a.cmd in ("build", "verify"):
        keys = list(SPECS) if a.character == "all" else [a.character]
        for k in keys:
            if a.cmd == "build":
                print(json.dumps(build(k, a.scratch), indent=1, default=str))
            else:
                probs = verify(k)
                for q in probs:
                    print("  PROBLEM", q)
                if probs:
                    sys.exit(1)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
