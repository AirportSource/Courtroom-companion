"""Pearl's restrained positive accents exercise the real pack and director."""

import json
from pathlib import Path

import pytest

from app.characters.repository import CharacterRepository
from app.director.director import CharacterDirector, DirectorState
from app.llm.schemas import Beat, CharacterReply


@pytest.fixture(scope="module")
def pearl():
    return CharacterRepository().get("pearl_fey")


def direct(pearl, *beats, state=None):
    return CharacterDirector().direct(
        CharacterReply(beats=[Beat(**beat) for beat in beats]),
        pearl, state, now_ms=1000,
    )[0]


@pytest.mark.parametrize("emotion,intensity,sound", [
    ("happy", 0.72, "soft_transition"),
    ("excited", 0.65, "soft_transition"),
    ("grateful", 0.78, "soft_transition"),
    ("playful", 0.72, "comic"),
    ("laughing", 0.72, "comic"),
    ("surprised", 0.65, "surprise"),
    ("delighted", 0.8, "soft_transition"),
    ("thankful", 0.8, "soft_transition"),
    ("teasing", 0.8, "comic"),
])
def test_expressive_beats_and_aliases(pearl, emotion, intensity, sound):
    timeline = direct(pearl, dict(text="Oh!", emotion=emotion, intensity=intensity))
    assert timeline.segments[0].sfx == sound


# Thresholds follow Pearl's real intensity range (0.3-0.7 in live replies, D-092); below them
# ordinary beats stay quiet, and sensitive or neutral beats never get a sound.
@pytest.mark.parametrize("emotion,intensity", [
    ("happy", 0.5), ("excited", 0.5), ("grateful", 0.55),
    ("playful", 0.45), ("laughing", 0.45), ("surprised", 0.45),
    ("anxious", 0.5), ("embarrassed", 0.45), ("determined", 0.5),
    ("neutral", 1.0), ("sad", 1.0), ("crying", 1.0),
    ("thinking", 1.0), ("polite", 1.0), ("explaining", 1.0),
])
def test_ordinary_warmth_and_sensitive_beats_stay_quiet(pearl, emotion, intensity):
    timeline = direct(pearl, dict(text="I see.", emotion=emotion, intensity=intensity))
    assert timeline.segments[0].sfx is None


def test_multiple_expressive_beats_get_only_one_fallback_sound(pearl):
    timeline = direct(
        pearl,
        dict(text="We did it!", emotion="excited", intensity=0.9),
        dict(text="That was funny!", emotion="playful", intensity=0.9),
    )
    assert len(timeline.segments) == 2
    assert [segment.sfx for segment in timeline.segments] == ["soft_transition", None]


@pytest.mark.parametrize("reaction,sound", [
    ("realization", "realization"), ("comic", "comic"),
    ("cheer", "soft_transition"), ("celebrate", "soft_transition"),
    ("cheers", "soft_transition"), ("gasp", "surprise"),
])
def test_explicit_intent_survives_low_intensity_and_visual_cooldown(pearl, reaction, sound):
    timeline = direct(
        pearl,
        dict(text="Oh, now I see!", emotion="happy", intensity=0.2, reaction=reaction),
        state=DirectorState(last_reaction_at_ms=999),
    )
    assert timeline.segments[0].sfx == sound
    assert timeline.segments[0].reaction is None


def test_all_pearl_sounds_resolve_to_existing_audio_files(pearl):
    audio_root = Path(__file__).resolve().parents[2] / "frontend/public/assets/audio"
    manifest = json.loads((audio_root / "audio.json").read_text(encoding="utf-8"))
    for sound in set(pearl.sfx.emotions.values()) | set(pearl.sfx.reactions.values()):
        sound_id = manifest["events"][f"sfx_{sound}"]
        assert (audio_root / manifest["sounds"][sound_id]["src"]).is_file()
