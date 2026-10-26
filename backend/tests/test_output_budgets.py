"""Task-aware budgets and fail-closed truncation, without any live provider/credential."""

import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.artifacts.store import ArtifactStore
from app.artifacts.workload import expected_workload
from app.llm.base import GenerationSettings, OutputWorkload
from app.llm.budgets import DIALOGUE_MIN_OUTPUT_TOKENS, TEXT_ARTIFACT_OUTPUT_TOKENS, settings_for_workload
from app.llm.config import ProviderConfig
from app.llm.providers.anthropic import AnthropicProvider
from app.llm.providers.fake import FakeProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai_compatible import OpenAICompatibleProvider
from app.main import create_app

KEY = SecretStr("synthetic-transport-key")
LARGE_CONTENT = "".join(f"print('Line {i}')\n" for i in range(1000))


def completion(artifact=False):
    result = {"beats": [{"text": "Done! Your file is ready below." if artifact else "I'm doing well!", "emotion": "happy"}]}
    if artifact:
        result["artifactAction"] = {"type": "create_text_artifact", "filename": "large_script.py", "format": "py", "content": LARGE_CONTENT}
    return result


def chat(message, request_id=None):
    return {"character": "maya_fey", "message": message, "sessionId": "budget-test", "requestId": request_id or uuid4().hex}


def local_client(app):
    return TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 50000))


@pytest.mark.parametrize("message", [
    "Create a Python script called hello_maya.py that prints Hello from Maya.",
    "Write your answer into a text file.", "Create a Markdown checklist.",
    "Could you please save this as notes.txt?", "Hi! Please create a script.",
    "I need you to export this to a file.", "#artifact-py", "#artifact-md", "#artifact-txt",
    "Écris un fichier texte.", "Peux-tu créer un script Python ?", "Rédige une checklist Markdown.",
    "Pythonのファイルを作成してください。", "hello.py というスクリプトを書いて。",
    # D-073: polite French forms, Italian and Spanish requests.
    "Est-ce que tu peux me faire un fichier texte avec une liste de courses ?",
    "Tu pourrais me préparer une checklist ?", "J'aimerais un fichier avec mes notes.",
    "Pouvez-vous rédiger un document ?", "Mi puoi scrivere un file di testo?", "Crea una lista in un documento.",
    "¿Puedes crear un archivo de texto?", "Hazme una lista en un archivo.",
    # Real miss from the owner's session: the verb comes after another clause.
    "I need you to find the best police academies in France on the internet and generate an md file to save them",
    "Look up three recipes and then write them in a file for me.",
    "Summarize our chat as a markdown file.", "Could I get that list as a text file?",
    "Put the steps into a file please.", "Trouve les meilleures écoles et mets-les dans un fichier.",
    "Résume la conversation sous forme de fichier.", "J'ai besoin d'un fichier md avec le planning.",
    "Cerca le ricette e poi scrivi un file di testo.", "Busca tres libros y guárdalos en un archivo.",
])
def test_explicit_creation_gets_budget_hint_but_hint_is_disabled_without_artifact_capability(message):
    assert expected_workload(message, artifacts_enabled=True) == OutputWorkload.TEXT_ARTIFACT
    assert expected_workload(message, artifacts_enabled=False) == OutputWorkload.DIALOGUE


@pytest.mark.parametrize("message", [
    "How are you?", "Explain Python decorators.", "How do I create a file in Python?",
    "Can you explain how to save a Markdown file?", "What is hello.py?", "Write a short story.",
    "Do not create a file.", "Comment créer un fichier Python ?", "今日は元気？",
    "Pythonのファイルの作成方法を説明して。",
    "Est-ce que tu as lu mon fichier ?", "J'aimerais savoir comment créer un fichier.",
    "Come si crea un file in Python?", "¿Cómo se crea un archivo de texto?",
    # Widened detection (verb anywhere / explicit format) must still ignore these.
    "Did you save the file?", "Have you already written the markdown file?", "Never write a text file for me.",
    "What is a markdown file?", "As-tu enregistré le fichier ?", "Pourquoi as-tu créé un fichier ?",
    "I don't want an md file, just tell me.", "Thanks for the file yesterday!", "I made a list of groceries.",
])
def test_normal_chat_and_questions_about_files_keep_normal_budget(message):
    assert expected_workload(message, artifacts_enabled=True) == OutputWorkload.DIALOGUE


