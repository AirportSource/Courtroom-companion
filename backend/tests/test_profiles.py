"""Profiles and credentials are tested without the real OS vault or any network."""

import json
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.configuration.credentials import CredentialStoreError, KeyringCredentialStore
from app.configuration.profiles import ProfileDraft, ProfileManager, ProfileStore, ProfileStoreError
from app.llm.config import ProviderConfig
from app.llm.gateway import DEFAULT_REGISTRY
from app.llm.providers.openai_compatible import OpenAICompatibleProvider
from app.llm.providers.ollama import OllamaProvider
from app.main import create_app

SECRET = "synthetic-test-credential-do-not-use"
REPLACEMENT = "synthetic-replacement-do-not-use"
BASE_URL = "https://compatible.example/v1/"


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
def credentials():
    return KeyringCredentialStore(MockKeyring())


@pytest.fixture
def profiles(tmp_path, credentials):
    return ProfileManager(ProfileStore(tmp_path / "profiles.json", ProviderConfig()), credentials)


def cloud_draft(**overrides):
    return ProfileDraft(name="Cloud", provider_type="openai_compatible", base_url=BASE_URL,
                        model="chat-model", api_key_env="PROFILE_TEST_KEY", **overrides)


def test_credential_lifecycle_and_redacted_representation(credentials):
    ref = "courtroom:profile:test"
    assert credentials.get(ref) is None and not credentials.exists(ref)
    credentials.set(ref, SecretStr(SECRET))
    assert credentials.exists(ref)
    assert credentials.get(ref).get_secret_value() == SECRET
    assert SECRET not in repr(credentials.get(ref))
    credentials.set(ref, SecretStr(REPLACEMENT))
    assert credentials.get(ref).get_secret_value() == REPLACEMENT
    credentials.delete(ref)
    credentials.delete(ref)
    assert not credentials.exists(ref)


def test_vault_errors_never_echo_secret_or_backend_exception(caplog):
    class Broken:
        def get_password(self, *args):
            raise RuntimeError(SECRET)

        set_password = delete_password = get_password

    store = KeyringCredentialStore(Broken())
    for operation in [lambda: store.get("test"), lambda: store.set("test", SecretStr(SECRET)),
                      lambda: store.delete("test"), lambda: store.exists("test")]:
        with pytest.raises(CredentialStoreError) as caught:
            operation()
        assert SECRET not in str(caught.value)
    assert SECRET not in caplog.text


def test_plaintext_or_unknown_keyring_backend_is_rejected(monkeypatch):
    import keyring
    monkeypatch.setattr(keyring, "get_keyring", lambda: MockKeyring())
    with pytest.raises(CredentialStoreError):
        KeyringCredentialStore().set("test", SecretStr(SECRET))


def test_profile_create_edit_activate_duplicate_delete_reload(profiles):
    profile = profiles.store.create(cloud_draft())
    profiles.credentials.set(profile.credential_ref, SecretStr(SECRET))
    profiles.store.activate(profile.id)
    edited = ProfileDraft.model_validate(profile.model_dump(exclude={"id", "credential_ref"}))
    edited.name = "Renamed"
    profiles.store.update(profile.id, edited)
    duplicate = profiles.duplicate(profile.id)
    assert duplicate.id != profile.id and duplicate.credential_ref != profile.credential_ref
    assert profiles.credentials.get(duplicate.credential_ref).get_secret_value() == SECRET
    reloaded = ProfileStore(profiles.store.path, ProviderConfig())
    assert reloaded.get().id == profile.id
    assert reloaded.get().name == "Renamed"
    profiles.delete(duplicate.id)
    assert not profiles.credentials.exists(duplicate.credential_ref)
    assert profiles.credentials.exists(profile.credential_ref)
    profiles.delete(profile.id)
    assert profiles.store.get().provider_type == "fake"
    assert not profiles.credentials.exists(profile.credential_ref)
    with pytest.raises(ValueError):
        profiles.delete(profiles.store.get().id)


@pytest.mark.parametrize("values", [
    {"name": " ", "providerType": "fake"},
    {"name": "bad", "providerType": "anthropic"},
    {"name": "bad", "providerType": "ollama"},
    {"name": "bad", "providerType": "openai_compatible", "model": "x"},
    {"name": "bad", "providerType": "openai_compatible", "baseUrl": "file:///tmp/x", "model": "x"},
    {"name": "bad", "providerType": "openai_compatible", "baseUrl": "https://user:password@host", "model": "x"},
    {"name": "bad", "providerType": "openai_compatible", "baseUrl": "http://localhost:invalid", "model": "x"},
    {"name": "bad", "providerType": "openai_compatible", "baseUrl": "http://local host", "model": "x"},
    {"name": "bad", "providerType": "fake", "apiKeyEnv": "KEY"},
    {"name": "bad", "providerType": "ollama", "model": "qwen", "apiKeyEnv": "KEY"},
    {"name": "bad", "providerType": "fake", "secret": SECRET},
    {"name": "bad", "providerType": "fake", "credentialRef": "arbitrary"},
])
def test_profile_validation(values):
    with pytest.raises(ValidationError):
        ProfileDraft.model_validate(values)


