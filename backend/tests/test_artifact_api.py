"""Provider-independent artifact turns and local API, with no network/vault/model dependency."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.artifacts.store import ArtifactError, ArtifactStore
from app.artifacts.turns import Turn
from app.llm.base import LLMProvider, ProviderError, RawCompletion
from app.llm.config import ProviderConfig
from app.llm.gateway import DEFAULT_REGISTRY
from app.llm.providers.anthropic import AnthropicProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai_compatible import OpenAICompatibleProvider
from app.main import create_app

SECRET = "synthetic-provider-key-must-not-leak"


def reply(content="print('Hello from Maya')\n", filename="hello_maya.py", format="py"):
    return {"beats": [{"text": "Done! Your file is ready below.", "emotion": "happy", "intensity": .4}],
        "settleEmotion": "happy", "artifactAction": {"type": "create_text_artifact",
            "filename": filename, "format": format, "content": content}}


def body(message="#artifact-py", request_id=None, **extra):
    return {"character": "maya_fey", "message": message, "sessionId": "artifacts-test",
        "requestId": request_id or uuid4().hex, **extra}


def client_for(app):
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))


class Stub(LLMProvider):
    type = "fake"

    def __init__(self, payload=None, error=False):
        super().__init__("artifact-stub")
        self.payload = payload if payload is not None else reply()
        self.calls = 0
        self.requests = []
        self.error = error

    async def generate(self, request):
        self.calls += 1
        self.requests.append(request)
        if self.error:
            raise ProviderError("provider unavailable")
        return RawCompletion(json.dumps(self.payload))


def stub_app(tmp_path, provider=None, store=None):
    provider = provider or Stub()
    return create_app(ProviderConfig(), provider_registry={"fake": lambda _: provider},
        artifact_store=store or ArtifactStore(tmp_path / "outputs")), provider


@pytest.mark.parametrize("kind", ["fake", "ollama", "openai_compatible", "anthropic"])
def test_shared_flow_uses_all_adapters_without_provider_storage_logic(kind, tmp_path, monkeypatch, caplog):
    monkeypatch.setenv("ARTIFACT_TEST_KEY", SECRET)
    captured = []
    def transport(request):
        payload = json.loads(request.content)
        captured.append(payload)
        generated = reply()
        if kind == "ollama":
            return httpx.Response(200, json={"message": {"content": json.dumps(generated), "thinking": "hidden"}})
        if kind == "openai_compatible":
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(generated)}}]})
        return httpx.Response(200, json={"type": "message", "role": "assistant", "stop_reason": "end_turn",
            "content": [{"type": "thinking", "thinking": "hidden"}, {"type": "text", "text": json.dumps(generated)}]})
    mocked = httpx.MockTransport(transport)
    registry = dict(DEFAULT_REGISTRY)
    if kind == "ollama":
        registry[kind] = lambda c: OllamaProvider(base_url=c.base_url, model=c.model, transport=mocked)
    elif kind == "openai_compatible":
        registry[kind] = lambda c: OpenAICompatibleProvider(base_url=c.base_url, model=c.model, api_key=c.resolve_api_key(), transport=mocked)
    elif kind == "anthropic":
        registry[kind] = lambda c: AnthropicProvider(model=c.model, api_key=c.resolve_api_key(), transport=mocked)
    config = ProviderConfig(type=kind, model=None if kind == "fake" else "chat-model",
        base_url="http://127.0.0.1:11434" if kind == "ollama" else "https://api.example/v1" if kind == "openai_compatible" else None,
        api_key_env="ARTIFACT_TEST_KEY")
    store = ArtifactStore(tmp_path / "outputs")
    app = create_app(config, provider_registry=registry, artifact_store=store)
    with client_for(app) as client:
        data = client.post("/api/chat", json=body()).json()
        assert data["task"]["state"] == "artifact-ready"
        assert data["task"]["cues"] == ["artifact_working", "artifact_ready"]
        artifact = data["artifacts"][0]
        assert data["task"]["artifactId"] == artifact["id"]
        assert data["reply"]["beats"] and "artifactAction" not in data["reply"]
        assert data["performance"]["segments"][0]["text"]
        assert client.get(f"/api/artifacts/{artifact['id']}/content").json()["content"].startswith("print(")
        assert SECRET not in json.dumps(data) + store.index_path.read_text(encoding="utf-8") + caplog.text
        assert "hidden" not in json.dumps(data)
    if captured:
        payload = captured[0]
        schema = payload["format"] if kind == "ollama" else payload["response_format"]["json_schema"]["schema"] if kind == "openai_compatible" else payload["output_config"]["format"]["schema"]
        assert "artifactAction" in schema["properties"]
        prompt = payload.get("system") or payload["messages"][0]["content"]
        assert "Maya" in prompt and "Performance capabilities" in prompt
        assert "create_text_artifact" in prompt and "64 KiB" in prompt


def test_normal_chat_never_creates_artifact_or_ready_and_legacy_requests_stay_dialogue_only(tmp_path):
    app = create_app(ProviderConfig(), artifact_store=ArtifactStore(tmp_path))
    with client_for(app) as client:
        normal = client.post("/api/chat", json=body("How are you?")).json()
        assert normal["task"]["state"] == "idle"
        assert normal["task"]["cues"] == [] and normal["artifacts"] == []
        legacy = body("#artifact-py")
        del legacy["requestId"]
        assert "artifacts" not in client.post("/api/chat", json=legacy).json()
        assert client.get("/api/artifacts").json() == {"artifacts": []}


@pytest.mark.parametrize("mutation", [
    {"format": "exe"}, {"content": ""}, {"content": "x" * 65537},
    {"path": "C:/Windows/evil.py"}, {"execute": True}, {"filename": "foo.exe"},
])
def test_invalid_model_action_replaces_success_dialogue_and_never_emits_ready(tmp_path, mutation):
    payload = reply()
    payload["artifactAction"].update(mutation)
    app, _ = stub_app(tmp_path, Stub(payload))
    with client_for(app) as client:
        data = client.post("/api/chat", json=body()).json()
        assert data["task"]["state"] == "failed" and data["task"]["cue"] is None
        assert data["task"]["error"] == ("artifact_too_large" if mutation.get("content") == "x" * 65537 else "invalid_artifact_action")
        assert "artifact_ready" not in data["task"]["cues"]
        assert data["reply"] is None and data["artifacts"] == []
        assert data["performance"]["segments"][0]["text"] == app.state.character_service.repository.get("maya_fey").error_text
        assert client.get("/api/artifacts").json()["artifacts"] == []


@pytest.mark.parametrize("failure", ["provider", "write"])
def test_provider_or_metadata_write_failure_leaves_no_phantom_artifact(tmp_path, monkeypatch, failure):
    store = ArtifactStore(tmp_path / "outputs")
    app, _ = stub_app(tmp_path, Stub(error=failure == "provider"), store)
    if failure == "write":
        def fail(_): raise ArtifactError()
        monkeypatch.setattr(store, "_save", fail)
    with client_for(app) as client:
        data = client.post("/api/chat", json=body()).json()
        assert data["task"]["state"] == "failed" and data["task"]["artifactId"] is None
        assert "artifact_ready" not in data["task"]["cues"]
        assert data["reply"] is None and data["artifacts"] == []
        assert store.list() == []
        assert not store.files_dir.exists() or list(store.files_dir.iterdir()) == []


def test_duplicate_request_is_cached_and_restart_receipt_prevents_second_file(tmp_path):
    store = ArtifactStore(tmp_path)
    app, provider = stub_app(tmp_path, store=store)
    request = body()
    with client_for(app) as client:
        first = client.post("/api/chat", json=request).json()
        assert client.post("/api/chat", json=request).json() == first
        assert provider.calls == 1
        assert client.post("/api/chat", json={**request, "message": "different"}).status_code == 409
        assert client.delete("/api/chat/turns/" + request["requestId"]).json()["state"] == "artifact-ready"
        history = app.state.character_service._sessions["artifacts-test", "maya_fey"].history
        assert len(history) == 2 and "artifactAction" not in history[-1].content
        # Later turns must know the file exists, or the model disowns it (D-086).
        assert f"[File saved and delivered to the user: {first['artifacts'][0]['displayName']}]" in history[-1].content
    restarted, _ = stub_app(tmp_path, store=ArtifactStore(tmp_path))
    with client_for(restarted) as client:
        retry = client.post("/api/chat", json=request).json()
        assert retry["artifacts"][0]["id"] == first["artifacts"][0]["id"]
        assert len(client.get("/api/artifacts").json()["artifacts"]) == 1


@pytest.mark.parametrize("message,expected", [("#artifact-py", "text_artifact"), ("How are you?", "dialogue")])
def test_expected_workload_is_available_while_the_only_provider_request_is_pending(tmp_path, message, expected):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        class Slow(Stub):
            async def generate(self, request):
                self.calls += 1
                started.set()
                await release.wait()
                # A workload hint alone must never authorize an artifact.
                return RawCompletion(json.dumps({"beats": [{"text": "Okay!", "emotion": "happy"}]}))
        app, provider = stub_app(tmp_path, Slow())
        request = body(message)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1") as client:
            pending = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.wait_for(started.wait(), 2)
            status = (await client.get("/api/chat/turns/" + request["requestId"])).json()
            assert status["expectedWorkload"] == expected
            assert status["state"] == "working" and status["cue"] is None
            assert status["cues"] == [] and status["artifactId"] is None
            assert provider.calls == 1
            release.set()
            result = (await pending).json()
            assert result["artifacts"] == []
            assert result["task"]["expectedWorkload"] == expected
            assert provider.calls == 1
    asyncio.run(scenario())


def test_local_api_download_text_delete_missing_and_no_execution(tmp_path):
    marker = tmp_path / "never-run"
    content = f"from pathlib import Path\nPath({str(marker)!r}).write_text('BAD')\n<script>alert('BAD')</script>\n"
    app, _ = stub_app(tmp_path, Stub(reply(content, filename='../../CON.py')))
    with client_for(app) as client:
        data = client.post("/api/chat", json=body()).json()
        artifact = data["artifacts"][0]
        prefix = f"/api/artifacts/{artifact['id']}"
        assert artifact["displayName"] == "_CON.py"
        assert client.get(prefix).json()["status"] == "ready"
        assert client.get(prefix + "/content").json()["content"] == content
        download = client.get(prefix + "/download")
        assert download.text == content and download.headers["content-disposition"].startswith("attachment;")
        assert download.headers["x-content-type-options"] == "nosniff"
        assert download.headers["content-type"].startswith("text/plain")
        assert not marker.exists()
        assert client.get("/api/artifacts/invalid").status_code == 404
        assert client.get("/api/artifacts", headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/artifacts", headers={"Host": "evil.example"}).status_code == 403
        assert client.post("/api/artifacts", json={"path": "/evil"}).status_code == 405
        backing = app.state.artifact_store.files_dir / (artifact["id"] + ".text")
        backing.unlink()
        assert client.get(prefix).json()["status"] == "missing"
        assert client.get(prefix + "/content").status_code == 404
        assert client.delete(prefix).status_code == 204
        assert client.get("/api/artifacts").json() == {"artifacts": []}
        assert client.get("/api/chat/turns/" + data["task"]["id"]).json()["state"] == "failed"
        assert "outputs" not in json.dumps(client.get(prefix).json())


@pytest.mark.parametrize("at_action", [False, True])
def test_cancel_during_provider_or_validated_working_cue_and_simultaneous_duplicates(tmp_path, monkeypatch, at_action):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        class Slow(Stub):
            async def generate(self, request):
                self.calls += 1
                if not at_action:
                    started.set()
                    await release.wait()
                return RawCompletion(json.dumps(reply()))
        if at_action:
            original = Turn.artifact_working
            async def hold(turn):
                await original(turn)
                started.set()
                await release.wait()
            monkeypatch.setattr(Turn, "artifact_working", hold)
        app, provider = stub_app(tmp_path, Slow())
        request = body()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1") as client:
            pending = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.wait_for(started.wait(), 2)
            duplicate = asyncio.create_task(client.post("/api/chat", json=request))
            status = (await client.get("/api/chat/turns/" + request["requestId"])).json()
            assert status["state"] == "working"
            assert status["cue"] == ("artifact_working" if at_action else None)
            cancelled = (await client.delete("/api/chat/turns/" + request["requestId"])).json()
            assert cancelled["state"] == "failed" and cancelled["error"] == "cancelled"
            assert (await pending).status_code == 409
            assert (await duplicate).status_code == 409
            assert provider.calls == 1 and app.state.artifact_store.list() == []
            history = app.state.character_service._sessions["artifacts-test", "maya_fey"].history
            assert list(history) == []
    asyncio.run(scenario())


def test_cancel_before_post_never_calls_provider(tmp_path):
    app, provider = stub_app(tmp_path)
    request = body()
    with client_for(app) as client:
        assert client.delete("/api/chat/turns/" + request["requestId"]).json()["error"] == "cancelled"
        assert client.post("/api/chat", json=request).status_code == 409
        assert provider.calls == 0
        assert client.get("/api/chat/turns/not-an-id").status_code == 404
        assert client.post("/api/chat", json=body(), headers={"Origin": "https://evil.example"}).status_code == 403


def test_simultaneous_duplicate_success_calls_model_and_writes_once(tmp_path):
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        class Slow(Stub):
            async def generate(self, request):
                self.calls += 1
                started.set()
                await release.wait()
                return RawCompletion(json.dumps(reply()))
        app, provider = stub_app(tmp_path, Slow())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1") as client:
            request = body()
            first = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.wait_for(started.wait(), 2)
            second = asyncio.create_task(client.post("/api/chat", json=request))
            await asyncio.sleep(0)
            release.set()
            a, b = await asyncio.gather(first, second)
            assert a.status_code == b.status_code == 200 and a.json() == b.json()
            assert provider.calls == 1 and len(app.state.artifact_store.list()) == 1
            assert len(app.state.character_service._sessions["artifacts-test", "maya_fey"].history) == 2
    asyncio.run(scenario())
