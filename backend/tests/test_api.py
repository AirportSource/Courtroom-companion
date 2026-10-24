"""API integration: HTTP -> CharacterService -> FakeProvider -> repair -> Director -> timeline."""

import pytest
from fastapi.testclient import TestClient

from app.llm.config import ProviderConfig
from app.main import create_app


@pytest.fixture
def client():
    return TestClient(create_app(ProviderConfig(type="fake")))


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["provider"]["type"] == "fake"
    assert "maya_fey" in body["characters"]


def test_capabilities(client):
    caps = client.get("/api/characters/maya_fey/capabilities").json()
    assert "surprised" in caps["emotions"] and caps["reactions"] == ["shocked"]
    assert client.get("/api/characters/nobody/capabilities").status_code == 404


def test_chat_returns_reply_and_performance(client):
    body = client.post("/api/chat", json={"character": "maya_fey", "message": "Guess what happened!", "sessionId": "t1"}).json()
    assert len(body["reply"]["beats"]) == 3
    segments = body["performance"]["segments"]
    assert [s["emotion"] for s in segments] == ["thinking", "surprised", "happy"]
    assert [s["reaction"] for s in segments] == [None, "shocked", None]
    assert body["performance"]["settle"] == {"emotion": "happy", "animation": "clasped_hands_happy"}


def test_explicit_fake_reaction_sound_survives_visual_cooldown(client):
    first = client.post("/api/chat", json={"character": "maya_fey", "message": "guess what", "sessionId": "t2"}).json()
    second = client.post("/api/chat", json={"character": "maya_fey", "message": "guess what", "sessionId": "t2"}).json()
    assert any(s["reaction"] for s in first["performance"]["segments"])
    assert not any(s["reaction"] for s in second["performance"]["segments"])  # visual cooldown remains
    assert next(s["sfx"] for s in second["performance"]["segments"] if s["sfx"]) == "shock"


def test_messy_reply_degrades_safely(client):
    body = client.post("/api/chat", json={"character": "maya_fey", "message": "#messy"}).json()
    seg = body["performance"]["segments"]
    assert seg and all(s["text"] for s in seg)
    assert all(s["reaction"] in (None, "shocked") for s in seg)
    assert body["performance"]["notes"]


@pytest.mark.parametrize("trigger", ["#error", "#malformed", "#empty"])
def test_provider_failures_still_perform(client, trigger):
    body = client.post("/api/chat", json={"character": "maya_fey", "message": trigger}).json()
    assert body["performance"]["segments"][0]["text"]
    assert body["warnings"]


def test_request_validation(client):
    assert client.post("/api/chat", json={"character": "maya_fey", "message": ""}).status_code == 422
    assert client.post("/api/chat", json={"character": "../etc", "message": "hi"}).status_code == 422
    assert client.post("/api/chat", json={"character": "nobody", "message": "hi"}).status_code == 404
