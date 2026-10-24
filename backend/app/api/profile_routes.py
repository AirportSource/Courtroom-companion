"""Local profile management. Credentials have write/delete/status endpoints only."""

from ipaddress import ip_address
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator
from starlette.concurrency import run_in_threadpool

from ..characters.prompt import build_system_prompt, reply_schema
from ..characters.repository import CharacterNotFoundError
from ..configuration.profiles import CREDENTIAL_PROVIDER_TYPES, ProfileDraft, ProfileManager
from ..llm.providers.ollama import OllamaProvider
from ..llm.config import DEFAULT_OLLAMA_BASE_URL
from ..llm.schemas import ChatMessage
from .routes import ID_PATTERN, _gateway, _raise_provider_http, _service
from ..llm.base import ProviderError


def loopback_host(host: str | None) -> bool:
    try:
        return host == "localhost" or ip_address(host or "").is_loopback
    except ValueError:
        return False


def local_configuration_request(request: Request) -> None:
    """Keep the local OS vault API off remote hosts and cross-origin web pages."""
    host = request.url.hostname
    local = loopback_host(host) and loopback_host(request.client.host if request.client else None)
    origin = request.headers.get("origin")
    origin_allowed = True
    if origin:
        try:
            parts = urlsplit(origin)
            # Vite forwards same-origin browser requests with its target's Host/port.
            origin_allowed = parts.scheme in {"http", "https"} and loopback_host(parts.hostname) and (
                parts.netloc == request.headers.get("host") or request.headers.get("sec-fetch-site") == "same-origin"
            )
        except ValueError:
            origin_allowed = False
    if not local or not origin_allowed or request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(status_code=403, detail="Local same-origin configuration access is required.")


router = APIRouter(prefix="/api/provider-profiles", dependencies=[Depends(local_configuration_request)])


def manager(request: Request) -> ProfileManager:
    return request.app.state.provider_profiles


class CredentialInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    secret: SecretStr = Field(min_length=1, max_length=4096)

    @field_validator("secret")
    @classmethod
    def nonempty(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("credential is empty")
        return value


class ConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    character: str = Field(pattern=ID_PATTERN)


class LegacySettings(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    ai_provider: str = Field(default="fake", alias="aiProvider", max_length=40)
    ollama_base_url: str | None = Field(default=None, alias="ollamaBaseUrl", max_length=2048)
    ollama_model: str | None = Field(default=None, alias="ollamaModel", max_length=200)
    compatible_base_url: str | None = Field(default=None, alias="openAICompatibleBaseUrl", max_length=2048)
    compatible_model: str | None = Field(default=None, alias="openAICompatibleModel", max_length=200)


@router.get("")
def list_profiles(request: Request) -> dict:
    return manager(request).catalog()


@router.post("/import-legacy")
def import_legacy(body: LegacySettings, request: Request) -> dict:
    profiles = manager(request)
    service = _service(request)
    warnings = []
    drafts = [ProfileDraft(name="Fake", provider_type="fake")]
    for kind, name, base_url, model in [
        ("ollama", "Ollama (imported)", body.ollama_base_url, body.ollama_model),
        ("openai_compatible", "Compatible (imported)", body.compatible_base_url, body.compatible_model),
    ]:
        if not base_url or not model:
            recovered = any(item.provider_type == kind and item.model and item.base_url == (base_url or "").rstrip("/")
                            for item in profiles.store.snapshot().profiles)
            meaningful = body.ai_provider == kind or (kind == "ollama" and base_url and base_url.rstrip("/") != DEFAULT_OLLAMA_BASE_URL) or (kind == "openai_compatible" and base_url)
            if meaningful and not recovered:
                warnings.append(f"The incomplete legacy {kind} settings were retained in browser storage for migration.")
            continue
        try:
            drafts.append(ProfileDraft(
                name=name, provider_type=kind, base_url=base_url, model=model,
                api_key_env=service.gateway.config.api_key_env if kind == "openai_compatible" else None,
                generation_settings=service.gateway.config.settings,
            ))
        except ValidationError:
            warnings.append(f"The legacy {kind} configuration needs correction in Settings.")
    preserve = service.gateway.config.type != "fake" or len(profiles.store.snapshot().profiles) > 1
    profiles.store.import_legacy(drafts, body.ai_provider, preserve)
    return {**profiles.catalog(), "migrationWarnings": warnings}


@router.post("", status_code=201)
def create_profile(body: ProfileDraft, request: Request) -> dict:
    if body.provider_type in CREDENTIAL_PROVIDER_TYPES and "api_key_env" not in body.model_fields_set:
        body.api_key_env = _service(request).gateway.config.api_key_env
    profiles = manager(request)
    return profiles.public(profiles.store.create(body))


@router.put("/{profile_id}")
def edit_profile(profile_id: str, body: ProfileDraft, request: Request) -> dict:
    profiles = manager(request)
    previous = profiles.store.get(profile_id)
    if previous.credential_ref and body.provider_type != previous.provider_type:
        profiles.credentials.delete(previous.credential_ref)
    return profiles.public(profiles.store.update(profile_id, body))


@router.post("/{profile_id}/duplicate", status_code=201)
def duplicate_profile(profile_id: str, request: Request) -> dict:
    profiles = manager(request)
    return profiles.public(profiles.duplicate(profile_id))


@router.delete("/{profile_id}")
def delete_profile(profile_id: str, request: Request) -> dict:
    profiles = manager(request)
    try:
        profiles.delete(profile_id)
    except ValueError:
        raise HTTPException(status_code=409, detail="Keep at least one AI profile.") from None
    return profiles.catalog()


@router.post("/{profile_id}/activate")
def activate_profile(profile_id: str, request: Request) -> dict:
    profiles = manager(request)
    profiles.store.activate(profile_id)
    return profiles.catalog()


def credential_profile(profile_id: str, request: Request):
    profiles = manager(request)
    profile = profiles.store.get(profile_id)
    if not profile.credential_ref:
        raise HTTPException(status_code=422, detail="This provider does not use an API key.")
    return profiles, profile


@router.get("/{profile_id}/credential")
def credential_status(profile_id: str, request: Request) -> dict:
    profiles, profile = credential_profile(profile_id, request)
    return profiles.status(profile)


@router.put("/{profile_id}/credential")
def set_credential(profile_id: str, body: CredentialInput, request: Request) -> dict:
    profiles, profile = credential_profile(profile_id, request)
    profiles.credentials.set(profile.credential_ref, body.secret)
    return profiles.status(profile)


@router.delete("/{profile_id}/credential")
def remove_credential(profile_id: str, request: Request) -> dict:
    profiles, profile = credential_profile(profile_id, request)
    profiles.credentials.delete(profile.credential_ref)
    return profiles.status(profile)


@router.get("/{profile_id}/models")
async def profile_models(profile_id: str, request: Request) -> dict:
    profiles = manager(request)
    profile = profiles.store.get(profile_id)
    if profile.provider_type != "ollama":
        raise HTTPException(status_code=422, detail="This profile does not support model discovery.")
    gateway = _gateway(_service(request), await run_in_threadpool(profiles.resolve, profile))
    if not isinstance(gateway.provider, OllamaProvider):
        raise HTTPException(status_code=503, detail="Model discovery is unavailable.")
    try:
        return {"models": await gateway.provider.list_models()}
    except ProviderError as error:
        _raise_provider_http(error)


@router.post("/{profile_id}/test")
async def test_profile(profile_id: str, body: ConnectionInput, request: Request) -> dict[str, Any]:
    profiles, service = manager(request), _service(request)
    profile = profiles.store.get(profile_id)
    gateway = _gateway(service, await run_in_threadpool(profiles.resolve, profile))
    try:
        character = service.repository.get(body.character)
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None
    if isinstance(gateway.provider, OllamaProvider):
        try:
            models = await gateway.provider.list_models()
        except ProviderError as error:
            _raise_provider_http(error)
        if not any(profile.model in {item["name"], item["model"]} for item in models):
            return {"status": "selected_model_missing", "generationSucceeded": False}
    result = await gateway.generate_reply(
        build_system_prompt(character),
        [ChatMessage(role="user", content="Reply with one short, friendly greeting for a connection test.")],
        reply_schema(character),
    )
    status = "generation_succeeded" if result.reply else {
        "invalid_reply": "structured_output_failed",
        "structured_output_unsupported": "structured_output_failed",
    }.get(result.error, result.error or "generation_failed")
    return {"status": status, "generationSucceeded": result.reply is not None,
            **profiles.status(profile)}
