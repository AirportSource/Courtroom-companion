"""Native Anthropic transport/profile integration; no cloud or OS-vault access."""

import asyncio
from copy import deepcopy
import json
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.characters.prompt import build_system_prompt, reply_schema
from app.configuration.credentials import KeyringCredentialStore
from app.configuration.profiles import ProfileDraft, ProfileStore
from app.llm.base import GenerationRequest, GenerationSettings, StructuredOutputMode
from app.llm.config import ProviderConfig, load_provider_config
from app.llm.gateway import DEFAULT_REGISTRY, LLMGateway
from app.llm.providers.anthropic import API_VERSION, MESSAGES_URL, AnthropicError, AnthropicProvider, native_output_schema
from app.llm.providers.fake import FakeProvider
from app.llm.providers.ollama import OllamaProvider
from app.llm.providers.openai_compatible import OpenAICompatibleProvider
from app.llm.schemas import ChatMessage
from app.main import create_app

MODEL = "claude-test-model"
SECRET = "synthetic-anthropic-key-not-a-real-key"
REPLACEMENT = "synthetic-replacement-not-a-real-key"
HIDDEN = "synthetic-hidden-thinking-must-not-escape"
VALID = json.dumps({
    "beats": [
        {"text": "Hey! I'm glad you're here!", "emotion": "happy", "intensity": 0.5},
        {"text": "Let's think this through together.", "emotion": "thinking", "intensity": 0.4},
    ], "settleEmotion": "neutral",
})
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["beats"],
          "properties": {"beats": {"type": "array", "items": {"type": "string"}}}}


def request(schema=None, system="shared system prompt"):
    return GenerationRequest(system, [
        ChatMessage(role="user", content="Bonjour !"),
        ChatMessage(role="assistant", content=VALID),
        ChatMessage(role="user", content="今日はどう？"),
    ], schema if schema is not None else SCHEMA, GenerationSettings(temperature=0.2, max_tokens=345, timeout_s=5))


def response(content=VALID, **changes):
    return httpx.Response(200, json={
        "type": "message", "role": "assistant", "model": MODEL, "stop_reason": "end_turn",
        "content": content if isinstance(content, list) else [{"type": "text", "text": content}],
        "usage": {"input_tokens": 20, "output_tokens": 30}, **changes,
    })


def provider(handler, key=SecretStr(SECRET), model=MODEL):
    return AnthropicProvider(model, key, httpx.MockTransport(handler))


def generate(instance, generation_request=None):
    return asyncio.run(instance.generate(generation_request or request()))


def test_registration_and_existing_provider_regressions():
    gateway = LLMGateway(ProviderConfig(type="anthropic", model=MODEL))
    assert isinstance(gateway.provider, AnthropicProvider)
    assert gateway.provider.capabilities.structured_output == StructuredOutputMode.NATIVE
    assert gateway.info()["capabilities"] == {"structuredOutput": "native", "streaming": True, "toolCalling": False}
    assert isinstance(LLMGateway(ProviderConfig()).provider, FakeProvider)
    assert isinstance(LLMGateway(ProviderConfig(type="ollama")).provider, OllamaProvider)
    assert isinstance(LLMGateway(ProviderConfig(type="openai_compatible")).provider, OpenAICompatibleProvider)


def test_native_request_mapping_and_supported_schema_forwarding():
    calls = []
    def handle(upstream):
        calls.append(upstream)
        return response()
    raw = generate(provider(handle))
    upstream = calls[0]
    assert upstream.method == "POST" and str(upstream.url) == MESSAGES_URL
    assert upstream.headers["authorization"] == f"Bearer {SECRET}"
    assert upstream.headers["anthropic-version"] == API_VERSION == "2026-10-21"
    assert upstream.headers["content-type"] == "application/json"
    body = json.loads(upstream.content)
    assert body["model"] == MODEL and body["stream"] is False and body["max_tokens"] == 345
    assert body["system"] == request().system_prompt
    assert body["messages"] == [message.model_dump() for message in request().messages]
    assert body["output_config"] == {"format": {"type": "json_schema", "schema": SCHEMA}}
    assert all(key not in body for key in ("temperature", "top_p", "top_k", "tools", "thinking"))
    assert upstream.extensions["timeout"]["read"] == 5
    assert raw.content == VALID and raw.model == MODEL
    assert raw.metadata == {"stop_reason": "end_turn", "usage": {"input_tokens": 20, "output_tokens": 30}}


