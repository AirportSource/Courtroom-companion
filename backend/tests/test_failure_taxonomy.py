"""Failure taxonomy across all providers, fail-closed truncation and the history context budget."""

import asyncio
import json

import httpx
import pytest

from app.artifacts.store import ArtifactStore
from app.characters.context import MAX_HISTORY_COST, MAX_HISTORY_MESSAGE_COST, fit_history, text_cost
from app.llm.base import GenerationRequest, GenerationSettings, LLMProvider, ProviderError, RawCompletion
from app.llm.config import ProviderConfig
from app.llm.gateway import LLMGateway
from app.llm.errors import failure_class
from app.llm.providers.anthropic import AnthropicProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai_compatible import OpenAICompatibleProvider
from app.llm.schemas import ChatMessage
from app.main import create_app
from .test_output_budgets import KEY, chat, completion, local_client

SCHEMA = {"type": "object"}
JA = "あ"


def request(max_tokens=4096):
    return GenerationRequest("system", [ChatMessage(role="user", content="hi")], SCHEMA, GenerationSettings(max_tokens=max_tokens))


def provider(kind, response):
    transport = httpx.MockTransport(lambda _: response)
    if kind == "ollama":
        return OllamaProvider("http://localhost:11434", "m", transport)
    if kind == "openai_compatible":
        return OpenAICompatibleProvider("https://api.example/v1", "m", KEY, transport)
    return AnthropicProvider("claude-sonnet-5-5", KEY, transport)


def ok(kind, text, stop):
    if kind == "ollama":
        return httpx.Response(200, json={"message": {"content": text}, "done_reason": stop[0], "eval_count": 16384})
    if kind == "openai_compatible":
        return httpx.Response(200, json={"choices": [{"message": {"content": text}, "finish_reason": stop[1]}]})
    return httpx.Response(200, json={"type": "message", "role": "assistant", "stop_reason": stop[2], "content": [{"type": "text", "text": text}]})


def code_of(kind, response):
    with pytest.raises(ProviderError) as info:
        asyncio.run(provider(kind, response).generate(request()))
    return info.value.code, getattr(info.value, "stop_reason", None)


@pytest.mark.parametrize("kind", ["ollama", "openai_compatible", "anthropic"])
@pytest.mark.parametrize("text", ['{"beats":[{"text":"cut', json.dumps(completion()), ""])
def test_output_length_stop_is_truncation_even_if_parseable_or_empty(kind, text):
    assert code_of(kind, ok(kind, text, ("length", "length", "max_tokens"))) == ("output_token_limit", "max_tokens")


def test_ollama_length_before_requested_budget_means_context_window():
    response = httpx.Response(200, json={"message": {"content": "{"}, "done_reason": "length", "eval_count": 120})
    assert code_of("ollama", response) == ("context_window_exceeded", "model_context_window_exceeded")


@pytest.mark.parametrize("kind,status,body,expected", [
    ("openai_compatible", 400, {"error": {"code": "context_length_exceeded", "message": "maximum context length"}}, "context_window_exceeded"),
    ("openai_compatible", 400, {"error": {"message": "The input token count exceeds the maximum"}}, "context_window_exceeded"),
    ("openai_compatible", 413, {}, "provider_limit"),
    ("openai_compatible", 429, {"error": {"code": "insufficient_quota"}}, "rate_limited"),
    ("openai_compatible", 400, {"error": {"code": "insufficient_quota"}}, "provider_limit"),
    ("openai_compatible", 500, {}, "provider_http_error"),
    ("anthropic", 400, {"error": {"type": "invalid_request_error", "message": "prompt is too long: 250000 tokens"}}, "context_window_exceeded"),
    ("anthropic", 413, {"error": {"type": "request_too_large"}}, "provider_limit"),
    ("anthropic", 402, {}, "provider_limit"),
    ("ollama", 400, {"error": "input length exceeds the context length"}, "context_window_exceeded"),
    ("ollama", 500, {}, "provider_http_error"),
])
def test_http_error_taxonomy(kind, status, body, expected):
    assert code_of(kind, httpx.Response(status, json=body))[0] == expected


def test_failure_class_mapping():
    codes = ("output_token_limit", "context_window_exceeded", "artifact_too_large", "provider_limit", "rate_limited", "provider_http_error", "auth_failed")
    assert {c: failure_class(c) for c in codes} == {
        "output_token_limit": "output_truncated", "context_window_exceeded": "context_window_exceeded",
        "artifact_too_large": "artifact_too_large", "provider_limit": "provider_limit", "rate_limited": "provider_limit",
        "provider_http_error": "unknown_provider_error", "auth_failed": None}


def app_for(kind, tmp_path, response):
    config = ProviderConfig(type=kind, model="m", base_url="http://localhost:11434" if kind == "ollama" else "https://api.example/v1" if kind == "openai_compatible" else None)
    return create_app(config, provider_registry={kind: lambda c: provider(kind, response)}, artifact_store=ArtifactStore(tmp_path / "outputs"))


