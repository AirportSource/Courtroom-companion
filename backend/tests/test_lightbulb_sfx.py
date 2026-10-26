"""Focused coverage for restrained realization SFX guidance and playback."""

from app.characters.prompt import build_system_prompt, reply_schema
from app.characters.repository import CharacterRepository
from app.director.director import CharacterDirector, DirectorState
from app.llm.schemas import Beat, CharacterReply


def test_ready_character_prompts_allow_meaningful_non_theatrical_realization():
    repo = CharacterRepository()
    profiles = [repo.get(cid) for cid in repo.all_ids()]
    profiles = [profile for profile in profiles if profile.readiness == "ready"]
    assert profiles
    for profile in profiles:
        prompt = build_system_prompt(profile)
        assert "clear moment of" in prompt and "understanding" in prompt
        assert "at most one realization" in prompt
        assert "routine acknowledgments" in prompt
        assert "Do not add sounds just because a topic or keyword appears" in prompt
        allowed = reply_schema(profile)["properties"]["beats"]["items"]["properties"]["reaction"]
        assert "realization" in allowed["anyOf"][0]["enum"]


def test_explicit_realization_sound_survives_low_intensity_and_visual_cooldown():
    maya = CharacterRepository().get("maya_fey")
    reply = CharacterReply(beats=[Beat(text="Oh, I understand now!", emotion="thinking",
                                       intensity=0.2, reaction="realization")])
    timeline, _ = CharacterDirector().direct(reply, maya, DirectorState(last_reaction_at_ms=999), now_ms=1000)
    assert timeline.segments[0].reaction is None
    assert timeline.segments[0].sfx == "realization"


def test_realization_sfx_is_limited_to_one_per_reply_but_other_explicit_sounds_remain():
    maya = CharacterRepository().get("maya_fey")
    reply = CharacterReply(beats=[
        Beat(text="That detail clicks.", emotion="thinking", intensity=0.2, reaction="realization"),
        Beat(text="Oh, now I see the whole picture.", emotion="thinking", intensity=0.2,
             reaction="realization"),
        Beat(text="Wait, what?!", emotion="surprised", intensity=0.2, reaction="shock"),
    ])
    timeline, _ = CharacterDirector().direct(reply, maya, now_ms=1000)
    assert [segment.sfx for segment in timeline.segments] == ["realization", None, "shock"]
