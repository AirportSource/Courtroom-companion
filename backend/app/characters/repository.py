"""Loads character packs (the same data the frontend renders from) into capability profiles.

Sources per character, in its pack folder under the assets root:
- character.json   (required) emotions, animations, reactions — shared with the frontend
- performance.json (optional) director settings, gestures, intensity variants, aliases
- personality.md   (optional) character bible for the system prompt

Every reference in performance.json is checked against character.json; invalid entries are
dropped with a warning, so bad data can never reach the director as a valid capability.
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..runtime import paths as runtime_paths

logger = logging.getLogger(__name__)



@dataclass(frozen=True)
class DirectorSettings:
    #: 0 (stoic) .. 1 (very expressive). Scales pose-hold, reaction threshold and cooldown.
    expressiveness: float = 0.5
    max_beats_per_reply: int = 3
    max_reactions_per_reply: int = 1
    reaction_cooldown_ms: int = 8000
    reaction_min_intensity: float = 0.6
    min_pose_hold_ms: int = 1200
    #: A beat at least this intense may change pose even right after a previous change.
    strong_change_intensity: float = 0.65
    #: Rough reading-time estimate used for hold/cooldown maths.
    ms_per_char: int = 40


#: Closed set of semantic reaction sound names. The frontend plays audio.json event `sfx_<name>`.
SFX_NAMES = frozenset(
    {"surprise", "shock", "realization", "comic", "emphasis", "tension", "notification", "soft_transition"}
)


@dataclass(frozen=True)
class SfxSettings:
    """Semantic reaction sounds. Disabled (empty maps) unless performance.json defines `sfx`."""

    #: At most this many reaction sounds per reply.
    max_per_reply: int = 1
    #: Intensity a beat needs to earn an emotion-driven sound (a surviving reaction needs none).
    min_intensity: float = 0.7
    #: Reaction id -> sfx name.
    reactions: dict[str, str] = field(default_factory=dict)
    #: Emotion id -> sfx name, for strong beats without a reaction.
    emotions: dict[str, str] = field(default_factory=dict)
    #: Optional per-emotion thresholds for the moderate, non-explicit fallback.
    emotion_min_intensities: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Gesture:
    animation: str
    #: Emotions this gesture can express; empty = any.
    emotions: tuple[str, ...] = ()


@dataclass(frozen=True)
class IntensityVariant:
    max_intensity: float
    animation: str


@dataclass(frozen=True)
class EmotionBinding:
    animation: str
    reaction: str | None = None


def _text_map(raw: Any) -> dict[str, str]:
    """Language code -> non-empty text; anything else is ignored."""
    if not isinstance(raw, dict):
        return {}
    return {k: v.strip() for k, v in raw.items()
            if isinstance(k, str) and len(k) == 2 and k.isalpha() and isinstance(v, str) and v.strip()}


def _event_lines(raw: Any, emotions: dict, reactions: frozenset[str], warnings: list[str]) -> dict:
    """performance.json `eventLines`; invalid variants are dropped, unknown IDs neutralised."""
    out: dict[str, dict[str, list[dict[str, Any]]]] = {}
    if not isinstance(raw, dict):
        return out
    for event_type, by_language in raw.items():
        if not isinstance(by_language, dict):
            continue
        for language, variants in by_language.items():
            if not (isinstance(language, str) and len(language) == 2 and isinstance(variants, list)):
                continue
            kept = []
            for variant in variants:
                if not isinstance(variant, dict) or not isinstance(variant.get("text"), str) or not variant["text"].strip():
                    warnings.append(f"eventLines.{event_type}.{language}: variant without text dropped")
                    continue
                line: dict[str, Any] = {"text": variant["text"].strip()[:600]}
                if variant.get("emotion") in emotions:
                    line["emotion"] = variant["emotion"]
                if isinstance(variant.get("intensity"), (int, float)) and 0 <= variant["intensity"] <= 1:
                    line["intensity"] = float(variant["intensity"])
                if variant.get("reaction") in reactions:
                    line["reaction"] = variant["reaction"]
                if variant.get("exclamation") in ("objection", "hold_it", "take_that"):
                    line["exclamation"] = variant["exclamation"]
                kept.append(line)
            if kept:
                out.setdefault(str(event_type), {})[language] = kept
    return out


@dataclass
class CharacterProfile:
    id: str
    display_name: str
    default_emotion: str
    fallback_emotion: str
    emotions: dict[str, EmotionBinding]
    animations: frozenset[str]
    reactions: frozenset[str]
    gestures: dict[str, Gesture] = field(default_factory=dict)
    intensity_variants: dict[str, list[IntensityVariant]] = field(default_factory=dict)
    emotion_aliases: dict[str, str] = field(default_factory=dict)
    reaction_aliases: dict[str, str] = field(default_factory=dict)
    director: DirectorSettings = field(default_factory=DirectorSettings)
    sfx: SfxSettings = field(default_factory=SfxSettings)
    error_text: str = "..."
    error_emotion: str | None = None
    personality: str = ""
    warnings: list[str] = field(default_factory=list)
    #: Name per interface language (character.json `names`, D-066); display_name otherwise.
    names: dict[str, str] = field(default_factory=dict)
    #: Error line per language (performance.json `errorLine.translations`); error_text otherwise.
    error_texts: dict[str, str] = field(default_factory=dict)
    #: Lines for inbox events (D-067): event type -> language -> variants
    #: ({text, emotion, intensity?, reaction?, exclamation?}), already validated.
    event_lines: dict[str, dict[str, list[dict[str, Any]]]] = field(default_factory=dict)
    #: Tool groups this character may use (performance.json `tools`); None = every available group.
    tools: list[str] | None = None

    def name_for(self, language: str) -> str:
        return self.names.get(language) or self.display_name

    def error_text_for(self, language: str) -> str:
        return self.error_texts.get(language) or self.error_text

    def capabilities(self) -> dict[str, Any]:
        """Public capability summary (logical IDs only)."""
        return {
            "id": self.id,
            "displayName": self.display_name,
            "emotions": sorted(self.emotions),
            "fallbackEmotion": self.fallback_emotion,
            "reactions": sorted(self.reactions),
            "gestures": sorted(self.gestures),
        }


class CharacterNotFoundError(KeyError):
    pass


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _clamp01(value: Any, default: float) -> float:
    try:
        return min(1.0, max(0.0, float(value)))
    except (TypeError, ValueError):
        return default


class CharacterRepository:
    def __init__(self, assets_dir: Path | None = None) -> None:
        self.assets_dir = Path(assets_dir or runtime_paths.assets_dir())
        self._cache: dict[str, CharacterProfile] = {}

    def _index(self) -> dict[str, str]:
        index = _read_json(self.assets_dir / "characters" / "index.json")
        return {k: v for k, v in index.get("characters", {}).items() if isinstance(v, str)}

    def ids(self) -> list[str]:
        return sorted(self._index())

    def get(self, character_id: str) -> CharacterProfile:
        if character_id in self._cache:
            return self._cache[character_id]
        manifest_rel = self._index().get(character_id)
        if manifest_rel is None:
            raise CharacterNotFoundError(character_id)
        manifest_path = (self.assets_dir / "characters" / manifest_rel).resolve()
        profile = self._load(character_id, manifest_path)
        for warning in profile.warnings:
            logger.warning("character %s: %s", character_id, warning)
        self._cache[character_id] = profile
        return profile

    def _load(self, character_id: str, manifest_path: Path) -> CharacterProfile:
        manifest = _read_json(manifest_path)
        pack_dir = manifest_path.parent
        warnings: list[str] = []

        animations = frozenset(k for k, v in manifest.get("animations", {}).items() if isinstance(v, dict))
        reactions = frozenset(k for k, v in manifest.get("reactions", {}).items() if isinstance(v, dict))
        emotions: dict[str, EmotionBinding] = {}
        for emotion, binding in manifest.get("emotions", {}).items():
            if not isinstance(binding, dict) or binding.get("animation") not in animations:
                warnings.append(f"emotion '{emotion}' has no valid animation; dropped")
                continue
            reaction = binding.get("reaction")
            emotions[emotion] = EmotionBinding(binding["animation"], reaction if reaction in reactions else None)
        if not emotions:
            raise ValueError(f"character '{character_id}' has no usable emotions")

        fallback = manifest.get("fallbackEmotion")
        fallback = fallback if fallback in emotions else next(iter(emotions))
        default = manifest.get("defaultEmotion")
        default = default if default in emotions else fallback

        perf_path = pack_dir / "performance.json"
        perf: dict[str, Any] = _read_json(perf_path) if perf_path.exists() else {}
        d = perf.get("director", {}) if isinstance(perf.get("director"), dict) else {}
        defaults = DirectorSettings()
        director = DirectorSettings(
            expressiveness=_clamp01(d.get("expressiveness"), defaults.expressiveness),
            max_beats_per_reply=max(1, int(d.get("maxBeatsPerReply", defaults.max_beats_per_reply))),
            max_reactions_per_reply=max(0, int(d.get("maxReactionsPerReply", defaults.max_reactions_per_reply))),
            reaction_cooldown_ms=max(0, int(d.get("reactionCooldownMs", defaults.reaction_cooldown_ms))),
            reaction_min_intensity=_clamp01(d.get("reactionMinIntensity"), defaults.reaction_min_intensity),
            min_pose_hold_ms=max(0, int(d.get("minPoseHoldMs", defaults.min_pose_hold_ms))),
            strong_change_intensity=_clamp01(d.get("strongChangeIntensity"), defaults.strong_change_intensity),
            ms_per_char=max(1, int(d.get("msPerChar", defaults.ms_per_char))),
        )

        gestures: dict[str, Gesture] = {}
        for gid, g in (perf.get("gestures") or {}).items():
            if not isinstance(g, dict) or g.get("animation") not in animations:
                warnings.append(f"gesture '{gid}' references unknown animation; dropped")
                continue
            allowed = tuple(e for e in g.get("emotions", []) if e in emotions)
            gestures[gid] = Gesture(g["animation"], allowed)

        variants: dict[str, list[IntensityVariant]] = {}
        for emotion, steps in (perf.get("intensityVariants") or {}).items():
            if emotion not in emotions or not isinstance(steps, list):
                warnings.append(f"intensity variants for unknown emotion '{emotion}'; dropped")
                continue
            valid = []
            for step in steps:
                if isinstance(step, dict) and step.get("animation") in animations:
                    valid.append(IntensityVariant(_clamp01(step.get("maxIntensity"), 1.0), step["animation"]))
                else:
                    warnings.append(f"intensity variant for '{emotion}' references unknown animation; dropped")
            if valid:
                variants[emotion] = sorted(valid, key=lambda v: v.max_intensity)

        emotion_aliases = {a: t for a, t in (perf.get("emotionAliases") or {}).items() if t in emotions}
        reaction_aliases = {a: t for a, t in (perf.get("reactionAliases") or {}).items() if t in reactions}

        sfx = self._read_sfx(perf.get("sfx"), emotions, reactions, reaction_aliases, warnings)

        error = perf.get("errorLine") or {}
        personality_path = pack_dir / "personality.md"
        return CharacterProfile(
            id=character_id,
            display_name=str(manifest.get("displayName") or character_id),
            default_emotion=default,
            fallback_emotion=fallback,
            emotions=emotions,
            animations=animations,
            reactions=reactions,
            gestures=gestures,
            intensity_variants=variants,
            emotion_aliases=emotion_aliases,
            reaction_aliases=reaction_aliases,
            director=director,
            sfx=sfx,
            error_text=str(error.get("text") or "..."),
            error_emotion=error.get("emotion") if error.get("emotion") in emotions else None,
            personality=personality_path.read_text(encoding="utf-8") if personality_path.exists() else "",
            warnings=warnings,
            names=_text_map(manifest.get("names")),
            error_texts=_text_map(error.get("translations")),
            event_lines=_event_lines(perf.get("eventLines"), emotions, reactions, warnings),
            tools=[t for t in perf["tools"] if t in ("reminders", "folders", "web_search")] if isinstance(perf.get("tools"), list) else None,
        )

    @staticmethod
    def _read_sfx(
        raw: Any,
        emotions: dict[str, EmotionBinding],
        reactions: frozenset[str],
        reaction_aliases: dict[str, str],
        warnings: list[str],
    ) -> SfxSettings:
        if not isinstance(raw, dict):
            return SfxSettings()

        def table(key: str, known: Any) -> dict[str, str]:
            out: dict[str, str] = {}
            for name, sfx in (raw.get(key) or {}).items():
                if sfx is None:
                    continue  # explicit "no sound"
                if name not in known:
                    warnings.append(f"sfx.{key}: unknown id '{name}'; dropped")
                elif sfx not in SFX_NAMES:
                    warnings.append(f"sfx.{key}: unknown sfx '{sfx}' for '{name}'; dropped")
                else:
                    out[name] = sfx
            return out

        defaults = SfxSettings()
        try:
            max_per_reply = max(0, int(raw.get("maxPerReply", defaults.max_per_reply)))
        except (TypeError, ValueError):
            max_per_reply = defaults.max_per_reply
        reaction_names = set(reactions) | set(reaction_aliases) | set(SFX_NAMES)
        raw_thresholds = raw.get("emotionMinIntensities")
        emotion_min_intensities: dict[str, float] = {}
        if isinstance(raw_thresholds, dict):
            for emotion, value in raw_thresholds.items():
                if emotion not in emotions:
                    warnings.append(f"sfx.emotionMinIntensities: unknown emotion '{emotion}'; dropped")
                elif isinstance(value, (int, float)) and not isinstance(value, bool):
                    emotion_min_intensities[emotion] = _clamp01(value, defaults.min_intensity)
                else:
                    warnings.append(f"sfx.emotionMinIntensities: invalid threshold for '{emotion}'; dropped")
        return SfxSettings(
            max_per_reply=max_per_reply,
            min_intensity=_clamp01(raw.get("minIntensity"), defaults.min_intensity),
            reactions=table("reactions", reaction_names),
            emotions=table("emotions", emotions),
            emotion_min_intensities=emotion_min_intensities,
        )