@pytest.mark.parametrize("kind", ["ollama", "openai_compatible", "anthropic"])
@pytest.mark.parametrize("message,workload", [("How are you?", "dialogue"), ("#artifact-py", "text_artifact")])
@pytest.mark.parametrize("failure", ["length", "context"])
def test_truncated_or_context_failures_never_write_or_present_anything(tmp_path, kind, message, workload, failure):
    if failure == "length":
        response = ok(kind, json.dumps(completion(workload == "text_artifact")), ("length", "length", "max_tokens"))
        code, cls = "output_token_limit", "output_truncated"
    else:
        body = {"error": "context length exceeded"} if kind == "ollama" else {"error": {"code": "context_length_exceeded", "message": "prompt is too long"}}
        response = httpx.Response(400, json=body)
        code, cls = "context_window_exceeded", "context_window_exceeded"
    app = app_for(kind, tmp_path, response)
    with local_client(app) as client:
        result = client.post("/api/chat", json=chat(message)).json()
        assert result["reply"] is None and result["artifacts"] == []
        assert result["task"]["state"] == "failed" and result["task"]["error"] == code
        assert result["task"]["cue"] is None and result["task"]["artifactId"] is None
        assert "artifact_ready" not in result["task"]["cues"]
        assert result["generation"]["workload"] == workload and result["generation"]["failureClass"] == cls
        assert client.get("/api/artifacts").json()["artifacts"] == []
        assert not app.state.artifact_store.files_dir.exists()
        text = result["performance"]["segments"][0]["text"]
        assert text == app.state.character_service.repository.get("maya_fey").error_text and "beats" not in text
        assert len(app.state.character_service._sessions["budget-test", "maya_fey"].history) == 1  # no assistant entry


def test_completed_artifact_over_the_store_limit_fails_as_artifact_too_large(tmp_path):
    payload = completion(True)
    payload["artifactAction"]["content"] = "x" * (64 * 1024 + 1)
    app = app_for("openai_compatible", tmp_path, ok("openai_compatible", json.dumps(payload), ("stop", "stop", "end_turn")))
    with local_client(app) as client:
        result = client.post("/api/chat", json=chat("#artifact-py")).json()
        assert result["task"]["error"] == "artifact_too_large" and result["generation"]["failureClass"] == "artifact_too_large"
        assert result["artifacts"] == [] and "artifact_ready" not in result["task"]["cues"]
        assert "64 KiB" in result["warnings"][0]
        assert client.get("/api/artifacts").json()["artifacts"] == []


def test_gateway_rejects_incomplete_generation_from_any_adapter(tmp_path):
    class Sloppy(LLMProvider):
        type = "sloppy"

        async def generate(self, request):
            return RawCompletion(json.dumps(completion()), metadata={"stop_reason": "length"})

    gateway = LLMGateway(ProviderConfig(type="sloppy"), {"sloppy": lambda c: Sloppy()})
    result = asyncio.run(gateway.generate_reply("system", [ChatMessage(role="user", content="hi")], SCHEMA))
    assert result.reply is None and result.error == "output_token_limit"
    assert result.generation["failureClass"] == "output_truncated" and result.generation["stopReason"] == "max_tokens"


def test_history_context_budget_is_deterministic_and_never_summarizes():
    msgs = [ChatMessage(role="user" if i % 2 == 0 else "assistant", content=f"m{i} " + "a" * 1000) for i in range(12)]
    assert fit_history(msgs) == msgs  # small history is untouched
    big = [ChatMessage(role="user" if i % 2 == 0 else "assistant", content=f"m{i} " + JA * 1990) for i in range(12)]
    fitted = fit_history(big)
    assert sum(text_cost(m.content) for m in fitted) <= MAX_HISTORY_COST and fitted[0].role == "user"
    assert fitted == big[len(big) - len(fitted):]  # oldest whole messages dropped first, newest preserved
    assert 0 < len(fitted) < len(big) and fit_history(big) == fitted
    assert fit_history([]) == []


def test_oversized_history_entry_is_clipped_not_summarized():
    fitted = fit_history([ChatMessage(role="user", content="x" * 20000), ChatMessage(role="assistant", content="ok")])
    assert text_cost(fitted[0].content) <= MAX_HISTORY_MESSAGE_COST and fitted[0].content.startswith("xxx") and fitted[1].content == "ok"


def test_service_sends_bounded_history_but_the_full_current_message(tmp_path):
    sent = []

    def handle(req):
        sent.append(json.loads(req.content)["messages"])
        return ok("openai_compatible", json.dumps(completion()), ("stop", "stop", "end_turn"))

    transport = httpx.MockTransport(handle)
    config = ProviderConfig(type="openai_compatible", model="m", base_url="https://api.example/v1")
    app = create_app(config, provider_registry={"openai_compatible": lambda c: OpenAICompatibleProvider(c.base_url, c.model, KEY, transport)},
        artifact_store=ArtifactStore(tmp_path / "o"))
    with local_client(app) as client:
        for i in range(8):
            client.post("/api/chat", json=chat(f"{i}: " + JA * 1900))
    last = sent[-1]
    assert last[-1]["content"].startswith("7: ") and last[-1]["content"].count(JA) == 1900
    history = last[1:-1]
    assert sum(text_cost(m["content"]) for m in history) <= MAX_HISTORY_COST and history[0]["role"] == "user"
