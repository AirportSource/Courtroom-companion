"""Multi-character platform: readiness, signature sounds, per-character isolation.

Nothing here names a real character in the code under test; real packs are only used as data.
"""

import asyncio
import json

import pytest

from app.characters.prompt import build_system_prompt
from app.characters.repository import (
    ALLOW_PARTIAL_ENV,
    CharacterNotReadyError,
    CharacterRepository,
)
from app.characters.service import CharacterService
from app.director.director import CharacterDirector, DirectorState
from app.llm.base import GenerationRequest, LLMProvider, RawCompletion
from app.llm.config import ProviderConfig
from app.llm.gateway import LLMGateway
from app.llm.schemas import Beat, CharacterReply

# ---- helpers: a throw-away assets folder with tiny packs ------------------------------------


def animation(name: str) -> dict:
    clip = {"fps": 6, "loop": True, "frames": [f"sprites/{name}.png"]}
    return {"idle": clip, "talking": clip}


def make_pack(root, pack_id: str, *, readiness=None, personality="Calm and precise.", performance="default",
              angry_reaction=None):
    folder = root / "characters" / pack_id
    folder.mkdir(parents=True)
    manifest = {
        "schemaVersion": 1,
        "id": pack_id,
        "displayName": pack_id.title(),
        "defaultEmotion": "calm",
        "fallbackEmotion": "calm",
        "animations": {"calm_pose": animation("calm"), "angry_pose": animation("angry")},
        "reactions": {"flash": {"fps": 6, "frames": ["sprites/flash.png"]}},
        "emotions": {"calm": {"animation": "calm_pose"}, "angry": {"animation": "angry_pose"}},
    }
    if readiness is not None:
        manifest["readiness"] = readiness
    if angry_reaction:
        manifest["emotions"]["angry"]["reaction"] = angry_reaction
    (folder / "character.json").write_text(json.dumps(manifest), encoding="utf-8")
    if personality is not None:
        (folder / "personality.md").write_text(personality, encoding="utf-8")
    if performance == "default":
        performance = {"director": {"expressiveness": 0.5}}
    if performance is not None:
        (folder / "performance.json").write_text(json.dumps(performance), encoding="utf-8")
    return folder


