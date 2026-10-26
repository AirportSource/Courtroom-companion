"""Shared "everyone" sounds, frequency model, realization and the complete whip (D-091, D-092)."""

import collections
import json

import pytest

from app.characters.prompt import build_system_prompt
from app.characters.repository import SFX_ALIASES, SHARED_SFX_REACTIONS, CharacterRepository
from app.director.director import CharacterDirector, DirectorState
from app.events.inbox import EVENT_TYPES, Event, event_performance
from app.llm.schemas import Beat, CharacterReply
from app.runtime import paths as runtime_paths


@pytest.fixture(scope="module")
def repo():
    return CharacterRepository()


def reply(*beats):
    return CharacterReply(beats=[Beat(**beat) for beat in beats])


def run(profile, replies, state=None):
    director, state, out = CharacterDirector(), state or DirectorState(), []
    for r in replies:
        timeline, state = director.direct(r, profile, state, now_ms=0)
        out.append(timeline)
    return out, state


# ---- everyone -------------------------------------------------------------------------------

def test_shared_sounds_are_available_to_every_character_with_sfx(repo):
    for cid in repo.all_ids():
        profile = repo.get(cid)
        if not profile.sfx.reactions:
            continue
        for name in ("angry", "flabbergasted", "encouragement", "realization"):
            assert profile.sfx.reactions.get(name) == name, (cid, name)
        assert profile.sfx.reactions["scared"] == "shock"
        assert profile.sfx.reactions["you_can_do_it"] == "encouragement"
        assert profile.sfx.reactions["insightful"] == "realization"
        assert set(build_system_prompt(profile).split("Available semantic reaction sounds: ")[1].split(".")[0].split(", ")) \
            >= {"angry", "flabbergasted", "encouragement"}


def test_aliases_and_shared_names_have_audio_events():
    audio = json.loads((runtime_paths.assets_dir() / "audio" / "audio.json").read_text(encoding="utf-8"))
    for name in set(SHARED_SFX_REACTIONS.values()) | set(SFX_ALIASES.values()):
        assert f"sfx_{name}" in audio["events"], name
    for name, pool in audio["semanticSounds"].items():
        assert f"sfx_{name}" in audio["events"] and pool and all(sound in audio["sounds"] for sound in pool)


def test_explicit_shared_request_resolves_for_a_non_maya_character(repo):
    edgeworth = repo.get("miles_edgeworth")
    (timeline,), _ = run(edgeworth, [reply(dict(text="Unbelievable.", emotion="angry", intensity=0.3, reaction="flabbergasted"))])
    assert timeline.segments[0].sfx == "flabbergasted"
    (timeline,), _ = run(edgeworth, [reply(dict(text="You can do this.", emotion="determined", intensity=0.4, reaction="you_can_do_it"))])
    assert timeline.segments[0].sfx == "encouragement"


def test_a_character_table_can_remove_a_shared_sound(tmp_path):
    from app.characters.repository import CharacterRepository as Repo

    perf = {"sfx": {"reactions": {"angry": None}}}
    sfx = Repo._read_sfx(perf["sfx"], {"neutral": None}, frozenset(), {}, [])
    assert "angry" not in sfx.reactions and sfx.reactions["shock"] == "shock"


# ---- the complete whip ------------------------------------------------------------------------

def test_whip_is_complete_or_absent(repo):
    franziska = repo.get("franziska_von_karma")
    (sig,) = [s for s in franziska.sfx.signature if s.id == "whip"]
    assert sig.performs == "whip_crack"
    furious = reply(dict(text="Foolish fool!", emotion="angry", intensity=0.95))
    timelines, _ = run(franziska, [furious] * 8)
    whips = [t.segments[0].reaction == "whip_crack" for t in timelines]
    assert whips[0] and whips.count(True) == 2  # turn 1, then after five silent replies
    for t in timelines:
        segment = t.segments[0]
        assert segment.reaction != "whip_crack" or segment.sfx is None  # the cues carry the sounds


