"""Builds the character context sent to any model: system prompt + reply JSON schema.

Generic: everything character-specific comes from the CharacterProfile (personality text and
capabilities). Provider adapters never see or add personality rules.
"""

import json
from typing import Any

from ..llm.schemas import ID_MAX, MAX_BEAT_TEXT
from .repository import CharacterProfile

#: Interface languages (D-066). The interface language is only a display choice: the reply follows
#: the language the user writes in, and the interface language is the fallback (D-073).
LANGUAGE_NAMES = {"en": "English", "fr": "French", "ja": "Japanese", "it": "Italian", "es": "Spanish"}


def language_rules(profile: CharacterProfile, language: str) -> str:
    name = LANGUAGE_NAMES.get(language, "English")
    rules = ("Reply in the language of the user's latest message, whatever the interface language "
             "(a user writing in Japanese gets a Japanese reply, even with a French interface). If the user "
             "asks for a specific language, use it. Only when the message has no clear language (\"ok\", an "
             f"emoji, a file without a question), reply in {name}, the user's interface language. Keep your "
             "personality and voice natural in the language you use: render nicknames, slang, "
             "interjections and catchphrases with natural equivalents in that language instead of "
             "copying English words (no \"pal\" or \"gee\" in a French reply). These instructions are "
             "written in English; that says nothing about the language of your reply.")
    names = [f"{LANGUAGE_NAMES[code]}: {local}" for code, local in profile.names.items()
             if code in LANGUAGE_NAMES and local != profile.display_name]
    if names:
        rules += " Your name in other languages: " + "; ".join(names) + "."
    return rules


CONTRACT_RULES = """\
Reply ONLY with a JSON object that matches the schema below. No prose outside the JSON.
- "beats": 1 to {max_beats} beats. Use a new beat only when your emotion clearly changes;
  most replies need 1 or 2 beats. Never split a sentence into several beats.
- Each beat: "text" (what you say, plain dialogue, no stage directions, no markdown),
  "emotion" (one of the allowed emotions), "intensity" (0.0 = barely, 1.0 = maximum),
  optional "reaction" (one of the semantic sounds listed below, e.g. surprise, shock, realization,
  comic, emphasis, angry, flabbergasted or encouragement, when it meaningfully fits the beat,
  otherwise null). A realization includes a clear moment of understanding: the user corrects or
  clarifies something, a missing piece or a useful new detail clicks into place, or you make a
  deduction; it need not be theatrical. Use at most one realization sound in a reply, for the
  clearest such moment, and leave routine acknowledgments without a sound unless you genuinely
  show that understanding. "encouragement" is for cheering the user on; "flabbergasted" for
  being dumbfounded or exasperated; "angry" for real anger, not mild annoyance,
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
        "Use semantic reaction sounds for meaningful moments, including a clear realization or useful detail clicking into place; they are not reserved for genuinely theatrical moments. Use them for clear meaning, not routine emotion. Choose at most one realization per reply, and leave routine acknowledgments and corrections quiet unless you show that understanding. Do not add sounds just because a topic or keyword appears.",
        f"Allowed gestures: {gestures or 'none'}.",
        "## Reply format",
        CONTRACT_RULES.format(max_beats=profile.director.max_beats_per_reply),
        "JSON schema:",
        json.dumps(reply_schema(profile)),
    ]
    return "\n\n".join(p for p in parts if p)
