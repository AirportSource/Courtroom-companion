"""Deterministic offline provider: no network, no API key, no model.

Exercises the whole pipeline with realistic structured replies. The reply is chosen from the
last user message: test triggers first (#malformed, #error, #timeout, #empty, #messy, #text),
then keywords, then a stable hash. Same input -> same output.
"""

import asyncio
import json
import zlib

from ..base import GenerationRequest, LLMProvider, ProviderCapabilities, ProviderError, RawCompletion, StructuredOutputMode

PATTERNS: dict[str, dict] = {
    "greeting": {
        "beats": [{"text": "Oh, hey! It's good to see you. What's on your mind?", "emotion": "happy", "intensity": 0.4}],
        "settleEmotion": "happy",
    },
    "realization": {
        "beats": [
            {"text": "Hmm...", "emotion": "thinking", "intensity": 0.3},
            {"text": "Wait, WHAT?!", "emotion": "surprised", "intensity": 0.95, "reaction": "shocked"},
            {"text": "Oh! Okay, I get it now!", "emotion": "happy", "intensity": 0.6},
        ],
        "settleEmotion": "happy",
    },
    "explain": {
        "beats": [
            {"text": "Hmm... in Python, a decorator wraps a function to change what it does.", "emotion": "thinking", "intensity": 0.4},
            {"text": "Wait, that's kind of like spirit channeling!", "emotion": "excited", "intensity": 0.8, "gesture": "arms_open"},
            {"text": "Okay... maybe not.", "emotion": "playful", "intensity": 0.4},
        ],
        "settleEmotion": "playful",
    },
    "worried": {
        "beats": [
            {"text": "You're serious?", "emotion": "anxious", "intensity": 0.8, "reaction": "shocked"},
            {"text": "That sounds really bad... are you okay?", "emotion": "anxious", "intensity": 0.6},
        ],
        "settleEmotion": "anxious",
    },
    "joke": {
        "beats": [
            {"text": "Heehee! I'm just teasing you.", "emotion": "playful", "intensity": 0.7, "gesture": "hand_mouth"},
        ],
        "settleEmotion": "playful",
    },
    "thanks": {
        "beats": [
            {"text": "Aww, thank you! That really means a lot.", "emotion": "grateful", "intensity": 0.7, "gesture": "clasped_hands"},
        ],
        "settleEmotion": "happy",
    },
    "sad": {
        "beats": [
            {"text": "Oh... I'm sorry to hear that.", "emotion": "sad", "intensity": 0.6},
            {"text": "If you want to talk about it, I'm right here.", "emotion": "neutral", "intensity": 0.4},
        ],
        "settleEmotion": "neutral",
    },
    "neutral": {
        "beats": [{"text": "I see. Tell me more!", "emotion": "neutral", "intensity": 0.5}],
        "settleEmotion": "neutral",
    },
    # Long beats: several sentences, and one long single sentence with a reaction (pagination).
    "story": {
        "beats": [
            {
                "text": "Okay, so this is a little embarrassing, but I have to tell you. Last week I tried to channel my sister to ask her about a case. Instead I got my great-aunt, who only wanted to complain about the weather for an hour!",
                "emotion": "thinking",
                "intensity": 0.5,
            },
            {
                "text": "She even scolded me for not eating enough vegetables, and then she just vanished without saying goodbye, after all that effort and three whole bowls of noodles, can you believe that?",
                "emotion": "anxious",
                "intensity": 0.85,
                "reaction": "shocked",
            },
            {"text": "Well, I guess that's family for you.", "emotion": "happy", "intensity": 0.4},
        ],
        "settleEmotion": "happy",
    },
    "french": {
        "beats": [
            {
                "text": "Attends ! Tu es sérieux ? Je pensais que l'audience était demain, mais apparemment, tout le monde est déjà là… Bon, on y va !",
                "emotion": "surprised",
                "intensity": 0.9,
            }
        ],
        "settleEmotion": "neutral",
    },
    "japanese": {
        "beats": [
            {
                "text": "ええっ！？本当に？昨日の裁判のこと、まだ考えてたんだけど、もしかしたら別の説明があるかもしれないって思ったの。でも、証拠がないとね。",
                "emotion": "surprised",
                "intensity": 0.9,
            }
        ],
        "settleEmotion": "thinking",
    },
    # Deliberately messy: unknown emotion/reaction/gesture, redundant beats, bad intensity.
    "messy": {
        "beats": [
            {"text": "This is the best day EVER!", "emotion": "ecstatic", "intensity": "high", "reaction": "explode", "gesture": "backflip"},
            {"text": "Seriously, the best.", "emotion": "happy", "intensity": 7},
            {"text": "", "emotion": "happy"},
        ],
        "settleEmotion": "jubilant",
    },
}

KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    ((" hello", " hi ", " hi!", " hey", "good morning", "good evening"), "greeting"),
    (("python", "code", "explain", "decorator", "how does", "how do"), "explain"),
    (("what?!", "guess what", "shock", "surprise", "you won't believe"), "realization"),
    (("died", "lost my", "hurt", "accident", "scared"), "worried"),
    (("joke", "funny", "tease", "lol", "haha"), "joke"),
    (("story", "tell me about", "what happened"), "story"),
    (("thank", "thanks", "appreciate"), "thanks"),
    (("sad", "unhappy", "depressed", "lonely", "bad day"), "sad"),
]
ROTATION = ["neutral", "greeting", "realization", "explain", "joke", "thanks", "sad", "worried"]


def choose_pattern(message: str) -> str:
    text = f" {message.lower()} "
    for words, pattern in KEYWORDS:
        if any(word in text for word in words):
            return pattern
    return ROTATION[zlib.crc32(message.encode("utf-8")) % len(ROTATION)]


class FakeProvider(LLMProvider):
    type = "fake"
    capabilities = ProviderCapabilities(structured_output=StructuredOutputMode.JSON_INSTRUCTED)

    def __init__(self, model: str | None = None, timeout_delay_s: float = 3600) -> None:
        super().__init__(model or "fake-director-test")
        self.timeout_delay_s = timeout_delay_s

    async def generate(self, request: GenerationRequest) -> RawCompletion:
        message = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        lowered = message.lower()
        if "#error" in lowered:
            raise ProviderError("fake provider failure (requested by #error)")
        if "#timeout" in lowered:
            await asyncio.sleep(self.timeout_delay_s)
        if "#malformed" in lowered:
            return RawCompletion('{"beats": [{"text": "Unterminated', self.model)
        if "#empty" in lowered:
            return RawCompletion({"beats": [{"text": "   ", "emotion": "happy"}]}, self.model)
        if "#text" in lowered:
            return RawCompletion("Sorry, I only speak plain text today.", self.model)
        # Explicit offline fixtures only; real providers use the shared semantic turn schema.
        # Ordinary Fake patterns and keyword behavior stay unchanged.
        if "artifactAction" in request.response_schema.get("properties", {}):
            for extension, filename, content in [
                ("py", "hello_maya.py", 'print("Hello from Maya.")\n'),
                ("md", "checklist.md", "# Checklist\n\n- [ ] Review the evidence\n- [ ] Take a break\n"),
                ("txt", "answer.txt", "Hello! Your text file is ready.\n"),
            ]:
                if f"#artifact-{extension}" in lowered:
                    return RawCompletion(json.dumps({
                        "beats": [{"text": "All done! Your file is ready below.", "emotion": "happy", "intensity": 0.4}],
                        "settleEmotion": "happy", "artifactAction": {"type": "create_text_artifact",
                            "filename": filename, "format": extension, "content": content},
                    }), self.model)
        pattern = next((p for p in ("messy", "french", "japanese") if f"#{p}" in lowered), None) or choose_pattern(message)
        # Real providers return JSON text; mimic that so the shared parser is exercised.
        return RawCompletion(json.dumps(PATTERNS[pattern]), self.model)
