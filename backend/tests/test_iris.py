"""Iris pack (D-098): data, presentation, quiet-but-alive sounds, isolation; Dahlia not playable."""

import asyncio
import json
import struct

import pytest

from app.characters.repository import ALLOW_PARTIAL_ENV, CharacterRepository
from app.characters.service import CharacterService
from app.director.director import CharacterDirector, DirectorState
from app.llm.config import ProviderConfig
from app.llm.gateway import LLMGateway
from app.llm.schemas import Beat, CharacterReply
from app.runtime import paths as runtime_paths

from .test_character_platform import _Echo

ASSETS = runtime_paths.assets_dir()
PACK = ASSETS / "characters" / "iris"


@pytest.fixture(scope="module")
def manifest():
    return json.loads((PACK / "character.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def iris():
    return CharacterRepository().get("iris")


def test_iris_is_registered_and_loads_cleanly(iris, manifest):
    index = json.loads((ASSETS / "characters" / "index.json").read_text(encoding="utf-8"))["characters"]
    assert index["iris"] == "iris/character.json"
    assert iris.warnings == []
    assert iris.personality.strip().startswith("# Iris")
    assert {manifest["defaultEmotion"], manifest["fallbackEmotion"]} <= set(manifest["emotions"])
    for emotion, binding in manifest["emotions"].items():
        assert binding["animation"] in manifest["animations"], emotion


def test_conversation_presentation_is_front_facing_and_isolated(manifest):
    assert manifest["defaultPresentation"] == "conversation"
    group = manifest["presentationGroups"]["conversation"]
    assert group["inheritReactions"] is False
    assert group["animations"] == manifest["animations"] and group["emotions"] == manifest["emotions"]
    for animation in group["animations"].values():
        for clip in (animation["idle"], animation["talking"]):
            for frame in clip["frames"]:
                assert (PACK / frame).is_file() and frame.startswith("sprites/")


def _png_size(path):
    with open(path, "rb") as handle:
        handle.read(16)
        return struct.unpack(">II", handle.read(8))


def test_portrait_preview_and_sound_pools_exist(manifest):
    assert _png_size(PACK / manifest["courtRecordPortrait"]["src"]) == (64, 64)
    width, height = _png_size(PACK / manifest["selectionPreview"])
    assert width == height
    sounds = json.loads((ASSETS / "audio" / "audio.json").read_text(encoding="utf-8"))["sounds"]
    for pool in manifest["semanticSounds"].values():
        assert all(sound in sounds for sound in pool)
    source = json.loads((PACK / "source.json").read_text(encoding="utf-8"))
    assert "3DS" not in source["sourcePlatform"]
    assert source["portrait"]["nativePixelScale"] is True
    assert set(source["activePoses"]) == {"normal", "blush", "crying", "serious", "surprised", "thinking"}
    assert set(source["sourceOnlyPoses"]) == {"hood", "hood-oh"}
    assert all("sprites_iris" in item["path"] for pose in source["activePoses"].values()
               for item in pose["sources"].values())


def test_runtime_frames_are_exact_native_pixel_crops(manifest):
    source = json.loads((PACK / "source.json").read_text(encoding="utf-8"))
    assert not any("3DS" in frame for animation in manifest["animations"].values()
                   for clip_name in ("idle", "talking") for frame in animation[clip_name]["frames"])
    for pose, animation in manifest["animations"].items():
        metrics = source["activePoses"][pose]["metrics"]
        assert [animation["canvas"]["width"], animation["canvas"]["height"]] == metrics["canvas"]
        for clip_name in ("idle", "talking"):
            clip = animation[clip_name]
            assert len(clip["frames"]) == len(clip["offsets"]) == len(clip["frameDurations"])
            assert all(offset == [0, 0] for offset in clip["offsets"])
            for frame in clip["frames"]:
                assert (PACK / frame).is_file()


def test_rejected_dahlia_pack_is_not_playable_but_her_soundtrack_data_remains():
    index = json.loads((ASSETS / "characters" / "index.json").read_text(encoding="utf-8"))["characters"]
    assert "dahlia_hawthorne" not in index and not (ASSETS / "characters" / "dahlia").exists()
    assert "dahlia_hawthorne" not in CharacterRepository().all_ids()
    # The theme predates the rejected pack and is kept on purpose.
    soundtrack = json.loads((ASSETS / "music" / "soundtrack.json").read_text(encoding="utf-8"))
    assert "dahlia_hawthorne_the_visage_of_what_once_was" in soundtrack["tracks"]


def run(profile, beats):
    director, state, out = CharacterDirector(), DirectorState(), []
    for emotion, intensity, reaction in beats:
        reply = CharacterReply(beats=[Beat(text="...", emotion=emotion, intensity=intensity, reaction=reaction)])
        timeline, state = director.direct(reply, profile, state, now_ms=0)
        out.append(timeline.segments[0])
    return out


# A varied conversation with Iris's typical (gentle) intensities.
SESSION = [
    ("polite", 0.45, None), ("happy", 0.6, None), ("thinking", 0.4, None), ("surprised", 0.65, None),
    ("grateful", 0.7, None), ("sad", 0.5, None), ("anxious", 0.8, None), ("embarrassed", 0.6, None),
    ("happy", 0.75, None), ("thinking", 0.4, "realization"), ("polite", 0.4, None), ("neutral", 0.35, None),
]


def test_iris_sounds_are_alive_but_quieter_than_pearl(iris):
    pearl = CharacterRepository().get("pearl_fey")
    iris_sounds = [s.sfx for s in run(iris, SESSION) if s.sfx]
    pearl_sounds = [s.sfx for s in run(pearl, SESSION) if s.sfx]
    assert 2 <= len(iris_sounds) <= 5, iris_sounds
    assert len(iris_sounds) < len(pearl_sounds), (iris_sounds, pearl_sounds)
    assert "realization" in iris_sounds  # an explicit, meaningful realization is never lost


def test_every_beat_resolves_to_a_real_pose(iris, manifest):
    for segment in run(iris, SESSION):
        assert segment.animation in manifest["animations"]
        assert segment.reaction is None  # Iris has no one-shot reactions


def test_maya_iris_maya_keeps_persona_and_history_apart(monkeypatch):
    monkeypatch.setenv(ALLOW_PARTIAL_ENV, "1")  # Iris may still be partial while qualifying
    provider = _Echo()
    gateway = LLMGateway(ProviderConfig(type="fake"))
    gateway.provider = provider
    service = CharacterService(CharacterRepository(), gateway)

    async def go():
        await service.chat("maya_fey", "Maya-only secret: the burger stand.", "same-session")
        await service.chat("iris", "Hello Iris.", "same-session")
        await service.chat("maya_fey", "Back again.", "same-session")

    asyncio.run(go())
    maya_1, iris_1, maya_2 = provider.requests
    repo = CharacterRepository()
    assert repo.get("iris").personality.strip() in iris_1.system_prompt
    assert repo.get("maya_fey").personality.strip() not in iris_1.system_prompt
    assert [m.content for m in iris_1.messages] == ["Hello Iris."]
    contents = " ".join(m.content for m in maya_2.messages)
    assert "burger stand" in contents and "Hello Iris." not in contents
    assert repo.get("iris").personality.strip() not in maya_2.system_prompt
    assert maya_1.system_prompt == maya_2.system_prompt
