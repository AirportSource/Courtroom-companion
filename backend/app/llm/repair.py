"""Parse + validate + repair untrusted provider output into a CharacterReply.

Shared by every provider (structured-output modes B/C/D). Never raises: returns the best
valid reply it can build plus warnings, or no reply at all (the caller then uses a safe
fallback). Semantic IDs are normalized here but NOT checked against a character: that is
the Character Director's job.
"""

import json
import math
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .schemas import ID_MAX, MAX_BEAT_TEXT, MAX_BEATS, Beat, CharacterReply

_ID_PATTERN = re.compile(r"^[a-z0-9_]{1,%d}$" % ID_MAX)
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_INTENSITY_WORDS = {"low": 0.25, "medium": 0.5, "mid": 0.5, "high": 0.85, "max": 1.0}
DEFAULT_INTENSITY = 0.5


@dataclass
class RepairResult:
    reply: CharacterReply | None
    warnings: list[str] = field(default_factory=list)


def normalize_id(value: Any) -> str | None:
    """'Clasped Hands' -> 'clasped_hands'; anything that isn't a short plain ID -> None."""
    if not isinstance(value, str):
        return None
    candidate = re.sub(r"[\s\-]+", "_", value.strip().lower())
    return candidate if _ID_PATTERN.match(candidate) else None


def _intensity(value: Any, warnings: list[str], index: int) -> float:
    if value is None:
        return DEFAULT_INTENSITY
    if isinstance(value, str) and value.strip().lower() in _INTENSITY_WORDS:
        return _INTENSITY_WORDS[value.strip().lower()]
    try:
        number = float(value)
    except (TypeError, ValueError):
        warnings.append(f"beat {index}: invalid intensity, using {DEFAULT_INTENSITY}")
        return DEFAULT_INTENSITY
    if math.isnan(number) or math.isinf(number):
        warnings.append(f"beat {index}: invalid intensity, using {DEFAULT_INTENSITY}")
        return DEFAULT_INTENSITY
    if number > 1.0 and number <= 10.0:  # tolerate 0..10 scales
        number = number / 10.0
    return min(1.0, max(0.0, number))


def decode_reply_content(content: str, warnings: list[str]) -> Any:
    text = _FENCE.sub("", content.strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)  # JSON embedded in prose
    if match:
        try:
            warnings.append("extracted JSON object from surrounding text")
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    warnings.append("reply was not JSON; treating it as plain dialogue text")
    return {"beats": [{"text": text}]}


def parse_reply(content: str | dict[str, Any] | None) -> RepairResult:
    warnings: list[str] = []
    if content is None:
        return RepairResult(None, ["empty provider response"])
    data: Any = decode_reply_content(content, warnings) if isinstance(content, str) else content
    if not isinstance(data, dict):
        return RepairResult(None, warnings + ["reply is not an object"])

    raw_beats = data.get("beats")
    if raw_beats is None and isinstance(data.get("text"), str):
        raw_beats = [data]  # single-beat shorthand
        warnings.append("single-beat shorthand converted to beats")
    if not isinstance(raw_beats, list):
        return RepairResult(None, warnings + ["missing beats"])

    beats: list[Beat] = []
    for index, raw in enumerate(raw_beats):
        if isinstance(raw, str):
            raw = {"text": raw}
        if not isinstance(raw, dict):
            warnings.append(f"beat {index}: not an object, dropped")
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            warnings.append(f"beat {index}: empty text, dropped")
            continue
        if len(text) > MAX_BEAT_TEXT:
            text = text[:MAX_BEAT_TEXT].rstrip()
            warnings.append(f"beat {index}: text truncated")
        emotion = normalize_id(raw.get("emotion"))
        if raw.get("emotion") is not None and emotion is None:
            warnings.append(f"beat {index}: malformed emotion ignored")
        reaction = normalize_id(raw.get("reaction")) if raw.get("reaction") else None
        gesture = normalize_id(raw.get("gesture")) if raw.get("gesture") else None
        try:
            beats.append(
                Beat(
                    text=text,
                    emotion=emotion or "",
                    intensity=_intensity(raw.get("intensity"), warnings, index),
                    reaction=reaction,
                    gesture=gesture,
                )
            )
        except ValidationError:
            warnings.append(f"beat {index}: invalid, dropped")

    if not beats:
        return RepairResult(None, warnings + ["no usable beats"])
    if len(beats) > MAX_BEATS:
        warnings.append(f"too many beats ({len(beats)}); extra beats merged into the last one")
        tail = " ".join(b.text for b in beats[MAX_BEATS - 1 :])[:MAX_BEAT_TEXT]
        beats = beats[: MAX_BEATS - 1] + [beats[MAX_BEATS - 1].model_copy(update={"text": tail})]

    settle = normalize_id(data.get("settleEmotion", data.get("settle_emotion")))
    return RepairResult(CharacterReply(beats=beats, settle_emotion=settle), warnings)