def test_angry_without_eligibility_never_shows_a_partial_whip(repo):
    franziska = repo.get("franziska_von_karma")
    # Mild anger: an emotion, not a whip.
    (mild,), _ = run(franziska, [reply(dict(text="Hmph.", emotion="angry", intensity=0.6))])
    assert mild.segments[0].reaction is None and mild.segments[0].sfx is None
    # Asking for the whip while it cools down drops the body reaction too.
    ask = reply(dict(text="Fool!", emotion="angry", intensity=0.95, reaction="whip"))
    (first,), _ = run(franziska, [ask])
    assert first.segments[0].reaction == "whip_crack"
    # Visual reaction rules allow it (no recent reaction), but the whip signature is cooling down.
    (cooling,), _ = run(franziska, [ask], DirectorState(turn=1, signature_last_turn={"whip": 1}))
    assert cooling.segments[0].reaction is None and cooling.segments[0].sfx is None
    assert any("never a partial effect" in note for note in cooling.notes)


def test_inbox_events_never_whip(repo):
    franziska = repo.get("franziska_von_karma")
    for number, event_type in enumerate(sorted(EVENT_TYPES), start=1):
        segments = event_performance(franziska, Event(number, event_type, "x", 0.0), "en", CharacterDirector())["performance"]["segments"]
        assert all(s["reaction"] != "whip_crack" for s in segments)


# ---- frequency model ------------------------------------------------------------------------

def test_fallback_and_category_cooldowns_space_out_pearl(repo):
    pearl = repo.get("pearl_fey")
    playful = reply(dict(text="Hehe!", emotion="playful", intensity=0.7))
    timelines, _ = run(pearl, [playful] * 6)
    sounds = [t.segments[0].sfx for t in timelines]
    assert sounds == ["comic", None, "comic", None, "comic", None]
    assert "fallback cooldown" in " ".join(timelines[1].notes)


def test_drought_lets_a_moderate_beat_through_after_silent_replies(repo):
    pearl = repo.get("pearl_fey")
    quiet = reply(dict(text="Okay.", emotion="polite", intensity=0.4))
    happy = reply(dict(text="That's nice!", emotion="happy", intensity=0.5))  # below 0.55 normally
    (fresh,), _ = run(pearl, [happy])
    assert fresh.segments[0].sfx is None
    timelines, _ = run(pearl, [quiet, quiet, quiet, happy])
    assert timelines[-1].segments[0].sfx == "soft_transition"
    assert "after 3 silent replies" in " ".join(timelines[-1].notes)


def test_explicit_requests_are_not_held_by_fallback_cooldowns(repo):
    pearl = repo.get("pearl_fey")
    timelines, _ = run(pearl, [
        reply(dict(text="Hehe!", emotion="playful", intensity=0.8)),
        reply(dict(text="Oh! I understand now!", emotion="happy", intensity=0.3, reaction="realization")),
    ])
    assert [t.segments[0].sfx for t in timelines] == ["comic", "realization"]


# ---- realization ------------------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    "Oh, you meant the second file! That changes everything.",   # clarification
    "Ah, you're right, it was Tuesday, not Monday.",              # correction
    "Wait, so the key was in the drawer the whole time!",         # deduction / missing piece
])
def test_meaningful_understanding_can_play_realization(repo, text):
    maya = repo.get("maya_fey")
    (timeline,), _ = run(maya, [reply(dict(text=text, emotion="surprised", intensity=0.4, reaction="realization"))])
    assert timeline.segments[0].sfx == "realization"


def test_ordinary_turn_and_second_realization_stay_quiet(repo):
    maya = repo.get("maya_fey")
    (ordinary,), _ = run(maya, [reply(dict(text="Sure, sounds good.", emotion="neutral", intensity=0.4))])
    assert ordinary.segments[0].sfx is None
    (double,), _ = run(maya, [reply(dict(text="Oh!", emotion="surprised", intensity=0.4, reaction="realization"),
                                    dict(text="And also!", emotion="happy", intensity=0.4, reaction="realization"))])
    assert [s.sfx for s in double.segments] == ["realization", None]


def test_prompt_names_corrections_clarifications_and_deductions(repo):
    prompt = build_system_prompt(repo.get("pearl_fey"))
    for phrase in ("corrects or", "clarifies", "deduction", "missing piece"):
        assert phrase in prompt


# ---- Pearl simulation -------------------------------------------------------------------------

