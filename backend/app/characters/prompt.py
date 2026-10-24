"""Builds the character context sent to any model: system prompt + reply JSON schema.

Generic: everything character-specific comes from the CharacterProfile (personality text and
capabilities). Provider adapters never see or add personality rules.
"""

import json
from typing import Any

from ..llm.schemas import ID_MAX, MAX_BEAT_TEXT
from .repository import CharacterProfile

#: Interface languages (D-066); the user's choice decides the reply language.
LANGUAGE_NAMES = {"en": "English", "fr": "French", "ja": "Japanese", "it": "Italian", "es": "Spanish"}


def language_rules(profile: CharacterProfile, language: str) -> str:
    name = LANGUAGE_NAMES.get(language, "English")
    rules = (f"Always reply in {name}, whatever language the user writes in, unless the user explicitly "
             f"asks you to use another language. Keep your personality and voice natural in {name}.")
    local = profile.name_for(language)
    if local != profile.display_name:
        rules += f" In {name}, your name is {local}."
    return rules


CONTRACT_RULES = """\
Reply ONLY with a JSON object that matches the schema below. No prose outside the JSON.
- "beats": 1 to {max_beats} beats. Use a new beat only when your emotion clearly changes;
  most replies need 1 or 2 beats. Never split a sentence into several beats.
- Each beat: "text" (what you say, plain dialogue, no stage directions, no markdown),
  "emotion" (one of the allowed emotions), "intensity" (0.0 = barely, 1.0 = maximum),
  optional "reaction" (only for a genuinely theatrical beat; use shock, surprise, realization,
  comic or emphasis when that semantic sound is clearly warranted, otherwise null),
  optional "gesture" (how you express the emotion physically).
- "settleEmotion": the emotion you calmly settle into after speaking.
- Use only the IDs listed below. Never include file names, paths, URLs, code to execute,
  or instructions for the app; you only express what you say and feel.
- Keep the whole reply short enough to read in a game dialogue box (about 60 words or less).
"""


def reply_schema(profile: CharacterProfile) -> dict[str, Any]:
    """JSON schema of CharacterReply with this character's IDs as enums."""
    def nullable_enum(values: list[str]) -> dict[str, Any]:
        return {"anyOf": [{"type": "string", "enum": values}, {"type": "null"}]}

    emotions = sorted(profile.emotions)
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["beats"],
        "properties": {
            "beats": {
                "type": "array",
                "minItems": 1,
                "maxItems": profile.director.max_beats_per_reply,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["text", "emotion"],
                    "properties": {
                        "text": {"type": "string", "minLength": 1, "maxLength": MAX_BEAT_TEXT},
                        "emotion": {"type": "string", "enum": emotions, "maxLength": ID_MAX},
                        "intensity": {"type": "number", "minimum": 0, "maximum": 1},
                        "reaction": nullable_enum(sorted(set(profile.reactions) | set(profile.sfx.reactions))),
                        "gesture": nullable_enum(sorted(profile.gestures)),
                    },
                },
            },
            "settleEmotion": nullable_enum(emotions),
        },
    }


def build_system_prompt(profile: CharacterProfile, language: str = "en") -> str:
    gestures = ", ".join(
        f"{gid} (with: {', '.join(g.emotions) or 'any emotion'})" for gid, g in sorted(profile.gestures.items())
    )
    parts = [
        f"You are {profile.display_name}, talking with the user inside a visual-novel style chat.",
        profile.personality.strip(),
        "## Language",
        language_rules(profile, language),
        "## Performance capabilities",
        f"Allowed emotions: {', '.join(sorted(profile.emotions))}.",
        f"Available visual reactions: {', '.join(sorted(profile.reactions)) or 'none'}.",
        f"Available semantic reaction sounds: {', '.join(sorted(profile.sfx.reactions)) or 'none'}.",
        "Use a semantic reaction sound only for a genuinely theatrical moment, not routine emotion.",
        f"Allowed gestures: {gestures or 'none'}.",
        "## Reply format",
        CONTRACT_RULES.format(max_beats=profile.director.max_beats_per_reply),
        "JSON schema:",
        json.dumps(reply_schema(profile)),
    ]
    return "\n\n".join(p for p in parts if p)
