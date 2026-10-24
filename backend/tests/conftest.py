import pytest
from unittest.mock import Mock
from app.configuration.credentials import KeyringCredentialStore


@pytest.fixture(autouse=True)
def isolated_profile_directory(tmp_path, monkeypatch):
    """Normal tests never touch user profiles or the real OS credential store."""
    monkeypatch.setenv("COURTROOM_CONFIG_DIR", str(tmp_path / "configuration"))
    backend = Mock()
    backend.get_password.return_value = None
    monkeypatch.setattr("app.main.KeyringCredentialStore", lambda: KeyringCredentialStore(backend))

from app.characters.repository import (
    CharacterProfile,
    CharacterRepository,
    DirectorSettings,
    EmotionBinding,
    Gesture,
    IntensityVariant,
)


@pytest.fixture(scope="session")
def maya() -> CharacterProfile:
    """The real Maya pack from frontend/public/assets."""
    return CharacterRepository().get("maya_fey")


@pytest.fixture
def mock_character() -> CharacterProfile:
    """A tiny, deliberately different character proving the director is character-independent."""
    return CharacterProfile(
        id="robot",
        display_name="Robot",
        default_emotion="calm",
        fallback_emotion="calm",
        emotions={
            "calm": EmotionBinding("idle_pose"),
            "glad": EmotionBinding("grin_pose"),
            "alarmed": EmotionBinding("idle_pose", reaction="sparks"),
        },
        animations=frozenset({"idle_pose", "grin_pose", "wave_pose", "beam_pose"}),
        reactions=frozenset({"sparks"}),
        gestures={"wave": Gesture("wave_pose", ("glad", "calm"))},
        intensity_variants={"glad": [IntensityVariant(0.5, "grin_pose"), IntensityVariant(1.0, "beam_pose")]},
        emotion_aliases={"happy": "glad"},
        reaction_aliases={"shock": "sparks"},
        director=DirectorSettings(
            expressiveness=0.2,  # stoic: long pose holds, high reaction threshold
            max_beats_per_reply=2,
            max_reactions_per_reply=1,
            reaction_cooldown_ms=10000,
            reaction_min_intensity=0.7,
            min_pose_hold_ms=3000,
            strong_change_intensity=0.9,
            ms_per_char=40,
        ),
        error_text="ERROR. PLEASE REPEAT.",
        error_emotion="alarmed",
    )