def test_shared_schema_projection_preserves_contract_and_original(maya):
    original = reply_schema(maya)
    saved = deepcopy(original)
    native = native_output_schema(original)
    assert original == saved
    assert native["required"] == original["required"]
    assert native["additionalProperties"] is False
    beats = native["properties"]["beats"]
    assert beats["minItems"] == 1 and "maxItems" not in beats
    assert f'"maxItems": {maya.director.max_beats_per_reply}' in beats["description"]
    properties = beats["items"]["properties"]
    assert properties["emotion"]["enum"] == original["properties"]["beats"]["items"]["properties"]["emotion"]["enum"]
    assert properties["reaction"] == original["properties"]["beats"]["items"]["properties"]["reaction"]
    assert "maxLength" not in properties["text"] and '"maxLength": 600' in properties["text"]["description"]
    assert '"minimum": 0' in properties["intensity"]["description"]
    assert '"maximum": 1' in properties["intensity"]["description"]
    # Property names and enum values resembling schema keywords are data, not keywords.
    special = {"type": "object", "properties": {"maximum": {"type": "number", "maximum": 1}},
               "additionalProperties": False}
    assert "maximum" in native_output_schema(special)["properties"]
    calls = []
    generate(provider(lambda upstream: (calls.append(upstream), response())[1]), request(original, build_system_prompt(maya)))
    sent = json.loads(calls[0].content)
    assert json.dumps(saved) in sent["system"]  # Full original contract remains in the common prompt.
    assert sent["output_config"]["format"]["schema"] == native


def test_extracts_only_final_text_and_never_thinking():
    midpoint = len(VALID) // 2
    raw = generate(provider(lambda upstream: response(content=[
        {"type": "thinking", "thinking": HIDDEN, "signature": HIDDEN},
        {"type": "text", "text": VALID[:midpoint]},
        {"type": "redacted_thinking", "data": HIDDEN},
        {"type": "text", "text": VALID[midpoint:]},
    ])))
    assert raw.content == VALID
    assert HIDDEN not in repr(raw)


@pytest.mark.parametrize(("status", "error_body", "expected"), [
    (401, {}, "auth_failed"), (403, {}, "auth_failed"), (429, {}, "rate_limited"),
    (404, {}, "model_error"), (400, {"message": "unknown model"}, "model_error"),
    (400, {"message": "output_config schema is unsupported"}, "structured_output_unsupported"),
    (422, {"message": "json_schema unsupported"}, "structured_output_unsupported"),
    (400, {"message": "invalid request"}, "invalid_provider_configuration"),
    (500, {}, "provider_http_error"), (529, {}, "provider_http_error"),
])
def test_http_errors_are_typed_and_sanitized(status, error_body, expected):
    with pytest.raises(AnthropicError) as caught:
        generate(provider(lambda upstream: httpx.Response(status, json={"error": {**error_body, "secret": SECRET}})))
    assert caught.value.code == expected
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize(("failure", "expected"), [
    (httpx.ConnectError(SECRET), "anthropic_unreachable"),
    (httpx.ReadTimeout(SECRET), "timeout"),
    (httpx.ConnectTimeout(SECRET), "timeout"),
])
def test_transport_failure_redaction(failure, expected):
    def fail(upstream):
        raise failure
    with pytest.raises(AnthropicError) as caught:
        generate(provider(fail))
    assert caught.value.code == expected
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize(("changes", "expected"), [
    ({"type": "error"}, "malformed_response"),
    ({"role": "user"}, "malformed_response"),
    ({"stop_reason": None}, "malformed_response"),
    ({"stop_reason": "tool_use"}, "malformed_response"),
    ({"stop_reason": "refusal"}, "provider_refused"),
    ({"stop_reason": "max_tokens"}, "response_truncated"),
    ({"stop_reason": "model_context_window_exceeded"}, "response_truncated"),
    ({"content": None}, "malformed_response"),
    ({"content": {}}, "malformed_response"),
    ({"content": [None]}, "malformed_response"),
    ({"content": [{"type": "text"}]}, "malformed_response"),
    ({"content": [{"type": "text", "text": 12}]}, "malformed_response"),
    ({"content": [{"type": "tool_use", "input": {}}]}, "malformed_response"),
    ({"content": []}, "empty_output"),
    ({"content": [{"type": "thinking", "thinking": HIDDEN}]}, "empty_output"),
    ({"content": [{"type": "text", "text": "   "}]}, "empty_output"),
])
def test_invalid_or_empty_native_responses(changes, expected):
    with pytest.raises(AnthropicError) as caught:
        generate(provider(lambda upstream: response(**changes)))
    assert caught.value.code == expected


