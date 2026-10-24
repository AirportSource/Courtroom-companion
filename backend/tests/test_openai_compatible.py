"""OpenAI-compatible adapter tests. Every upstream HTTP exchange is mocked."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.llm.base import GenerationRequest, GenerationSettings
from app.llm.config import ProviderConfig, load_provider_config
from app.llm.gateway import DEFAULT_REGISTRY, LLMGateway
from app.llm.providers.fake import FakeProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai_compatible import (
    OpenAICompatibleAuthError,
    OpenAICompatibleAuthNotConfiguredError,
    OpenAICompatibleEmptyResponseError,
    OpenAICompatibleHTTPError,
    OpenAICompatibleModelError,
    OpenAICompatibleProvider,
    OpenAICompatibleRateLimitError,
    OpenAICompatibleResponseError,
    OpenAICompatibleStructuredOutputError,
    OpenAICompatibleTimeoutError,
    OpenAICompatibleUnavailableError,
)
from app.llm.schemas import ChatMessage
from app.main import create_app

BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
MODEL = "gemini-3.8-flash"
SECRET = "test-secret-never-log"
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["beats"],
    "properties": {"beats": {"type": "array"}},
}
VALID_CONTENT = json.dumps(
    {
        "beats": [{"text": "Hey!", "emotion": "happy", "intensity": 0.4}],
        "settleEmotion": "happy",
    }
)


def generation_request() -> GenerationRequest:
    return GenerationRequest(
        "system context",
        [
            ChatMessage(role="user", content="first"),
            ChatMessage(role="assistant", content='{"beats":[{"text":"previous"}]}'),
            ChatMessage(role="user", content="hello"),
        ],
        SCHEMA,
        GenerationSettings(temperature=0.2, max_tokens=345, timeout_s=5),
    )


def provider_with(handler, *, api_key: SecretStr | None = SecretStr(SECRET)) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(BASE_URL, MODEL, api_key, httpx.MockTransport(handler))


def run_generate(provider: OpenAICompatibleProvider):
    return asyncio.run(provider.generate(generation_request()))


def response(content: str = VALID_CONTENT, **extra) -> httpx.Response:
    body = {
        "id": "chatcmpl-test",
        "model": MODEL,
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
        **extra,
    }
    return httpx.Response(200, json=body)


def test_provider_registration_keeps_fake_and_ollama(monkeypatch):
    monkeypatch.setenv("TEST_OPENAI_KEY", SECRET)
    gateway = LLMGateway(
        ProviderConfig(
            type="openai_compatible",
            base_url=BASE_URL,
            model=MODEL,
            api_key_env="TEST_OPENAI_KEY",
        )
    )
    assert isinstance(gateway.provider, OpenAICompatibleProvider)
    assert gateway.info()["capabilities"] == {
        "structuredOutput": "native",
        "streaming": True,
        "toolCalling": False,
    }
    assert isinstance(LLMGateway(ProviderConfig(type="fake")).provider, FakeProvider)
    assert isinstance(LLMGateway(ProviderConfig(type="ollama", model="test")).provider, OllamaProvider)


def test_chat_request_translation_authorization_and_content_extraction():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        seen["payload"] = json.loads(request.content)
        return response()

    raw = run_generate(provider_with(handler))
    request = seen["request"]
    payload = seen["payload"]
    assert str(request.url) == f"{BASE_URL}/chat/completions"
    assert request.headers["authorization"] == f"Bearer {SECRET}"
    assert payload == {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "system context"},
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": '{"beats":[{"text":"previous"}]}'},
            {"role": "user", "content": "hello"},
        ],
        "stream": False,
        "temperature": 0.2,
        "max_tokens": 345,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "character_reply", "strict": True, "schema": SCHEMA},
        },
    }
    assert raw.content == VALID_CONTENT
    assert raw.model == MODEL
    assert raw.metadata == {
        "finish_reason": "stop",
        "stop_reason": "end_turn",
        "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
    }


def test_custom_base_url_path_and_trailing_slash_are_preserved():
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://example.test/custom/v1/chat/completions"
        return response()

    config = ProviderConfig(
        type="openai_compatible",
        base_url=" https://example.test/custom/v1/// ",
        model=MODEL,
    )
    assert config.base_url == "https://example.test/custom/v1"
    run_generate(
        OpenAICompatibleProvider(config.base_url, config.model, SecretStr(SECRET), httpx.MockTransport(handler))
    )


@pytest.mark.parametrize(
    ("handler", "error_type"),
    [
        (
            lambda request: (_ for _ in ()).throw(httpx.ConnectError("refused", request=request)),
            OpenAICompatibleUnavailableError,
        ),
        (
            lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=request)),
            OpenAICompatibleTimeoutError,
        ),
        (lambda request: httpx.Response(401, json={"error": {"message": "bad key"}}), OpenAICompatibleAuthError),
        (lambda request: httpx.Response(403, json={"error": {"message": "forbidden"}}), OpenAICompatibleAuthError),
        (lambda request: httpx.Response(429, json={"error": {"message": "slow down"}}), OpenAICompatibleRateLimitError),
        (lambda request: httpx.Response(404, json={"error": {"message": "model missing"}}), OpenAICompatibleModelError),
        (lambda request: httpx.Response(500, json={"error": {"message": "internal"}}), OpenAICompatibleHTTPError),
        (lambda request: httpx.Response(200, content=b"not-json"), OpenAICompatibleResponseError),
        (lambda request: httpx.Response(200, json={"choices": []}), OpenAICompatibleResponseError),
        (
            lambda request: httpx.Response(200, json={"choices": [{"message": {}}]}),
            OpenAICompatibleResponseError,
        ),
        (
            lambda request: httpx.Response(200, json={"choices": [{"message": {"content": "  "}}]}),
            OpenAICompatibleEmptyResponseError,
        ),
    ],
)
def test_transport_and_response_failures_are_typed(handler, error_type):
    with pytest.raises(error_type):
        run_generate(provider_with(handler))


def test_structured_output_rejection_is_distinct_from_model_error():
    structured = provider_with(
        lambda request: httpx.Response(
            400,
            json={"error": {"param": "response_format", "message": "json_schema is unsupported"}},
        )
    )
    with pytest.raises(OpenAICompatibleStructuredOutputError):
        run_generate(structured)

    model = provider_with(
        lambda request: httpx.Response(400, json={"error": {"param": "model", "message": "bad model"}})
    )
    with pytest.raises(OpenAICompatibleModelError):
        run_generate(model)


def test_missing_key_stops_before_transport_and_secrets_are_redacted():
    missing = provider_with(lambda request: pytest.fail("HTTP should not run"), api_key=None)
    with pytest.raises(OpenAICompatibleAuthNotConfiguredError):
        run_generate(missing)

    leaking_upstream = provider_with(
        lambda request: httpx.Response(401, json={"error": {"message": f"rejected {SECRET}"}})
    )
    with pytest.raises(OpenAICompatibleAuthError) as caught:
        run_generate(leaking_upstream)
    assert SECRET not in str(caught.value)
    assert SECRET not in repr(leaking_upstream._api_key)


def test_gateway_to_openai_compatible_uses_shared_validator():
    transport = httpx.MockTransport(lambda request: response())
    registry = {
        **DEFAULT_REGISTRY,
        "openai_compatible": lambda config: OpenAICompatibleProvider(
            config.base_url,
            config.model,
            SecretStr(SECRET),
            transport,
        ),
    }
    gateway = LLMGateway(
        ProviderConfig(type="openai_compatible", base_url=BASE_URL, model=MODEL),
        registry=registry,
    )
    result = asyncio.run(
        gateway.generate_reply("system", [ChatMessage(role="user", content="hello")], SCHEMA)
    )
    assert result.error is None
    assert result.reply.beats[0].text == "Hey!"
    assert result.reply.beats[0].emotion == "happy"


def test_default_generic_secret_environment_variable():
    config = load_provider_config(
        {
            "COURTROOM_LLM_PROVIDER": "openai_compatible",
            "COURTROOM_LLM_BASE_URL": BASE_URL,
            "COURTROOM_LLM_MODEL": MODEL,
            "COURTROOM_LLM_API_KEY": SECRET,
        }
    )
    assert config.api_key_env == "COURTROOM_LLM_API_KEY"
    assert config.resolve_api_key({"COURTROOM_LLM_API_KEY": SECRET}).get_secret_value() == SECRET
    assert SECRET not in json.dumps(config.public_info())


def test_backend_status_test_and_active_profile_do_not_expose_or_store_secret(monkeypatch, maya):
    monkeypatch.setenv("TEST_OPENAI_KEY", SECRET)
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return response()

    transport = httpx.MockTransport(handler)
    registry = {
        **DEFAULT_REGISTRY,
        "openai_compatible": lambda config: OpenAICompatibleProvider(
            config.base_url,
            config.model,
            config.resolve_api_key(),
            transport,
        ),
    }
    app = create_app(
        ProviderConfig(type="fake", api_key_env="TEST_OPENAI_KEY"),
        provider_registry=registry,
    )
    client = TestClient(app)

    status = client.get("/api/providers/openai-compatible/status")
    assert status.json() == {"apiKeyConfigured": True}

    tested = client.post(
        "/api/providers/openai-compatible/test",
        json={"baseUrl": f"{BASE_URL}/", "model": MODEL, "character": maya.id},
    )
    assert tested.status_code == 200
    assert tested.json() == {
        "status": "generation_succeeded",
        "apiKeyConfigured": True,
        "generationSucceeded": True,
    }
    assert app.state.character_service._sessions == {}

    from app.configuration.profiles import ProfileDraft
    selected = app.state.provider_profiles.store.create(ProfileDraft(
        name="Compatible", provider_type="openai_compatible", base_url=BASE_URL, model=MODEL,
        api_key_env="TEST_OPENAI_KEY",
    ))
    app.state.provider_profiles.store.activate(selected.id)
    chat = client.post(
        "/api/chat",
        json={
            "character": maya.id,
            "message": "hello",
            "sessionId": "compatible-test",
        },
    )
    assert chat.status_code == 200
    assert chat.json()["provider"]["type"] == "openai_compatible"
    assert chat.json()["performance"]["segments"][0]["text"] == "Hey!"
    assert SECRET not in json.dumps(tested.json())
    assert SECRET not in json.dumps(chat.json())
    assert all(call.headers["authorization"] == f"Bearer {SECRET}" for call in calls)


@pytest.mark.parametrize(
    ("upstream", "expected"),
    [
        (httpx.Response(401, json={"error": {"message": "bad key"}}), "auth_failed"),
        (httpx.Response(429, json={"error": {"message": "limited"}}), "rate_limited"),
        (httpx.Response(404, json={"error": {"message": "model"}}), "model_error"),
        (
            httpx.Response(400, json={"error": {"param": "response_format", "message": "unsupported"}}),
            "structured_output_failed",
        ),
    ],
)
def test_connection_endpoint_distinguishes_provider_failures(monkeypatch, maya, upstream, expected):
    monkeypatch.setenv("TEST_OPENAI_KEY", SECRET)
    transport = httpx.MockTransport(lambda request: upstream)
    registry = {
        **DEFAULT_REGISTRY,
        "openai_compatible": lambda config: OpenAICompatibleProvider(
            config.base_url,
            config.model,
            config.resolve_api_key(),
            transport,
        ),
    }
    client = TestClient(
        create_app(
            ProviderConfig(type="fake", api_key_env="TEST_OPENAI_KEY"),
            provider_registry=registry,
        )
    )
    result = client.post(
        "/api/providers/openai-compatible/test",
        json={"baseUrl": BASE_URL, "model": MODEL, "character": maya.id},
    )
    assert result.status_code == 200
    assert result.json()["status"] == expected
    assert SECRET not in json.dumps(result.json())


def test_connection_endpoint_reports_missing_key_and_invalid_url(monkeypatch, maya):
    monkeypatch.delenv("MISSING_OPENAI_KEY", raising=False)
    app = create_app(ProviderConfig(type="fake", api_key_env="MISSING_OPENAI_KEY"))
    client = TestClient(app)
    missing = client.post(
        "/api/providers/openai-compatible/test",
        json={"baseUrl": BASE_URL, "model": MODEL, "character": maya.id},
    )
    assert missing.status_code == 200
    assert missing.json()["status"] == "auth_not_configured"
    assert missing.json()["apiKeyConfigured"] is False

    invalid = client.post(
        "/api/providers/openai-compatible/test",
        json={"baseUrl": "not a URL", "model": MODEL, "character": maya.id},
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"] == {
        "code": "invalid_base_url",
        "message": "Invalid OpenAI-compatible base URL.",
    }


@pytest.mark.parametrize(
    ("handler", "expected"),
    [
        (
            lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=request)),
            "timeout",
        ),
        (
            lambda request: (_ for _ in ()).throw(httpx.ConnectError("refused", request=request)),
            "unreachable",
        ),
        (
            lambda request: response('{"beats":[]}'),
            "structured_output_failed",
        ),
    ],
)
def test_connection_endpoint_distinguishes_transport_and_validation_failures(
    monkeypatch,
    maya,
    handler,
    expected,
):
    monkeypatch.setenv("TEST_OPENAI_KEY", SECRET)
    transport = httpx.MockTransport(handler)
    registry = {
        **DEFAULT_REGISTRY,
        "openai_compatible": lambda config: OpenAICompatibleProvider(
            config.base_url,
            config.model,
            config.resolve_api_key(),
            transport,
        ),
    }
    client = TestClient(
        create_app(
            ProviderConfig(type="fake", api_key_env="TEST_OPENAI_KEY"),
            provider_registry=registry,
        )
    )
    result = client.post(
        "/api/providers/openai-compatible/test",
        json={"baseUrl": BASE_URL, "model": MODEL, "character": maya.id},
    )
    assert result.status_code == 200
    assert result.json()["status"] == expected