def test_os_credential_then_environment_then_missing(profiles, monkeypatch):
    profile = profiles.store.create(cloud_draft())
    monkeypatch.setenv("PROFILE_TEST_KEY", REPLACEMENT)
    assert profiles.resolve(profile).resolve_api_key().get_secret_value() == REPLACEMENT
    profiles.credentials.set(profile.credential_ref, SecretStr(SECRET))
    config = profiles.resolve(profile)
    assert config.resolve_api_key().get_secret_value() == SECRET
    assert SECRET not in config.model_dump_json() and SECRET not in repr(config)
    assert SECRET not in json.dumps(profiles.public(profile))
    assert SECRET not in profiles.store.path.read_text()
    profiles.credentials.delete(profile.credential_ref)
    assert profiles.resolve(profile).resolve_api_key().get_secret_value() == REPLACEMENT
    monkeypatch.delenv("PROFILE_TEST_KEY")
    assert profiles.resolve(profile).resolve_api_key() is None
    assert profiles.status(profile)["credentialConfigured"] is False


def test_environment_works_when_vault_unavailable(profiles, monkeypatch):
    profile = profiles.store.create(cloud_draft())
    def unavailable(ref):
        raise CredentialStoreError()
    monkeypatch.setattr(profiles.credentials, "get", unavailable)
    monkeypatch.setenv("PROFILE_TEST_KEY", SECRET)
    assert profiles.resolve(profile).resolve_api_key().get_secret_value() == SECRET
    assert profiles.status(profile) == {"credentialConfigured": True, "storedCredentialConfigured": False,
                                       "credentialStoreAvailable": False}
    monkeypatch.delenv("PROFILE_TEST_KEY")
    with pytest.raises(CredentialStoreError):
        profiles.resolve(profile)


def test_ollama_and_fake_never_query_credentials(profiles, monkeypatch):
    def forbidden(ref):
        pytest.fail("local providers must not query a credential store")
    monkeypatch.setattr(profiles.credentials, "get", forbidden)
    for draft in [ProfileDraft(name="Offline", provider_type="fake"),
                  ProfileDraft(name="Local", provider_type="ollama", model="qwen:test")]:
        profile = profiles.store.create(draft)
        assert profiles.resolve(profile).resolve_api_key() is None


def test_atomic_write_failure_preserves_memory_and_disk(profiles, monkeypatch):
    before = profiles.store.path.read_bytes()
    def fail(*args):
        raise OSError("disk error")
    monkeypatch.setattr("app.configuration.profiles.os.replace", fail)
    with pytest.raises(ProfileStoreError):
        profiles.store.create(cloud_draft())
    assert profiles.store.path.read_bytes() == before
    assert len(profiles.store.snapshot().profiles) == 1
    assert list(profiles.store.path.parent.glob(".profiles-*")) == []


def test_concurrent_creates_are_not_lost(profiles):
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda index: profiles.store.create(ProfileDraft(name=str(index), provider_type="fake")), range(8)))
    assert len(profiles.store.snapshot().profiles) == 9
    assert len(ProfileStore(profiles.store.path, ProviderConfig()).snapshot().profiles) == 9


def test_invalid_persistence_is_preserved(tmp_path):
    path = tmp_path / "profiles.json"
    path.write_text("not valid JSON")
    with pytest.raises(ProfileStoreError):
        ProfileStore(path, ProviderConfig())
    assert path.read_text() == "not valid JSON"


def test_incomplete_environment_configuration_never_silently_selects_fake(tmp_path):
    with pytest.raises(ProfileStoreError):
        ProfileStore(tmp_path / "profiles.json", ProviderConfig(type="ollama"))


@pytest.fixture
def api(profiles):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({
            "beats": [{"text": "Hello!", "emotion": "happy", "intensity": 0.5}], "settleEmotion": "neutral",
        })}}]})
    registry = {**DEFAULT_REGISTRY, "openai_compatible": lambda config: OpenAICompatibleProvider(
        config.base_url, config.model, config.resolve_api_key(), httpx.MockTransport(respond))}
    app = create_app(ProviderConfig(), profile_store=profiles.store, credential_store=profiles.credentials,
                     provider_registry=registry)
    return TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)), profiles, calls


def create_cloud(client):
    response = client.post("/api/provider-profiles", json=cloud_draft().model_dump(by_alias=True))
    assert response.status_code == 201
    return response.json()["id"]


