"""Interface languages (D-066): reply language in the prompt, localized names, Fake texts, error lines."""

import base64

import pytest
from fastapi.testclient import TestClient

from app.characters.prompt import build_system_prompt
from app.characters.repository import CharacterRepository
from app.director.director import CharacterDirector
from app.llm.config import ProviderConfig
from app.llm.providers.fake import PATTERNS
from app.llm.providers.fake_i18n import TRANSLATIONS
from app.main import create_app

LANGUAGES = ["en", "fr", "ja", "it", "es"]


@pytest.fixture
def client():
    return TestClient(create_app(ProviderConfig(type="fake")))


def test_reply_follows_the_users_language_and_interface_is_only_the_fallback():
    # D-073: the interface language is a display choice; it must not force the reply language.
    repo = CharacterRepository()
    gumshoe = repo.get("dick_gumshoe")
    french = build_system_prompt(gumshoe, "fr")
    assert "Always reply in" not in french and "whatever language the user writes in" not in french
    assert "language of the user's latest message" in french
    assert "reply in French, the user's interface language" in french
    assert "French: Dick Tektiv" in french and "French: Dick Tektiv" in build_system_prompt(gumshoe, "ja")
    assert "綾里真宵" in build_system_prompt(repo.get("maya_fey"), "fr")


def test_every_character_has_names_and_error_lines_in_every_language():
    repo = CharacterRepository()
    for cid in repo.ids():
        profile = repo.get(cid)
        for language in LANGUAGES:
            assert profile.name_for(language)
            assert profile.error_text_for(language)
        assert profile.error_text_for("ja") != profile.error_text_for("en")
    timeline, _ = CharacterDirector().direct(None, repo.get("mia_fey"), language="it")
    assert timeline.to_json()["segments"][0]["text"].startswith("Scusa, ho perso il filo")


def test_fake_translations_match_the_english_beats():
    for language, patterns in TRANSLATIONS.items():
        for name, texts in patterns.items():
            if name == "evidence":
                assert len(texts) == 2 and all("{name}" in text for text in texts[:1]), language
                continue
            assert len(texts) == len(PATTERNS[name]["beats"]), f"{language}.{name}"
            assert all(0 < len(text) <= 600 for text in texts), f"{language}.{name}"


@pytest.mark.parametrize("language,expected", [
    ("en", "Oh, hey!"), ("fr", "Oh, salut !"), ("ja", "あっ、こんにちは"), ("it", "Oh, ciao!"), ("es", "¡Oh, hola!"),
])
def test_api_offline_reply_in_the_requested_language(client, language, expected):
    body = client.post("/api/chat", json={"character": "maya_fey", "message": "hello", "sessionId": f"l-{language}",
                                          "language": language}).json()
    assert body["performance"]["segments"][0]["text"].startswith(expected)


def test_local_keywords_and_localized_evidence(client):
    thanks = client.post("/api/chat", json={"character": "mia_fey", "message": "merci beaucoup", "sessionId": "kw",
                                            "language": "fr"}).json()
    assert thanks["performance"]["segments"][0]["text"].startswith("Ooh, merci")
    evidence = client.post("/api/chat", json={"character": "dick_gumshoe", "message": "", "sessionId": "ev", "language": "ja",
                                              "evidence": {"name": "memo.txt", "data": base64.b64encode(b"note").decode()}}).json()
    assert evidence["performance"]["segments"][0]["text"] == "これが「memo.txt」…じっくり見てみるね。"


def test_unknown_language_is_rejected(client):
    response = client.post("/api/chat", json={"character": "maya_fey", "message": "hi", "language": "de"})
    assert response.status_code == 422
