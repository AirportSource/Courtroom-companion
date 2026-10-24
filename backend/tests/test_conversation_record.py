"""Conversation Record: persistent user archive, separate from LLM context."""

import asyncio
import json
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

from app.conversation_record import ConversationRecordStore
from app.conversation_record.store import MAX_ENTRIES
from app.llm.base import ProviderError, RawCompletion
from app.llm.config import ProviderConfig
from app.main import create_app
from app.artifacts.store import ArtifactStore
from tests.test_artifact_api import Stub, body, reply

RECORD = "/api/conversation-record"


def make_app(tmp_path, provider=None, directory=None):
    provider = provider or Stub(payload={"beats": [{"text": "Hello there!", "emotion": "happy", "intensity": .4}],
        "settleEmotion": "happy"})
    app = create_app(ProviderConfig(), provider_registry={"fake": lambda _: provider},
        artifact_store=ArtifactStore(tmp_path / "outputs"),
        conversation_record=ConversationRecordStore(directory or tmp_path / "record"))
    return app, provider


def local(app):
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))


def entries(client):
    return client.get(RECORD).json()["entries"]


def test_one_turn_one_record_with_visible_text_only(tmp_path):
    app, provider = make_app(tmp_path)
    with local(app) as client:
        assert client.post("/api/chat", json=body("Hi Maya")).status_code == 200
        [entry] = entries(client)
        assert entry["userText"] == "Hi Maya" and entry["assistantText"] == "Hello there!"
        assert entry["characterId"] == "maya_fey" and entry["artifactIds"] == []
        assert set(entry) == {"id", "characterId", "createdAt", "userText", "assistantText", "artifactIds"}
        assert client.get(f"{RECORD}/{entry['id']}").json() == entry
        assert client.get(RECORD).headers["cache-control"] == "no-store"


def test_artifact_turn_links_artifact_id_only_and_survives_artifact_delete(tmp_path):
    app, _ = make_app(tmp_path, Stub())
    with local(app) as client:
        data = client.post("/api/chat", json=body("#artifact-py")).json()
        artifact_id = data["artifacts"][0]["id"]
        [entry] = entries(client)
        assert entry["artifactIds"] == [artifact_id]
        assert "Hello from Maya" not in json.dumps(entry)  # no file content
        assert client.delete(f"/api/artifacts/{artifact_id}").status_code == 204
        assert entries(client) == [entry]


def test_ordering_newest_first_and_delete(tmp_path):
    app, _ = make_app(tmp_path)
    with local(app) as client:
        for text in ("one", "two", "three"):
            client.post("/api/chat", json=body(text))
        assert [e["userText"] for e in entries(client)] == ["three", "two", "one"]
        middle = entries(client)[1]["id"]
        assert client.delete(f"{RECORD}/{middle}").status_code == 204
        assert client.get(f"{RECORD}/{middle}").status_code == 404
        assert client.delete(f"{RECORD}/{middle}").status_code == 404
        assert client.get(f"{RECORD}/not-an-id").status_code == 404
        assert [e["userText"] for e in entries(client)] == ["three", "one"]
        assert client.request("DELETE", RECORD, json={"confirm": False}).status_code == 400
        assert len(entries(client)) == 2
        assert client.request("DELETE", RECORD, json={"confirm": True}).status_code == 204
        assert entries(client) == []


def test_persistence_and_provider_context_unaffected(tmp_path):
    first, _ = make_app(tmp_path)
    with local(first) as client:
        client.post("/api/chat", json=body("remember me"))
    second, provider = make_app(tmp_path)  # new app instance, same archive directory
    with local(second) as client:
        assert [e["userText"] for e in entries(client)] == ["remember me"]
        client.post("/api/chat", json=body("fresh"))
        messages = provider.requests[-1].messages
        assert [m.content for m in messages] == ["fresh"]  # archive never reaches the provider
        assert "remember me" not in json.dumps([m.model_dump() for m in messages])
        assert len(entries(client)) == 2


def test_unicode_round_trip(tmp_path):
    text = "Bonjour, ça va très bien ? こんにちは、元気ですか 🙂"
    provider = Stub(payload={"beats": [{"text": "Très bien, merci ! 元気です。", "emotion": "happy", "intensity": .4}]})
    app, _ = make_app(tmp_path, provider)
    with local(app) as client:
        client.post("/api/chat", json=body(text))
    again, _ = make_app(tmp_path)
    with local(again) as client:
        [entry] = entries(client)
        assert entry["userText"] == text and entry["assistantText"] == "Très bien, merci ! 元気です。"


def test_provider_failure_and_validation_failure_create_nothing(tmp_path):
    app, _ = make_app(tmp_path, Stub(error=True))
    with local(app) as client:
        assert client.post("/api/chat", json=body("hello")).status_code == 200
        assert client.post("/api/chat", json={"character": "maya_fey", "message": ""}).status_code == 422
        assert entries(client) == []
    bad, _ = make_app(tmp_path, Stub(payload={"beats": []}))
    with local(bad) as client:
        client.post("/api/chat", json=body("hello"))
        assert entries(client) == []