PEARL_SESSION = [
    ("Hi Pearl!", "happy", 0.5, None),
    ("I'm a bit tired today.", "anxious", 0.5, None),
    ("Guess what, I got the job!", "excited", 0.7, "cheer"),
    ("It was a long interview.", "polite", 0.4, None),
    ("They asked about Maya.", "surprised", 0.6, None),
    ("I said she's my friend.", "playful", 0.55, None),
    ("Wait, it's not Monday, it's Tuesday.", "thinking", 0.4, "realization"),
    ("I'm scared of the first day.", "anxious", 0.6, None),
    ("Thanks for listening.", "grateful", 0.5, None),
    ("Will you cheer me on?", "determined", 0.65, None),
    ("Haha, you're funny.", "laughing", 0.6, None),
    ("Is Maya seeing someone?", "embarrassed", 0.6, None),
]


def test_pearl_session_is_alive_but_not_every_line(repo):
    pearl = repo.get("pearl_fey")
    replies = [reply(dict(text=f"(reply to: {user})", emotion=emotion, intensity=intensity, reaction=reaction))
               for user, emotion, intensity, reaction in PEARL_SESSION]
    timelines, _ = run(pearl, replies)
    sounds = [t.segments[0].sfx for t in timelines]
    played = [s for s in sounds if s]
    categories = collections.Counter(played)
    assert 5 <= len(played) <= 9, sounds        # several cues in a short session, not every reply
    assert len(categories) >= 4, categories      # varied, fitting categories
    assert None in sounds
    assert not any(a == b and a for a, b in zip(sounds, sounds[1:]) if a != "realization"), sounds


# ---- Franziska's whip balance (D-094) ------------------------------------------------------

@pytest.mark.parametrize("emotion,intensity", [
    ("angry", 0.7), ("impatient", 0.7), ("frustrated", 0.7), ("fed_up", 0.7),
    ("embarrassed", 0.6), ("shy", 0.65), ("flustered", 0.65),
])
def test_impatience_anger_and_fluster_reach_for_the_whip(repo, emotion, intensity):
    franziska = repo.get("franziska_von_karma")
    (timeline,), _ = run(franziska, [reply(dict(text="Hmph!", emotion=emotion, intensity=intensity))])
    assert timeline.segments[0].reaction == "whip_crack", timeline.notes


def test_asking_for_the_whip_works_for_repetition_even_at_moderate_intensity(repo):
    franziska = repo.get("franziska_von_karma")
    (timeline,), _ = run(franziska, [reply(dict(text="I will not say it a third time!", emotion="serious",
                                                intensity=0.4, reaction="whip_crack"))])
    assert timeline.segments[0].reaction == "whip_crack"


@pytest.mark.parametrize("emotion,intensity", [
    ("angry", 0.6), ("embarrassed", 0.5), ("serious", 0.9), ("determined", 0.9),
    ("explaining", 0.9), ("playful", 0.9), ("sad", 0.9), ("surprised", 0.9),
])
def test_classic_emotions_stay_classic(repo, emotion, intensity):
    franziska = repo.get("franziska_von_karma")
    (timeline,), _ = run(franziska, [reply(dict(text="Listen.", emotion=emotion, intensity=intensity))])
    assert timeline.segments[0].reaction != "whip_crack"


def test_a_provoking_conversation_mixes_whips_and_classic_poses(repo):
    franziska = repo.get("franziska_von_karma")
    # Emotions/intensities as in the recorded live "provoked" and "fury" sessions, plus requests.
    session = [
        ("explaining", 0.5, None), ("angry", 0.7, None), ("serious", 0.5, None), ("angry", 0.85, None),
        ("determined", 0.6, None), ("embarrassed", 0.65, None), ("playful", 0.5, None), ("serious", 0.6, None),
        ("angry", 0.75, None), ("serious", 0.4, "whip_crack"), ("relaxed", 0.4, None), ("angry", 0.6, None),
    ]
    timelines, _ = run(franziska, [reply(dict(text="...", emotion=e, intensity=i, reaction=r)) for e, i, r in session])
    whips = [i for i, t in enumerate(timelines) if t.segments[0].reaction == "whip_crack"]
    assert 2 <= len(whips) <= 4, whips                      # the whip is part of her, not every reply
    assert all(b - a > 3 for a, b in zip(whips, whips[1:]))  # at least three replies between lashes
    assert len(session) - len(whips) >= 8                    # classic poses carry most of the talk