def register(root, *pack_ids):
    index = {"schemaVersion": 1, "characters": {p: f"{p}/character.json" for p in pack_ids}}
    (root / "characters" / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return CharacterRepository(root)


@pytest.fixture
def no_partial(monkeypatch):
    monkeypatch.delenv(ALLOW_PARTIAL_ENV, raising=False)


# ---- readiness ----------------------------------------------------------------------------


def test_real_launch_characters_are_ready(no_partial):
    repo = CharacterRepository()
    for character_id in ("maya_fey", "dick_gumshoe", "mia_fey"):
        profile = repo.get_for_chat(character_id)
        assert profile.readiness == "ready"
        assert character_id in repo.ids()


def test_readiness_is_derived_conservatively_when_not_declared(tmp_path, no_partial):
    make_pack(tmp_path, "full")
    make_pack(tmp_path, "persona_only", performance=None)
    make_pack(tmp_path, "bare", personality=None, performance=None)
    repo = register(tmp_path, "full", "persona_only", "bare")
    assert [repo.get(p).readiness for p in ("full", "persona_only", "bare")] == ["ready", "partial", "asset-only"]


def test_declared_ready_cannot_exceed_the_files(tmp_path, no_partial):
    make_pack(tmp_path, "liar", readiness="ready", performance=None)
    make_pack(tmp_path, "typo", readiness="finished")
    repo = register(tmp_path, "liar", "typo")
    liar = repo.get("liar")
    assert liar.readiness == "partial" and any("treated as 'partial'" in w for w in liar.warnings)
    typo = repo.get("typo")
    assert typo.readiness == "ready" and any("not one of" in w for w in typo.warnings)


def test_only_ready_packs_chat_by_default(tmp_path, no_partial):
    make_pack(tmp_path, "ready_one", readiness="ready")
    make_pack(tmp_path, "wip", readiness="partial")
    make_pack(tmp_path, "assets", readiness="asset-only")
    repo = register(tmp_path, "ready_one", "wip", "assets")
    assert repo.ids() == ["ready_one"]
    assert repo.all_ids() == ["assets", "ready_one", "wip"]
    repo.get_for_chat("ready_one")
    for blocked, level in (("wip", "partial"), ("assets", "asset-only")):
        with pytest.raises(CharacterNotReadyError) as error:
            repo.get_for_chat(blocked)
        assert level in str(error.value) and ALLOW_PARTIAL_ENV in str(error.value)


def test_partial_packs_chat_only_with_the_development_switch(tmp_path, monkeypatch):
    make_pack(tmp_path, "wip", readiness="partial")
    make_pack(tmp_path, "assets", readiness="asset-only")
    repo = register(tmp_path, "wip", "assets")
    monkeypatch.setenv(ALLOW_PARTIAL_ENV, "1")
    assert repo.ids() == ["wip"]
    repo.get_for_chat("wip")
    with pytest.raises(CharacterNotReadyError):
        repo.get_for_chat("assets")  # asset-only never chats, even in development


class _Echo(LLMProvider):
    type = "echo"

    def __init__(self, beat=None):
        super().__init__("echo")
        self.requests: list[GenerationRequest] = []
        self.beat = beat or {"text": "Understood.", "emotion": "calm", "intensity": 0.4}

    async def generate(self, request):
        self.requests.append(request)
        return RawCompletion({"beats": [self.beat]}, self.model)


def make_service(repo, beat=None):
    provider = _Echo(beat)
    gateway = LLMGateway(ProviderConfig(type="fake"))
    gateway.provider = provider
    return CharacterService(repo, gateway), provider


def test_service_refuses_a_pack_that_is_not_ready(tmp_path, no_partial):
    make_pack(tmp_path, "wip", readiness="partial")
    service, provider = make_service(register(tmp_path, "wip"))
    with pytest.raises(CharacterNotReadyError):
        asyncio.run(service.chat("wip", "hello"))
    assert provider.requests == []  # nothing reached the model


# ---- signature sounds -----------------------------------------------------------------------

WHIP = {"id": "whip", "reactions": ["emphasis"], "emotions": ["angry"], "minIntensity": 0.8,
        "cooldownTurns": 4, "maxPerReply": 1}


def signature_pack(tmp_path, signature=None, sfx_extra=None):
    sfx = {"maxPerReply": 1, "minIntensity": 0.75, "reactions": {"emphasis": "emphasis"}, "signature": [signature or WHIP]}
    sfx.update(sfx_extra or {})
    make_pack(tmp_path, "whipper", readiness="ready",
              performance={"director": {"expressiveness": 0.5, "reactionCooldownMs": 0}, "sfx": sfx})
    return register(tmp_path, "whipper").get("whipper")


def angry(intensity=0.95, reaction=None, text="Silence."):
    return CharacterReply(beats=[Beat(text=text, emotion="angry", intensity=intensity, reaction=reaction)])


def sounds_over(profile, replies, session_state=None):
    director, state, out = CharacterDirector(), session_state or DirectorState(), []
    for r in replies:
        timeline, state = director.direct(r, profile, state, now_ms=0)
        out.append(timeline.segments[0].sfx)
    return out, state


def test_signature_declaration_is_validated(tmp_path):
    profile = signature_pack(tmp_path)
    (sig,) = profile.sfx.signature
    assert (sig.id, sig.cooldown_turns, sig.min_intensity) == ("whip", 4, 0.8)


@pytest.mark.parametrize("bad", [
    {"id": "Whip!", "emotions": ["angry"]},                # invalid id
    {"id": "shock", "emotions": ["angry"]},                # collides with a global sound
    {"id": "whip", "emotions": ["nonexistent"]},           # nothing valid to trigger on
    {"id": "whip"},                                        # no triggers at all
])
def test_invalid_signatures_are_dropped_with_a_warning(tmp_path, bad):
    profile = signature_pack(tmp_path, bad)
    assert profile.sfx.signature == () and any("sfx.signature" in w for w in profile.warnings)


def test_twelve_strong_angry_replies_do_not_whip_every_turn(tmp_path):
    profile = signature_pack(tmp_path)
    sounds, _ = sounds_over(profile, [angry(0.95)] * 12)
    played = [i for i, s in enumerate(sounds) if s == "whip"]
    assert played == [0, 5, 10]  # 4 silent replies between uses
    assert all(sounds[i] != "whip" for i in range(12) if i not in played)


def test_cooldown_turns_fall_back_to_the_global_semantic_sound(tmp_path):
    profile = signature_pack(tmp_path)
    explicit = angry(0.95, reaction="emphasis")
    sounds, _ = sounds_over(profile, [explicit] * 3)
    assert sounds == ["whip", "emphasis", "emphasis"]  # signature -> semantic -> none-of-signature


def test_signature_can_sync_with_the_visual_reaction_that_survived(tmp_path):
    make_pack(tmp_path, "whipper", readiness="ready", angry_reaction="flash", performance={
        "director": {"expressiveness": 0.5, "reactionCooldownMs": 60000, "reactionMinIntensity": 0.6},
        "sfx": {"signature": [{"id": "whip", "reactions": ["flash"], "minIntensity": 0.8, "cooldownTurns": 0}]}})
    profile = register(tmp_path, "whipper").get("whipper")
    # Reaction cooldown (60 s, same clock) lets only the first visual flash through, so only it whips.
    sounds, _ = sounds_over(profile, [angry(0.95), angry(0.95)])
    assert sounds == ["whip", None]


def test_intensity_and_trigger_gate_the_signature(tmp_path):
    profile = signature_pack(tmp_path)
    calm = CharacterReply(beats=[Beat(text="Fine.", emotion="calm", intensity=1.0)])
    sounds, state = sounds_over(profile, [angry(0.5), calm, angry(0.9, reaction="emphasis")])
    assert sounds == [None, None, "whip"]
    assert state.signature_last_turn == {"whip": 3}


def test_max_per_reply_is_respected(tmp_path):
    profile = signature_pack(tmp_path)
    two = CharacterReply(beats=[
        Beat(text="Silence.", emotion="angry", intensity=0.95),
        Beat(text="I said, silence!", emotion="calm", intensity=0.6, reaction="emphasis"),
        Beat(text="Again!", emotion="angry", intensity=0.95, reaction="emphasis"),
    ])
    timeline, _ = CharacterDirector().direct(two, profile, DirectorState(), now_ms=0)
    assert [s.sfx for s in timeline.segments].count("whip") == 1


def test_cooldown_is_per_conversation_and_per_character(tmp_path):
    profile = signature_pack(tmp_path)
    first, state_a = sounds_over(profile, [angry()])
    other_conversation, _ = sounds_over(profile, [angry()])  # fresh state: fresh cooldown
    assert first == other_conversation == ["whip"]
    again, _ = sounds_over(profile, [angry()], state_a)
    assert again == [None]
    # The state also carries the turn counter, never a character name.
    assert state_a.turn == 1 and set(state_a.signature_last_turn) == {"whip"}


def test_stateless_callers_can_disable_signatures(tmp_path):
    profile = signature_pack(tmp_path)
    timeline, state = CharacterDirector().direct(angry(), profile, DirectorState(), now_ms=0, signatures=False)
    assert timeline.segments[0].sfx is None and state.signature_last_turn == {}


def test_service_keeps_the_signature_cooldown_per_session_and_character(tmp_path):
    make_pack(tmp_path, "whipper", readiness="ready", performance={
        "director": {"expressiveness": 0.5, "reactionCooldownMs": 0},
        "sfx": {"signature": [WHIP]}})
    make_pack(tmp_path, "quiet", readiness="ready")
    repo = register(tmp_path, "whipper", "quiet")
    service, _ = make_service(repo, {"text": "Silence.", "emotion": "angry", "intensity": 0.95})
    sfx = lambda r: r.performance["segments"][0]["sfx"]  # noqa: E731
    run = lambda c, s: asyncio.run(service.chat(c, "hey", s))  # noqa: E731
    assert [sfx(run("whipper", "one")), sfx(run("whipper", "one")), sfx(run("whipper", "two"))] == ["whip", None, "whip"]
    assert sfx(run("quiet", "one")) is None  # a character without signatures is untouched


# ---- isolation between characters -------------------------------------------------------------


def ready_real_packs():
    repo = CharacterRepository()
    return [repo.get(i) for i in repo.all_ids() if repo.get(i).readiness == "ready"]


def test_each_prompt_contains_only_its_own_personality():
    packs = ready_real_packs()
    assert len(packs) >= 3
    for profile in packs:
        prompt = build_system_prompt(profile, "en")
        assert profile.personality.strip() in prompt
        for other in packs:
            if other.id == profile.id:
                continue
            # No other personality text, not even a whole paragraph of it.
            paragraphs = [p.strip() for p in other.personality.split("\n\n") if len(p.strip()) >= 60]
            assert paragraphs
            assert other.personality.strip() not in prompt
            assert all(p not in prompt for p in paragraphs), f"{other.id} text leaked into {profile.id}"
            # Nor any of its canonical lore (D-099).
            lore_paragraphs = [p.strip() for p in other.lore.split("\n\n") if len(p.strip()) >= 60]
            assert all(p not in prompt for p in lore_paragraphs), f"{other.id} lore leaked into {profile.id}"
            # Another character's id never appears; a display name only if the persona itself mentions it.
            assert other.id not in prompt
            if other.display_name not in profile.personality + profile.lore:
                assert other.display_name not in prompt, f"{other.display_name} appears in {profile.id}'s prompt"


def test_prompt_is_identical_for_the_same_character_regardless_of_other_packs(tmp_path):
    repo = CharacterRepository()
    first = build_system_prompt(repo.get("maya_fey"), "en")
    for other in repo.all_ids():
        repo.get(other)
    assert build_system_prompt(repo.get("maya_fey"), "en") == first


def test_switching_characters_in_one_session_does_not_carry_persona_or_history(tmp_path):
    provider = _Echo()
    gateway = LLMGateway(ProviderConfig(type="fake"))
    gateway.provider = provider
    service = CharacterService(CharacterRepository(), gateway)

    async def go():
        await service.chat("maya_fey", "Maya-only secret: the umbrella.", "same-session")
        await service.chat("mia_fey", "Hello Mia.", "same-session")
        await service.chat("maya_fey", "Back again.", "same-session")

    asyncio.run(go())
    maya_1, mia_1, maya_2 = provider.requests
    repo = CharacterRepository()
    # Mia's request: Mia's persona, and none of Maya's turns (history is keyed by session AND character).
    assert repo.get("mia_fey").personality.strip() in mia_1.system_prompt
    assert repo.get("maya_fey").personality.strip() not in mia_1.system_prompt
    assert [m.content for m in mia_1.messages] == ["Hello Mia."]
    # Returning to Maya resumes only Maya's own conversation, never Mia's lines.
    contents = " ".join(m.content for m in maya_2.messages)
    assert "umbrella" in contents and "Hello Mia." not in contents
    assert repo.get("mia_fey").personality.strip() not in maya_2.system_prompt
    assert maya_1.system_prompt == maya_2.system_prompt


# ---- every registered pack (data quality; new characters are covered automatically) ------------

LANGUAGES = ("en", "fr", "ja", "it", "es")
EVENT_TYPES = ("task_finished", "needs_attention", "tests_passed", "tests_failed", "build_failed",
               "session_started", "reminder_due")


def all_real_profiles():
    repo = CharacterRepository()
    return [repo.get(i) for i in repo.all_ids()]


def test_registered_packs_load_without_warnings_and_complete_packs_are_fully_localised():
    for profile in all_real_profiles():
        assert profile.warnings == [], f"{profile.id}: {profile.warnings}"
        if profile.readiness != "ready":
            continue
        assert set(profile.error_texts) >= {"fr", "ja", "it", "es"}, f"{profile.id}: errorLine translations"
        assert set(profile.names) >= set(LANGUAGES), f"{profile.id}: names"
        for event in EVENT_TYPES:
            assert set(profile.event_lines.get(event, {})) >= set(LANGUAGES), f"{profile.id}: eventLines.{event}"


def test_signature_sounds_have_audio_events_and_are_never_in_event_lines():
    import json
    from app.runtime import paths as runtime_paths

    audio = json.loads((runtime_paths.assets_dir() / "audio" / "audio.json").read_text(encoding="utf-8"))
    director = CharacterDirector()
    from app.events.inbox import EVENT_TYPES as INBOX_EVENTS, Event, event_performance

    manifests = {}
    for path in (runtime_paths.assets_dir() / "characters").glob("*/character.json"):
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifests[manifest.get("id")] = manifest
    for profile in all_real_profiles():
        for sig in profile.sfx.signature:
            if sig.performs:
                # A performed signature sounds through its reaction's effect cues (D-091).
                cues = manifests[profile.id]["reactions"][sig.performs]["effect"]["cues"]
                assert cues and all(cue["event"] in audio["events"] for cue in cues), profile.id
            else:
                assert f"sfx_{sig.id}" in audio["events"], f"{profile.id}: no audio event for {sig.id}"
            assert sig.cooldown_turns >= 3 and sig.max_per_reply == 1  # signatures stay rare
        for number, event_type in enumerate(sorted(INBOX_EVENTS), start=1):
            performance = event_performance(profile, Event(number, event_type, "test", 0.0), "en", director)
            signature_ids = {s.id for s in profile.sfx.signature}
            performed = {s.performs for s in profile.sfx.signature if s.performs}
            assert not [s for s in performance["performance"]["segments"] if s["sfx"] in signature_ids]
            assert not [s for s in performance["performance"]["segments"] if s["reaction"] in performed]


def test_whip_character_does_not_whip_every_strong_angry_turn():
    repo = CharacterRepository()
    if "franziska_von_karma" not in repo.all_ids():
        pytest.skip("franziska_von_karma is not registered")
    franziska = repo.get("franziska_von_karma")
    assert any(s.id == "whip" for s in franziska.sfx.signature)
    strong = CharacterReply(beats=[Beat(text="Silence!", emotion="angry", intensity=0.95, reaction="emphasis")])
    director, state, outcomes = CharacterDirector(), DirectorState(), []
    for _ in range(12):
        timeline, state = director.direct(strong, franziska, state, now_ms=0)
        segment = timeline.segments[0]
        # The whip is performed as the whip_crack reaction (its effect cues carry the sounds).
        outcomes.append("whip" if segment.reaction == "whip_crack" else segment.sfx)
        assert segment.reaction != "whip_crack" or segment.sfx is None
    cooldown = franziska.sfx.signature[0].cooldown_turns
    assert cooldown >= 3 and outcomes.count("whip") <= -(-12 // (cooldown + 1))  # spaced, never every turn
    positions = [i for i, s in enumerate(outcomes) if s == "whip"]
    assert all(b - a > franziska.sfx.signature[0].cooldown_turns for a, b in zip(positions, positions[1:]))
    assert outcomes[0] == "whip"  # the first genuinely strong beat is allowed to land
    # Cooling-down turns still get ordinary feedback (explicit emphasis), not a second whip.
    assert set(outcomes) <= {"whip", "emphasis"}