def test_per_request_settings_copy_preserves_config_and_does_not_select_a_model_maximum():
    configured = GenerationSettings(max_tokens=600, temperature=.2, timeout_s=120)
    normal = settings_for_workload(configured, OutputWorkload.DIALOGUE)
    artifact = settings_for_workload(configured, OutputWorkload.TEXT_ARTIFACT)
    assert configured.max_tokens == 600 and normal.max_tokens == DIALOGUE_MIN_OUTPUT_TOKENS == 4096
    assert artifact.max_tokens == TEXT_ARTIFACT_OUTPUT_TOKENS == 16384
    assert artifact.timeout_s == 120 and artifact.temperature == .2
    assert configured.model_dump() == {"temperature": .2, "max_tokens": 600, "timeout_s": 120}
    assert settings_for_workload(GenerationSettings(max_tokens=900), OutputWorkload.DIALOGUE).max_tokens == 4096
    assert settings_for_workload(GenerationSettings(max_tokens=8000), OutputWorkload.DIALOGUE).max_tokens == 8000
    assert GenerationSettings(max_tokens=16384).max_tokens == 16384
    with pytest.raises(ValidationError):
        GenerationSettings(max_tokens=16385)


@pytest.mark.parametrize("kind", ["fake", "ollama", "openai_compatible", "anthropic"])
def test_actual_adapter_budgets_dialogue_artifact_dialogue_without_profile_mutation(kind, tmp_path):
    sent = []
    class ObservedFake(FakeProvider):
        async def generate(self, request):
            sent.append((request.settings.max_tokens, request.workload.value))
            return await super().generate(request)
    def handle(request):
        payload = json.loads(request.content)
        budget = payload["options"]["num_predict"] if kind == "ollama" else payload["max_tokens"]
        artifact = "#artifact-py" in payload["messages"][-1]["content"]
        sent.append((budget, "text_artifact" if artifact else "dialogue"))
        result = json.dumps(completion(artifact))
        if kind == "ollama":
            return httpx.Response(200, json={"message": {"content": result}})
        if kind == "openai_compatible":
            return httpx.Response(200, json={"choices": [{"message": {"content": result}}]})
        return httpx.Response(200, json={"type": "message", "role": "assistant", "stop_reason": "end_turn", "content": [{"type": "text", "text": result}]})
    transport = httpx.MockTransport(handle)
    factories = {
        "fake": lambda _: ObservedFake(),
        "ollama": lambda c: OllamaProvider(c.base_url, c.model, transport),
        "openai_compatible": lambda c: OpenAICompatibleProvider(c.base_url, c.model, KEY, transport),
        "anthropic": lambda c: AnthropicProvider(c.model, KEY, transport),
    }
    config = ProviderConfig(type=kind, model=None if kind == "fake" else "chat-model",
        base_url="http://127.0.0.1:11434" if kind == "ollama" else "https://api.example/v1" if kind == "openai_compatible" else None)
    app = create_app(config, provider_registry={kind: factories[kind]}, artifact_store=ArtifactStore(tmp_path / "outputs"))
    with local_client(app) as client:
        a = client.post("/api/chat", json=chat("How are you?")).json()
        b = client.post("/api/chat", json=chat("#artifact-py")).json()
        c = client.post("/api/chat", json=chat("How are you?")).json()
        assert a["generation"]["maxOutputTokens"] == c["generation"]["maxOutputTokens"] == 4096
        assert a["task"]["state"] == c["task"]["state"] == "idle"
        assert b["generation"]["maxOutputTokens"] == 16384 and b["generation"]["workload"] == "text_artifact"
        assert b["task"]["state"] == "artifact-ready" and len(b["artifacts"]) == 1
        assert len(client.get("/api/artifacts").json()["artifacts"]) == 1
    assert sent == [(4096, "dialogue"), (16384, "text_artifact"), (4096, "dialogue")]
    assert app.state.provider_profiles.store.get().generation_settings.max_tokens == 600
    assert app.state.character_service.gateway.config.settings.max_tokens == 600


