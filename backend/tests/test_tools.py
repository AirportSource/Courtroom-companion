"""Character tools (D-067): reminders, authorized folders, web search, the two-phase loop and the API."""

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.characters.repository import CharacterRepository
from app.characters.service import CharacterService
from app.configuration.credentials import KeyringCredentialStore
from app.llm.config import ProviderConfig
from app.llm.gateway import LLMGateway
from app.main import create_app
from app.tools.folders import FolderError, FolderStore, list_folder, read_file
from app.tools.registry import ToolContext, available_tools, parse_tool_request, run_tool, tool_request_schema
from app.tools.reminders import ReminderError, ReminderStore, parse_when
from app.tools.web_search import WebSearchConfig, WebSearchError, credential_ref, format_results, search

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)


class MockKeyring:
    def __init__(self):
        self.values = {}

    def get_password(self, service, ref):
        return self.values.get((service, ref))

    def set_password(self, service, ref, value):
        self.values[service, ref] = value

    def delete_password(self, service, ref):
        self.values.pop((service, ref), None)


@pytest.fixture
def context(tmp_path):
    clock = [NOW]
    ctx = ToolContext(ReminderStore(tmp_path / "reminders.json", clock=lambda: clock[0]), FolderStore(tmp_path / "folders.json"),
                      WebSearchConfig(tmp_path / "tools.json"), KeyringCredentialStore(MockKeyring()), clock=lambda: clock[0])
    ctx.clock_ref = clock
    return ctx


# --- reminders ---------------------------------------------------------------------------------

def test_reminders_create_list_cancel_and_deliver(context):
    store = context.reminders
    reminder = store.create(NOW + timedelta(minutes=30), "  Call   the lab  ", "mia_fey")
    assert reminder["text"] == "Call the lab" and len(store.pending()) == 1
    with pytest.raises(ReminderError):
        store.create(NOW - timedelta(minutes=1), "late")
    with pytest.raises(ReminderError):
        store.create(NOW + timedelta(days=400), "too far")
    with pytest.raises(ReminderError):
        store.create(NOW + timedelta(minutes=1), "   ")
    assert store.pop_due() == []
    context.clock_ref[0] = NOW + timedelta(minutes=31)
    assert [r["text"] for r in store.pop_due()] == ["Call the lab"] and store.pending() == []
    other = store.create(NOW + timedelta(hours=2), "Other")
    assert store.cancel(other["id"]) and not store.cancel("nope")


def test_parse_when():
    assert parse_when({"in_minutes": 15}, NOW) == NOW + timedelta(minutes=15)
    assert parse_when({"when": "2026-10-25T15:00+02:00"}, NOW) == datetime(2026, 10, 25, 13, 0, tzinfo=timezone.utc)
    assert parse_when({"when": "2026-10-25T15:00"}, NOW).tzinfo is not None  # naive = local time
    for bad in ({}, {"when": "tomorrow"}, {"in_minutes": -5}, {"in_minutes": True}):
        with pytest.raises(ReminderError):
            parse_when(bad, NOW)


# --- folders -----------------------------------------------------------------------------------

def test_folders_stay_inside_the_allow_list(context, tmp_path):
    root = tmp_path / "case files"
    (root / "notes").mkdir(parents=True)
    (root / "notes" / "alibi.txt").write_text("I was home all night.", encoding="utf-8")
    (root / "photo.bin").write_bytes(b"\x00\x01\x02" * 50)
    (tmp_path / "secret.txt").write_text("outside", encoding="utf-8")
    folders = context.folders
    added = folders.add(str(root))
    assert added["name"] == "case files"
    with pytest.raises(FolderError):
        folders.add(str(root))  # duplicate
    with pytest.raises(FolderError):
        folders.add(str(tmp_path / "missing"))
    with pytest.raises(FolderError):
        folders.add(os.path.abspath(os.sep))  # a whole drive
    listing = list_folder(folders, "case files")
    assert "[dir]  notes/" in listing and "photo.bin" in listing
    assert "I was home all night." in read_file(folders, added["id"], "notes/alibi.txt")
    for escape in ("../secret.txt", "notes/../../secret.txt", str(tmp_path / "secret.txt")):
        with pytest.raises(FolderError):
            read_file(folders, "case files", escape)
    with pytest.raises(FolderError):
        read_file(folders, "case files", "photo.bin")  # not text
    with pytest.raises(FolderError):
        list_folder(folders, "unknown")
    assert folders.remove(added["id"]) and folders.all() == []


# --- web search --------------------------------------------------------------------------------

