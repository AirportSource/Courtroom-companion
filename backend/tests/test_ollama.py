"""Ollama adapter and backend proxy tests. All HTTP is mocked; no local Ollama is required."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.llm.base import GenerationRequest, GenerationSettings
from app.llm.config import DEFAULT_OLLAMA_BASE_URL, ProviderConfig
from app.llm.gateway import DEFAULT_REGISTRY, LLMGateway
from app.llm.providers.fake import FakeProvider
from app.llm.providers.ollama import (
    OllamaEmptyResponseError,
    OllamaHTTPError,
    OllamaModelNotFoundError,
    OllamaProvider,
    OllamaResponseError,
    OllamaTimeoutError,
    OllamaUnavailableError,
)
from app.llm.schemas import ChatMessage
from app.main import create_app

SCHEMA = {
    "type": "object",
    "required": ["beats"],
    "properties": {"beats": {"type": "array"}},
}
VALID_CONTENT = json.dumps(
    {
        "beats": [{"text": "Hi!", "emotion": "happy", "intensity": 0.4}],
        "settleEmotion": "happy",
    }
)


def generation_request() -> GenerationRequest:
    return GenerationRequest(
        "system context",
        [
            ChatMessage(role="user", content="first"),
            ChatMessage(role="assistant", content='{"beats": [{"text": "previous"}]}'),
            ChatMessage(role="user", content="hello"),
        ],
        SCHEMA,
        GenerationSettings(temperature=0.25, max_tokens=321, timeout_s=5),
    )


def run_generate(provider: OllamaProvider):
    return asyncio.run(provider.generate(generation_request()))


def test_ollama_is_registered_with_declared_capabilities():
    gateway = LLMGateway(ProviderConfig(type="ollama", model="qwen:test"))
    assert isinstance(gateway.provider, OllamaProvider)
    assert gateway.provider.base_url == DEFAULT_OLLAMA_BASE_URL
    assert gateway.info()["capabilities"] == {
        "structuredOutput": "native",
        "streaming": True,
        "toolCalling": False,
    }


def test_chat_request_translation_and_content_extraction():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        seen["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "model": "qwen:test",
                "message": {"role": "assistant", "thinking": "hidden chain", "content": VALID_CONTENT},
                "done": True,
                "total_duration": 123,
                "eval_count": 9,
            },
        )

    provider = OllamaProvider(
        base_url="http://ollama.internal:11999/",
        model="qwen:test",
        transport=httpx.MockTransport(handler),
    )
    raw = run_generate(provider)
    request = seen["request"]
    payload = seen["payload"]
    assert str(request.url) == "http://ollama.internal:11999/api/chat"
    assert "authorization" not in request.headers
    assert payload["model"] == "qwen:test"
    assert payload["stream"] is False
    assert payload["think"] is False
    assert payload["format"] == SCHEMA
    assert payload["options"] == {"temperature": 0.25, "num_predict": 321}
    assert payload["messages"] == [
        {"role": "system", "content": "system context"},
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": '{"beats": [{"text": "previous"}]}'},
        {"role": "user", "content": "hello"},
    ]
    assert raw.content == VALID_CONTENT
    assert "hidden chain" not in str(raw.content)
    assert raw.metadata == {"total_duration": 123, "eval_count": 9}


def test_model_discovery_parses_useful_fields():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET" and request.url.path == "/api/tags"
        return httpx.Response(
            200,
            json={
                "models": [
                    {
                        "name": "qwen2.5:7b",
                        "model": "qwen2.5:7b",
                        "size": 4_700_000_000,
                        "details": {"parameter_size": "7.6B", "quantization_level": "Q4_K_M"},
                    },
                    {"name": "unknown:latest", "details": {}},
                    "invalid",
                ]
            },
        )

    provider = OllamaProvider(transport=httpx.MockTransport(handler))
    models = asyncio.run(provider.list_models())
    assert models == [
        {
            "name": "qwen2.5:7b",
            "model": "qwen2.5:7b",
            "parameterSize": "7.6B",
            "quantizationLevel": "Q4_K_M",
            "size": 4_700_000_000,
        },
        {
            "name": "unknown:latest",
            "model": "unknown:latest",
            "parameterSize": None,
            "quantizationLevel": None,
            "size": None,
        },
    ]


def test_config_normalizes_url_and_requires_a_valid_http_url():
    config = ProviderConfig(type="ollama", base_url=" http://localhost:11434/// ", model=" qwen:test ")
    assert config.base_url == DEFAULT_OLLAMA_BASE_URL
    assert config.model == "qwen:test"
    assert config.resolve_api_key({}) is None
    with pytest.raises(ValidationError):
        ProviderConfig(type="ollama", base_url="not a URL")
    with pytest.raises(ValidationError):
        ProviderConfig(type="ollama", base_url="http://user:secret@localhost:11434")


@pytest.mark.parametrize(
    ("handler", "error_type"),
    [
        (lambda request: (_ for _ in ()).throw(httpx.ConnectError("refused", request=request)), OllamaUnavailableError),
        (lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=request)), OllamaTimeoutError),
        (lambda request: httpx.Response(500, json={"error": "internal details"}), OllamaHTTPError),
        (lambda request: httpx.Response(200, content=b"not-json"), OllamaResponseError),
        (lambda request: httpx.Response(200, json={"done": True}), OllamaResponseError),
        (lambda request: httpx.Response(200, json={"message": {"content": "  "}}), OllamaEmptyResponseError),
        (lambda request: httpx.Response(404, json={"error": "model not found"}), OllamaModelNotFoundError),
    ],
)
def test_provider_failures_are_typed(handler, error_type):
    provider = OllamaProvider(model="missing:model", transport=httpx.MockTransport(handler))
    with pytest.raises(error_type):
        run_generate(provider)


def test_missing_model_is_rejected_before_transport():
    provider = OllamaProvider(transport=httpx.MockTransport(lambda request: pytest.fail("HTTP should not run")))
    with pytest.raises(OllamaModelNotFoundError):
        run_generate(provider)


def test_gateway_uses_ollama_then_shared_validator():
    transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json={"model": "qwen:test", "message": {"content": VALID_CONTENT}})
    )
    registry = {
        **DEFAULT_REGISTRY,
        "ollama": lambda config: OllamaProvider(config.base_url or DEFAULT_OLLAMA_BASE_URL, config.model, transport),
    }
    gateway = LLMGateway(ProviderConfig(type="ollama", model="qwen:test"), registry=registry)
    result = asyncio.run(gateway.generate_reply("system", [ChatMessage(role="user", content="hello")], SCHEMA))
    assert result.error is None
    assert result.reply.beats[0].text == "Hi!"
    assert result.reply.beats[0].emotion == "happy"


def test_fake_provider_regression_still_uses_shared_gateway():
    gateway = LLMGateway(ProviderConfig(type="fake"))
    assert isinstance(gateway.provider, FakeProvider)
    result = asyncio.run(gateway.generate_reply("system", [ChatMessage(role="user", content="hello")], SCHEMA))
    assert result.error is None and result.reply.beats


def test_backend_discovery_connection_test_and_active_profile(maya):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.url.path == "/api/tags":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {
                            "name": "qwen:test",
                            "model": "qwen:test",
                            "size": 1234,
                            "details": {"parameter_size": "1B", "quantization_level": "Q4"},
                        }
                    ]
                },
            )
        return httpx.Response(200, json={"model": "qwen:test", "message": {"content": VALID_CONTENT}})

    transport = httpx.MockTransport(handler)
    registry = {
        **DEFAULT_REGISTRY,
        "ollama": lambda config: OllamaProvider(config.base_url or DEFAULT_OLLAMA_BASE_URL, config.model, transport),
    }
    app = create_app(ProviderConfig(type="fake"), provider_registry=registry)
    client = TestClient(app)

    discovered = client.get("/api/providers/ollama/models", params={"baseUrl": "http://custom:11434/"})
    assert discovered.status_code == 200
    assert discovered.json()["models"][0]["parameterSize"] == "1B"

    tested = client.post(
        "/api/providers/ollama/test",
        json={"baseUrl": "http://custom:11434", "model": "qwen:test", "character": maya.id},
    )
    assert tested.status_code == 200
    assert tested.json()["status"] == "generation_succeeded"
    assert app.state.character_service._sessions == {}  # provider test never touches conversation memory

    from app.configuration.profiles import ProfileDraft
    selected = app.state.provider_profiles.store.create(ProfileDraft(
        name="Local", provider_type="ollama", base_url="http://custom:11434/", model="qwen:test",
    ))
    app.state.provider_profiles.store.activate(selected.id)
    chat = client.post(
        "/api/chat",
        json={
            "character": maya.id,
            "message": "hello",
            "sessionId": "ollama-test",
        },
    )
    assert chat.status_code == 200
    assert chat.json()["provider"]["type"] == "ollama"
    assert chat.json()["performance"]["segments"][0]["text"] == "Hi!"
    assert ("GET", "/api/tags") in calls and ("POST", "/api/chat") in calls


def test_connection_test_reports_selected_model_missing(maya):
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"models": []}))
    registry = {
        **DEFAULT_REGISTRY,
        "ollama": lambda config: OllamaProvider(config.base_url or DEFAULT_OLLAMA_BASE_URL, config.model, transport),
    }
    client = TestClient(create_app(ProviderConfig(type="fake"), provider_registry=registry))
    response = client.post(
        "/api/providers/ollama/test",
        json={"model": "missing:model", "character": maya.id},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "selected_model_missing"
    assert response.json()["generationSucceeded"] is False


def test_backend_rejects_invalid_ollama_base_url_without_a_traceback():
    client = TestClient(create_app(ProviderConfig(type="fake")))
    response = client.get("/api/providers/ollama/models", params={"baseUrl": "not a URL"})
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "invalid_base_url",
        "message": "Invalid Ollama server URL.",
    }