def anthropic_app(tmp_path, stop_reason, content):
    sent = []
    def handle(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"type": "message", "role": "assistant", "stop_reason": stop_reason,
            "content": [{"type": "thinking", "thinking": "hidden reasoning"}, {"type": "text", "text": content}]})
    config = ProviderConfig(type="anthropic", model="claude-sonnet-5-5")
    app = create_app(config, provider_registry={"anthropic": lambda c: AnthropicProvider(c.model, KEY, httpx.MockTransport(handle))},
        artifact_store=ArtifactStore(tmp_path / "outputs"))
    return app, sent


@pytest.mark.parametrize("stop_reason,error", [
    ("max_tokens", "output_token_limit"),
    ("model_context_window_exceeded", "context_window_exceeded"),
    ("refusal", "provider_refused"),
])
@pytest.mark.parametrize("complete_json", [False, True])
def test_stopped_artifact_generation_never_saves_even_a_parseable_partial_result(tmp_path, stop_reason, error, complete_json):
    content = json.dumps(completion(True)) if complete_json else '{"artifactAction":{"type":"create_text_artifact","content":"partial'
    app, sent = anthropic_app(tmp_path, stop_reason, content)
    with local_client(app) as client:
        result = client.post("/api/chat", json=chat("Create a Python script called large_script.py.")).json()
        assert sent[0]["max_tokens"] == 16384 and len(sent) == 1  # no continuation/retry or partial concatenation
        assert result["reply"] is None and result["artifacts"] == []
        assert result["task"]["state"] == "failed" and result["task"]["error"] == error
        assert result["task"]["cue"] is None and result["task"]["artifactId"] is None
        assert "artifact_ready" not in result["task"]["cues"]
        assert result["generation"] == {"workload": "text_artifact", "maxOutputTokens": 16384, "stopReason": stop_reason,
            **({"failureClass": {"max_tokens": "output_truncated", "model_context_window_exceeded": "context_window_exceeded"}[stop_reason]} if stop_reason != "refusal" else {})}
        assert client.get("/api/artifacts").json()["artifacts"] == []
        assert not app.state.artifact_store.index_path.exists()
        assert not app.state.artifact_store.files_dir.exists()
        assert result["performance"]["segments"][0]["text"] == app.state.character_service.repository.get("maya_fey").error_text
        serialized = json.dumps(result)
        assert "hidden reasoning" not in serialized and "partial" not in result["performance"]["segments"][0]["text"]
        if stop_reason == "max_tokens":
            assert "16384" in result["warnings"][0] and "context" not in result["warnings"][0]
        if stop_reason == "model_context_window_exceeded":
            assert "context window" in result["warnings"][0] and "Increasing max_tokens alone will not fix" in result["warnings"][0]
        assert len(app.state.character_service._sessions["budget-test", "maya_fey"].history) == 1


def test_complete_larger_artifact_creates_exactly_one_file_and_caches_the_turn(tmp_path):
    app, sent = anthropic_app(tmp_path, "end_turn", json.dumps(completion(True)))
    request = chat("Create a Python script called large_script.py.")
    with local_client(app) as client:
        result = client.post("/api/chat", json=request).json()
        assert client.post("/api/chat", json=request).json() == result
        assert len(sent) == 1 and sent[0]["max_tokens"] == 16384
        assert result["generation"]["stopReason"] == "end_turn"
        assert result["task"]["cues"] == ["artifact_working", "artifact_ready"]
        artifact = result["artifacts"][0]
        assert artifact["sizeBytes"] == len(LARGE_CONTENT.encode()) > 16000
        assert client.get(f"/api/artifacts/{artifact['id']}/content").json()["content"] == LARGE_CONTENT
        assert len(client.get("/api/artifacts").json()["artifacts"]) == 1
        history = app.state.character_service._sessions["budget-test", "maya_fey"].history
        assert len(history) == 2 and "print(" not in history[-1].content