@pytest.mark.parametrize("upstream", [httpx.Response(200, text="not JSON"), httpx.Response(200, json=[]), httpx.Response(200, json={})])
def test_malformed_http_body(upstream):
    with pytest.raises(AnthropicError) as caught:
        generate(provider(lambda _: upstream))
    assert caught.value.code == "malformed_response"


@pytest.mark.parametrize(("key", "model", "expected"), [(None, MODEL, "auth_not_configured"), (SecretStr(""), MODEL, "auth_not_configured"), (SecretStr(SECRET), None, "model_error")])
def test_missing_configuration_does_not_call_network(key, model, expected):
    def forbidden(upstream):
        pytest.fail("missing configuration must fail before HTTP")
    with pytest.raises(AnthropicError) as caught:
        generate(provider(forbidden, key, model))
    assert caught.value.code == expected


def test_gateway_uses_shared_repair_and_validation(maya):
    contents = iter([VALID, '{"beats":[]}'])
    registry = {**DEFAULT_REGISTRY, "anthropic": lambda config: provider(lambda upstream: response(next(contents)))}
    gateway = LLMGateway(ProviderConfig(type="anthropic", model=MODEL), registry)
    result = asyncio.run(gateway.generate_reply(build_system_prompt(maya), request().messages, reply_schema(maya)))
    assert result.reply.beats[0].emotion == "happy"
    invalid = asyncio.run(gateway.generate_reply(build_system_prompt(maya), request().messages, reply_schema(maya)))
    assert invalid.reply is None and invalid.error == "invalid_reply"


@pytest.mark.parametrize("model,base_url", [(None, None), ("  ", None), (MODEL, "https://proxy.example")])
def test_native_profile_requires_model_and_no_endpoint(model, base_url):
    with pytest.raises(ValidationError):
        ProfileDraft(name="Native", provider_type="anthropic", model=model, base_url=base_url)


@pytest.fixture
def native_api(tmp_path, monkeypatch):
    monkeypatch.delenv("TEST_NATIVE_KEY", raising=False)
    values, calls = {}, []
    backend = Mock()
    backend.get_password.side_effect = lambda service, ref: values.get(ref)
    backend.set_password.side_effect = lambda service, ref, value: values.update({ref: value})
    backend.delete_password.side_effect = lambda service, ref: values.pop(ref, None)
    credentials = KeyringCredentialStore(backend)
    upstream = {"response": response(content=[{"type": "thinking", "thinking": HIDDEN}, {"type": "text", "text": VALID}])}
    def handle(http_request):
        calls.append(http_request)
        item = upstream["response"]
        if isinstance(item, Exception):
            raise item
        return item
    registry = {**DEFAULT_REGISTRY, "anthropic": lambda config: AnthropicProvider(
        config.model, config.resolve_api_key(), httpx.MockTransport(handle))}
    config = ProviderConfig()
    store = ProfileStore(tmp_path / "profiles.json", config)
    app = create_app(config, profile_store=store, credential_store=credentials, provider_registry=registry)
    client = TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000))
    saved = client.post("/api/provider-profiles", json={"name": "Claude", "providerType": "anthropic", "model": MODEL, "apiKeyEnv": "TEST_NATIVE_KEY"})
    assert saved.status_code == 201
    profile = saved.json()
    assert profile["baseUrl"] is None and profile["credentialRef"] == f"courtroom:profile:{profile['id']}"
    root = f"/api/provider-profiles/{profile['id']}"
    return client, store, calls, upstream, root