def test_api_credential_lifecycle_reload_switching_and_security(api, caplog):
    client, profiles, calls = api
    profile_id = create_cloud(client)
    root = f"/api/provider-profiles/{profile_id}"
    assert client.get(f"{root}/credential").json()["credentialConfigured"] is False
    responses = [client.put(f"{root}/credential", json={"secret": SECRET})]
    assert responses[-1].json()["credentialConfigured"] is True
    responses.append(client.post(f"{root}/activate"))
    tested = client.post(f"{root}/test", json={"character": "maya_fey"})
    responses.append(tested)
    assert tested.json()["generationSucceeded"] is True
    assert client.app.state.character_service._sessions == {}
    payload = json.loads(calls[-1].content)
    assert payload["model"] == "chat-model" and payload["stream"] is False
    assert payload["response_format"]["json_schema"]["schema"]["properties"]["beats"]
    assert str(calls[-1].url) == BASE_URL + "chat/completions"
    assert calls[-1].headers["authorization"] == f"Bearer {SECRET}"
    fake_id = next(item.id for item in profiles.store.snapshot().profiles if item.provider_type == "fake")
    client.post(f"/api/provider-profiles/{fake_id}/activate")
    assert client.post("/api/chat", json={"character": "maya_fey", "message": "Hello"}).json()["provider"]["type"] == "fake"
    client.post(f"{root}/activate")
    chat = client.post("/api/chat", json={"character": "maya_fey", "message": "Hello"})
    responses.append(chat)
    assert chat.json()["provider"]["type"] == "openai_compatible"
    assert chat.json()["performance"]["segments"][0]["text"] == "Hello!"
    assert len(calls) == 2
    assert client.post("/api/chat", json={"character": "maya_fey", "message": "Hello", "provider": {"type": "fake"}}).status_code == 409
    responses.append(client.put(f"{root}/credential", json={"secret": REPLACEMENT}))
    client.post(f"{root}/test", json={"character": "maya_fey"})
    assert calls[-1].headers["authorization"] == f"Bearer {REPLACEMENT}"
    # Recreating the app reloads metadata while the independently injected vault keeps the key.
    reloaded = TestClient(create_app(profile_store=ProfileStore(profiles.store.path, ProviderConfig()),
                                    credential_store=profiles.credentials), base_url="http://localhost", client=("127.0.0.1", 50000))
    assert reloaded.get(f"{root}/credential").json()["credentialConfigured"] is True
    responses.append(client.delete(f"{root}/credential"))
    assert responses[-1].json()["credentialConfigured"] is False
    missing = client.post(f"{root}/test", json={"character": "maya_fey"})
    responses.append(missing)
    assert missing.json()["status"] == "auth_not_configured"
    assert len(calls) == 3
    responses.append(client.get("/api/provider-profiles"))
    responses.append(client.put(f"{root}/credential", json={"secret": [SECRET]}))
    responses.append(client.put(f"{root}/credential", json={"secret": SECRET, "unexpected": SECRET}))
    assert responses[-1].status_code == responses[-2].status_code == 422
    for secret in [SECRET, REPLACEMENT]:
        assert all(secret not in response.text for response in responses)
        assert secret not in caplog.text
        assert secret not in profiles.store.path.read_text()
    assert all(response.headers.get("cache-control") == "no-store" for response in responses if "/provider-profiles" in str(response.url))


def test_api_profile_crud_and_provider_validation(api):
    client, profiles, _ = api
    profile_id = create_cloud(client)
    root = f"/api/provider-profiles/{profile_id}"
    client.put(f"{root}/credential", json={"secret": SECRET})
    draft = cloud_draft().model_dump(by_alias=True)
    draft["name"] = "Edited"
    assert client.put(root, json=draft).json()["name"] == "Edited"
    duplicate = client.post(f"{root}/duplicate").json()
    assert duplicate["id"] != profile_id and duplicate["credentialConfigured"] is True
    assert client.delete(f"/api/provider-profiles/{duplicate['id']}").status_code == 200
    assert client.delete(root).status_code == 200
    assert not profiles.credentials.exists(f"courtroom:profile:{profile_id}")
    assert client.get(f"{root}/credential").status_code == 404
    assert client.post("/api/provider-profiles", json={"name": "bad", "providerType": "ollama"}).status_code == 422
    fake = profiles.store.get()
    assert client.put(f"/api/provider-profiles/{fake.id}/credential", json={"secret": SECRET}).status_code == 422
    assert client.get(f"/api/provider-profiles/{fake.id}/models").status_code == 422
    assert client.delete(f"/api/provider-profiles/{fake.id}").status_code == 409