def test_web_search_providers_and_errors():
    seen = {}

    def brave(request):
        seen["brave"] = request
        return httpx.Response(200, json={"web": {"results": [
            {"title": "Phoenix Wright", "url": "https://example.test/pw", "description": "Defense attorney " * 50},
            {"title": "bad", "url": "javascript:alert(1)", "description": "x"},
        ]}})

    results = asyncio.run(search("brave", "k1", "Phoenix Wright", httpx.MockTransport(brave)))
    assert seen["brave"].headers["X-Subscription-Token"] == "k1" and seen["brave"].url.params["q"] == "Phoenix Wright"
    assert [r["url"] for r in results] == ["https://example.test/pw"] and len(results[0]["snippet"]) <= 400
    tavily = httpx.MockTransport(lambda request: httpx.Response(200, json={"results": [
        {"title": "Mia Fey", "url": "https://example.test/mia", "content": "Mentor"}]}))
    assert asyncio.run(search("tavily", "k2", "Mia", tavily))[0]["title"] == "Mia Fey"
    assert "no results" in format_results("q", [])
    for status in (401, 429, 500):
        with pytest.raises(WebSearchError):
            asyncio.run(search("brave", "k", "q", httpx.MockTransport(lambda request, s=status: httpx.Response(s))))
    with pytest.raises(WebSearchError):
        asyncio.run(search("brave", "k", "   "))


# --- registry and loop -------------------------------------------------------------------------

def test_availability_follows_prerequisites_and_character_groups(context, tmp_path):
    assert available_tools(None) == []
    assert available_tools(context) == ["reminder_create", "reminder_list", "reminder_cancel"]
    (tmp_path / "docs").mkdir()
    context.folders.add(str(tmp_path / "docs"))
    context.web.set_provider("brave")
    context.credentials.set(credential_ref("brave"), SecretStr("key"))
    assert set(available_tools(context)) == {"reminder_create", "reminder_list", "reminder_cancel", "folder_list", "file_read", "web_search"}
    assert available_tools(context, ["folders"]) == ["folder_list", "file_read"]
    schema = tool_request_schema(["web_search"])
    assert schema["anyOf"][1]["properties"]["tool"]["enum"] == ["web_search"]
    assert parse_tool_request({"toolRequest": {"tool": "web_search", "arguments": {"query": "x", "evil": 1}}}, ["web_search"]) == ("web_search", {"query": "x"})
    assert parse_tool_request({"toolRequest": {"tool": "rm", "arguments": {}}}, ["web_search"]) is None
    ok, text = asyncio.run(run_tool("reminder_cancel", {"id": "zzz"}, context))
    assert not ok and "No pending reminder" in text


def test_service_two_phase_tool_loop_with_offline_provider(context):
    service = CharacterService(CharacterRepository(), LLMGateway(ProviderConfig(type="fake")))
    result = asyncio.run(service.chat("dick_gumshoe", "Remind me in a minute #remind", "t", tool_context=context))
    assert result.tool == {"name": "reminder_create", "ok": True}
    assert result.performance["segments"][0]["text"].startswith("Reminder ")
    assert [r["text"] for r in context.reminders.pending()] == ["Test reminder"]
    plain = asyncio.run(service.chat("dick_gumshoe", "hello", "t", tool_context=context))
    assert plain.tool is None
    without_tools = asyncio.run(service.chat("dick_gumshoe", "#remind", "u"))
    assert without_tools.tool is None


# --- API ---------------------------------------------------------------------------------------

def test_tool_api_is_local_and_never_returns_the_key(context, tmp_path):
    app = create_app(ProviderConfig(type="fake"), tool_context=context)
    client = TestClient(app, base_url="http://localhost", client=("127.0.0.1", 5000))
    (tmp_path / "evidence").mkdir()
    status = client.post("/api/tools/folders", json={"path": str(tmp_path / "evidence")}).json()
    assert status["folders"][0]["name"] == "evidence"
    assert client.post("/api/tools/folders", json={"path": str(tmp_path / "nope")}).status_code == 422
    assert client.put("/api/tools/web-search/key", json={"secret": "k"}).status_code == 409  # no provider yet
    client.put("/api/tools/web-search", json={"provider": "tavily"})
    body = client.put("/api/tools/web-search/key", json={"secret": "super-secret-key"})
    assert body.json()["webSearch"] == {"provider": "tavily", "configured": True, "providers": {"brave": "Brave Search", "tavily": "Tavily"}}
    assert "super-secret-key" not in body.text and "super-secret-key" not in json.dumps(client.get("/api/tools").json())
    assert client.delete("/api/tools/web-search/key").json()["webSearch"]["configured"] is False
    remote = TestClient(app, base_url="http://localhost", client=("203.0.113.9", 5000))
    assert remote.get("/api/tools").status_code == 403
    chat = client.post("/api/chat", json={"character": "mia_fey", "message": "#reminders", "sessionId": "api"}).json()
    assert chat["tool"] == {"name": "reminder_list", "ok": True}
    assert chat["performance"]["segments"][0]["text"] == "No pending reminders."


def test_recent_reminders_reach_a_newly_opened_conversation(context):
    app = create_app(ProviderConfig(type="fake"), tool_context=context)
    client = TestClient(app, base_url="http://localhost", client=("127.0.0.1", 5000))
    app.state.event_inbox.push("task_finished", "claude-code")
    app.state.event_inbox.push("reminder_due", "reminders", text="Lunch with Maya")
    first = client.get("/api/events", params={"character": "mia_fey", "after": 0, "language": "fr"}).json()
    assert [e["type"] for e in first["events"]] == ["reminder_due"]
    assert "Lunch with Maya" in first["events"][0]["performance"]["segments"][0]["text"]
