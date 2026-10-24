"""Event inbox (D-067): buffer, rate limit, per-character lines, API locality and cursor semantics."""

import pytest
from fastapi.testclient import TestClient

from app.characters.repository import CharacterRepository
from app.events.inbox import BUFFER_SIZE, EVENT_TYPES, RATE_LIMIT_PER_MINUTE, EventInbox, EventRejected, event_performance
from app.llm.config import ProviderConfig
from app.main import create_app


def test_inbox_buffer_ids_and_rate_limit():
    now = [1000.0]
    inbox = EventInbox(clock=lambda: now[0])
    first = inbox.push("task_finished", "claude-code", project="x" * 200)
    assert first.id == 1 and len(first.project) == 80
    assert [e.id for e in inbox.after(0)] == [1] and inbox.after(1) == []
    with pytest.raises(EventRejected):
        inbox.push("rm_rf", "claude-code")
    for _ in range(RATE_LIMIT_PER_MINUTE - 1):
        inbox.push("tests_passed", "test")
    with pytest.raises(EventRejected):
        inbox.push("tests_passed", "test")
    now[0] += 61
    inbox.push("tests_passed", "test")
    assert len(inbox.after(0)) <= BUFFER_SIZE


def test_every_character_has_a_line_for_every_event_in_every_language():
    repo = CharacterRepository()
    inbox = EventInbox()
    for event_type in sorted(EVENT_TYPES):
        event = inbox.push(event_type, "test", text="Call the lab")
        for cid in repo.ids():
            for language in ("en", "fr", "ja", "it", "es"):
                performed = event_performance(repo.get(cid), event, language)
                text = performed["performance"]["segments"][0]["text"]
                assert text and "{" not in text, (cid, event_type, language)
                if event_type == "reminder_due":
                    assert "Call the lab" in text
                    assert performed["attention"] is True


def test_exclamations_follow_character_data():
    repo = CharacterRepository()
    event = EventInbox().push("tests_failed", "claude-code")
    mia = event_performance(repo.get("mia_fey"), event, "ja")
    assert mia["exclamation"] == "objection"
    assert mia["performance"]["segments"][0]["text"].startswith("異議あり！")
    gumshoe = event_performance(repo.get("dick_gumshoe"), event, "en")
    assert gumshoe["exclamation"] is None and gumshoe["performance"]["segments"][0]["reaction"] == "head_scratch"


@pytest.fixture
def client():
    return TestClient(create_app(ProviderConfig(type="fake")), base_url="http://localhost", client=("127.0.0.1", 5000))


def test_api_cursor_never_replays_and_performs_per_character(client):
    assert client.post("/api/events", json={"source": "claude-code", "type": "task_finished", "project": "demo"}).status_code == 200
    start = client.get("/api/events", params={"character": "maya_fey", "after": 0}).json()
    assert start["events"] == [] and start["cursor"] == 1
    client.post("/api/events", json={"source": "claude-code", "type": "build_failed"})
    body = client.get("/api/events", params={"character": "mia_fey", "after": start["cursor"], "language": "fr"}).json()
    assert body["cursor"] == 2 and len(body["events"]) == 1
    event = body["events"][0]
    assert event["type"] == "build_failed" and event["exclamation"] == "objection"
    assert event["performance"]["segments"][0]["text"].startswith("Objection !")
    assert client.get("/api/events", params={"character": "mia_fey", "after": 2}).json()["events"] == []


def test_api_rejects_unknown_types_remote_callers_and_cross_site(client):
    assert client.post("/api/events", json={"type": "delete_everything"}).status_code == 422
    remote = TestClient(create_app(ProviderConfig(type="fake")), base_url="http://localhost", client=("203.0.113.9", 5000))
    assert remote.post("/api/events", json={"type": "task_finished"}).status_code == 403
    cross = client.post("/api/events", json={"type": "task_finished"}, headers={"Origin": "https://evil.example", "Sec-Fetch-Site": "cross-site"})
    assert cross.status_code == 403
    assert client.get("/api/events", params={"character": "nobody", "after": 1}).status_code == 404