def test_configuration_api_requires_local_same_origin(api):
    client, _, _ = api
    assert client.get("/api/provider-profiles", headers={"host": "evil.example"}).status_code == 403
    assert client.post("/api/provider-profiles", headers={"origin": "https://evil.example"},
                       json={"name": "Bad", "providerType": "fake"}).status_code == 403
    assert client.get("/api/provider-profiles", headers={"origin": "http://localhost"}).status_code == 200
    assert client.get("/api/provider-profiles", headers={"origin": "http://localhost:5205", "sec-fetch-site": "same-origin"}).status_code == 200
    assert client.get("/api/provider-profiles", headers={"origin": "http://localhost:5205", "sec-fetch-site": "same-site"}).status_code == 403
    assert client.get("/api/provider-profiles", headers={"origin": "http://localhost:5205", "host": "127.0.0.1:8011", "sec-fetch-site": "same-origin"}).status_code == 200
    remote = TestClient(client.app, base_url="http://localhost", client=("192.0.2.1", 50000))
    assert remote.get("/api/provider-profiles").status_code == 403


def test_legacy_migration_once_preserves_values_and_active_selection(api):
    client, profiles, _ = api
    legacy = {"aiProvider": "ollama", "ollamaBaseUrl": "http://local:11434/", "ollamaModel": "qwen:custom",
              "openAICompatibleBaseUrl": BASE_URL, "openAICompatibleModel": "old-model"}
    first = client.post("/api/provider-profiles/import-legacy", json=legacy)
    assert first.status_code == 200
    active = profiles.store.get()
    assert active.provider_type == "ollama" and active.model == "qwen:custom"
    assert active.base_url == "http://local:11434"
    client.post("/api/provider-profiles/import-legacy", json=legacy)
    assert len(profiles.store.snapshot().profiles) == 3
    assert profiles.store.get().id == active.id


def test_environment_default_survives_browser_migration(tmp_path, credentials):
    config = ProviderConfig(type="openai_compatible", base_url=BASE_URL, model="environment-model", api_key_env="CI_KEY")
    store = ProfileStore(tmp_path / "environment.json", config)
    client = TestClient(create_app(config, profile_store=store, credential_store=credentials), base_url="http://localhost", client=("127.0.0.1", 50000))
    client.post("/api/provider-profiles/import-legacy", json={"aiProvider": "fake"})
    assert store.get().model == "environment-model" and store.get().api_key_env == "CI_KEY"


def test_incomplete_legacy_metadata_is_not_cleared_by_frontend(api):
    client, _, _ = api
    result = client.post("/api/provider-profiles/import-legacy", json={
        "aiProvider": "ollama", "ollamaBaseUrl": "http://custom-local:11434", "ollamaModel": "",
    })
    assert result.status_code == 200
    assert result.json()["migrationWarnings"]


def test_profile_scoped_ollama_discovery_and_connection(profiles, monkeypatch):
    monkeypatch.setenv("COURTROOM_LLM_API_KEY", SECRET)
    calls = []
    def respond(request):
        calls.append(request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen:test", "model": "qwen:test"}]})
        return httpx.Response(200, json={"message": {"content": json.dumps({
            "beats": [{"text": "Hi!", "emotion": "neutral"}],
        })}})
    registry = {**DEFAULT_REGISTRY, "ollama": lambda config: OllamaProvider(
        config.base_url, config.model, httpx.MockTransport(respond))}
    app = create_app(profile_store=profiles.store, credential_store=profiles.credentials, provider_registry=registry)
    client = TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000))
    draft = ProfileDraft(name="Local", provider_type="ollama", base_url="http://profiles.local:11434/", model="qwen:test")
    profile = profiles.store.create(draft)
    root = f"/api/provider-profiles/{profile.id}"
    assert client.get(f"{root}/models").json()["models"][0]["model"] == "qwen:test"
    assert str(calls[0].url) == "http://profiles.local:11434/api/tags"
    result = client.post(f"{root}/test", json={"character": "maya_fey"})
    assert result.json()["generationSucceeded"] is True
    assert json.loads(calls[-1].content)["model"] == "qwen:test"
    assert all("authorization" not in request.headers for request in calls)
    assert app.state.character_service._sessions == {}
    draft.model = "not-installed"
    profiles.store.update(profile.id, draft)
    missing = client.post(f"{root}/test", json={"character": "maya_fey"})
    assert missing.json()["status"] == "selected_model_missing"


def test_unavailable_credential_api_returns_sanitized_error(api, monkeypatch, caplog):
    client, profiles, _ = api
    profile_id = create_cloud(client)
    def unavailable(ref, secret):
        raise CredentialStoreError()
    monkeypatch.setattr(profiles.credentials, "set", unavailable)
    result = client.put(f"/api/provider-profiles/{profile_id}/credential", json={"secret": SECRET})
    assert result.status_code == 503
    assert result.json()["detail"]["code"] == "configuration_unavailable"
    assert SECRET not in result.text and SECRET not in caplog.text