def test_native_profile_credential_reuse_active_chat_and_history(native_api, maya, caplog):
    client, store, calls, upstream, root = native_api
    assert client.put(f"{root}/credential", json={"secret": SECRET}).json()["credentialConfigured"] is True
    tested = client.post(f"{root}/test", json={"character": maya.id})
    assert tested.json()["status"] == "generation_succeeded"
    assert client.app.state.character_service._sessions == {}
    assert calls[-1].headers["authorization"] == f"Bearer {SECRET}"
    assert maya.personality.strip() in json.loads(calls[-1].content)["system"]
    client.post(f"{root}/activate")
    chat = client.post("/api/chat", json={"character": maya.id, "message": "Hello!", "sessionId": "native"})
    assert chat.json()["provider"]["type"] == "anthropic"
    assert [beat["emotion"] for beat in chat.json()["reply"]["beats"]] == ["happy", "thinking"]
    assert chat.json()["performance"]["segments"][0]["text"] == "Hey! I'm glad you're here!"
    fake = next(profile for profile in store.snapshot().profiles if profile.provider_type == "fake")
    client.post(f"/api/provider-profiles/{fake.id}/activate")
    client.post(f"{root}/activate")
    assert client.get(f"{root}/credential").json()["credentialConfigured"] is True
    client.post("/api/chat", json={"character": maya.id, "message": "日本語で話そう。", "sessionId": "native"})
    sent = json.loads(calls[-1].content)["messages"]
    assert [item["role"] for item in sent] == ["user", "assistant", "user"]
    assert sent[-1]["content"] == "日本語で話そう。"
    for forbidden in (SECRET, HIDDEN):
        assert forbidden not in json.dumps(sent)
        assert forbidden not in tested.text and forbidden not in chat.text
        assert forbidden not in caplog.text and forbidden not in store.path.read_text()
    client.put(f"{root}/credential", json={"secret": REPLACEMENT})
    client.post(f"{root}/test", json={"character": maya.id})
    assert calls[-1].headers["authorization"] == f"Bearer {REPLACEMENT}"
    assert client.delete(f"{root}/credential").json()["credentialConfigured"] is False
    call_count = len(calls)
    assert client.post(f"{root}/test", json={"character": maya.id}).json()["status"] == "auth_not_configured"
    assert len(calls) == call_count


@pytest.mark.parametrize("upstream,expected", [
    (httpx.Response(401, json={"error": {"message": SECRET}}), "auth_failed"),
    (httpx.Response(403, json={"error": {"message": SECRET}}), "auth_failed"),
    (httpx.Response(429), "rate_limited"), (httpx.Response(404), "model_error"),
    (httpx.ReadTimeout(SECRET), "timeout"),
    (httpx.ConnectError(SECRET), "anthropic_unreachable"),
    (httpx.Response(200, text="not JSON"), "malformed_response"),
    (response(content=""), "empty_output"),
    (response(content='{"beats":[]}'), "structured_output_failed"),
    (httpx.Response(400, json={"error": {"message": "unsupported output_config schema"}}), "structured_output_failed"),
])
def test_profile_connection_distinguishes_errors_without_history(native_api, upstream, expected, caplog):
    client, store, calls, control, root = native_api
    control["response"] = upstream
    client.put(f"{root}/credential", json={"secret": SECRET})
    tested = client.post(f"{root}/test", json={"character": "maya_fey"})
    assert tested.json()["status"] == expected
    assert client.app.state.character_service._sessions == {}
    assert SECRET not in tested.text and SECRET not in caplog.text


def test_native_profile_environment_fallback_and_reload(tmp_path, monkeypatch):
    monkeypatch.setenv("TEST_NATIVE_KEY", SECRET)
    config = load_provider_config({"COURTROOM_LLM_PROVIDER": "anthropic", "COURTROOM_LLM_MODEL": MODEL,
                                   "COURTROOM_LLM_API_KEY_ENV": "TEST_NATIVE_KEY"})
    store = ProfileStore(tmp_path / "profiles.json", config)
    profile = ProfileStore(store.path, ProviderConfig()).get()
    assert profile.provider_type == "anthropic" and profile.base_url is None
    from app.configuration.profiles import ProfileManager
    credentials = KeyringCredentialStore(Mock(get_password=Mock(return_value=None)))
    manager = ProfileManager(store, credentials)
    assert manager.resolve(profile).resolve_api_key().get_secret_value() == SECRET
    assert manager.status(profile)["credentialConfigured"] is True
    assert SECRET not in store.path.read_text()