def test_duplicate_request_id_and_legacy_calls(tmp_path):
    app, provider = make_app(tmp_path)
    with local(app) as client:
        request = body("same")
        assert client.post("/api/chat", json=request).status_code == 200
        assert client.post("/api/chat", json=request).status_code == 200  # replay
        assert len(entries(client)) == 1
        legacy = {"character": "maya_fey", "message": "legacy"}
        client.post("/api/chat", json=legacy)
        client.post("/api/chat", json=legacy)
        assert len(entries(client)) == 3
    # Store-level receipt: same request id is idempotent even across instances.
    store = ConversationRecordStore(tmp_path / "direct")
    a = store.add("maya_fey", "u", "a", [], "r" * 32)
    assert ConversationRecordStore(tmp_path / "direct").add("maya_fey", "u", "a", [], "r" * 32)["id"] == a["id"]
    assert "r" * 32 not in (tmp_path / "direct" / "records.json").read_text(encoding="utf-8")


def test_coalesced_concurrent_requests_write_one_record(tmp_path):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        class Slow(Stub):
            async def generate(self, request):
                self.calls += 1
                started.set()
                await release.wait()
                return RawCompletion(json.dumps(reply()))

        app, provider = make_app(tmp_path, Slow())
        request = body("#artifact-py")
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1") as client:
            first = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.wait_for(started.wait(), 2)
            second = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.sleep(0.05)
            release.set()
            assert (await first).status_code == 200 and (await second).status_code == 200
            assert provider.calls == 1
            assert len((await client.get(RECORD)).json()["entries"]) == 1
    asyncio.run(scenario())


def test_cancelled_turn_creates_none_and_retry_stays_cancelled(tmp_path):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()

        class Slow(Stub):
            async def generate(self, request):
                started.set()
                await release.wait()
                return RawCompletion(json.dumps(reply()))

        app, _ = make_app(tmp_path, Slow())
        request = body()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1") as client:
            pending = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.wait_for(started.wait(), 2)
            await client.delete("/api/chat/turns/" + request["requestId"])
            assert (await pending).status_code == 409
            assert (await client.post("/api/chat", json=request)).status_code == 409
            assert (await client.get(RECORD)).json() == {"entries": []}
            # A new request ID after cancellation is a fresh turn and is recorded.
            release.set()
            assert (await client.post("/api/chat", json=body("retry"))).status_code == 200
            assert len((await client.get(RECORD)).json()["entries"]) == 1
    asyncio.run(scenario())


def test_no_hidden_reasoning_prompt_secrets_or_paths(tmp_path):
    payload = {"beats": [{"text": "Visible.", "emotion": "happy", "intensity": .4}],
        "thinking": "SECRET-REASONING", "systemPrompt": "SECRET-PROMPT"}
    app, _ = make_app(tmp_path, Stub(payload=payload))
    with local(app) as client:
        client.post("/api/chat", json=body("hi"))
        listing = client.get(RECORD).text
        stored = (tmp_path / "record" / "records.json").read_text(encoding="utf-8")
        for text in (listing, stored):
            assert "SECRET" not in text and "thinking" not in text.lower()
        assert str(tmp_path) not in listing and "records.json" not in listing
        assert "receipt" not in listing and "requestId" not in listing


def test_corrupt_file_is_preserved_and_store_starts_empty(tmp_path):
    directory = tmp_path / "record"
    directory.mkdir()
    (directory / "records.json").write_text("{not json", encoding="utf-8")
    store = ConversationRecordStore(directory)
    assert store.recovered_corrupt and store.list() == []
    [preserved] = list(directory.glob("records.corrupt-*.json"))
    assert preserved.read_text(encoding="utf-8") == "{not json"
    store.add("maya_fey", "u", "a")
    assert len(ConversationRecordStore(directory).list()) == 1
    (directory / "records.json").write_text(json.dumps({"version": 1, "entries": [{"id": "x"}]}), encoding="utf-8")
    assert ConversationRecordStore(directory).list() == []


def test_entry_cap_prunes_oldest(tmp_path, monkeypatch):
    monkeypatch.setattr("app.conversation_record.store.MAX_ENTRIES", 3)
    store = ConversationRecordStore(tmp_path / "cap")
    for index in range(5):
        store.add("maya_fey", f"m{index}", "a")
    assert [e["userText"] for e in store.list()] == ["m4", "m3", "m2"]
    assert MAX_ENTRIES == 5000


def test_local_guard_rejects_remote_and_cross_origin(tmp_path):
    app, _ = make_app(tmp_path)
    with local(app) as client:
        client.post("/api/chat", json=body("hi"))
        entry_id = entries(client)[0]["id"]
        assert client.get(RECORD, headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.delete(f"{RECORD}/{entry_id}", headers={"Origin": "https://evil.example"}).status_code == 403
    remote = TestClient(app, base_url="http://example.com", client=("203.0.113.9", 50000))
    assert remote.get(RECORD).status_code == 403
    assert remote.delete(f"{RECORD}/{entry_id}").status_code == 403
