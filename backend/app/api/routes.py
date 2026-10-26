"""HTTP API. Model output is returned only as validated, logical data."""

from typing import Any, Literal
import hashlib

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from ..characters.prompt import build_system_prompt, reply_schema
from ..characters.repository import CharacterNotFoundError, CharacterNotReadyError
from ..characters.service import CharacterService
from ..llm.attachments import MAX_BASE64_CHARS, EvidenceError, parse_evidence, record_text
from ..llm.base import ProviderError
from ..llm.config import DEFAULT_OLLAMA_BASE_URL, ProviderConfig
from ..llm.gateway import LLMGateway
from ..llm.providers.ollama import OllamaProvider
from ..llm.schemas import ChatMessage
from ..artifacts.turns import TurnCancelled, TurnConflict, request_fingerprint
from ..artifacts.store import ArtifactNotFound
from ..conversation_record.capture import capture_turn

router = APIRouter(prefix="/api")

ID_PATTERN = r"^[a-z0-9_]{1,64}$"
ProviderType = Literal["fake", "ollama", "openai_compatible", "anthropic", "claude_code", "codex"]


class ProviderSelection(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: ProviderType
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=2048)
    model: str | None = Field(default=None, max_length=200)


class EvidenceUpload(BaseModel):
    """A file presented as evidence; its kind is decided server-side from the bytes."""

    name: str = Field(min_length=1, max_length=255)
    data: str = Field(min_length=1, max_length=MAX_BASE64_CHARS)


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character: str = Field(pattern=ID_PATTERN)
    #: May be empty only when evidence is presented without a question.
    message: str = Field(default="", max_length=2000)
    evidence: EvidenceUpload | None = None
    #: Interface language (D-066): the character replies in it.
    language: Literal["en", "fr", "ja", "it", "es"] = "en"
    session_id: str = Field(default="default", alias="sessionId", pattern=r"^[A-Za-z0-9_-]{1,64}$")
    provider: ProviderSelection | None = None
    request_id: str | None = Field(default=None, alias="requestId",
        pattern=r"^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$")


class OllamaConnectionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_url: str = Field(default=DEFAULT_OLLAMA_BASE_URL, alias="baseUrl", max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    character: str = Field(pattern=ID_PATTERN)


class OpenAICompatibleConnectionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_url: str = Field(alias="baseUrl", min_length=1, max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    character: str = Field(pattern=ID_PATTERN)


def _service(request: Request) -> CharacterService:
    return request.app.state.character_service


def _config(
    service: CharacterService,
    provider_type: ProviderType,
    base_url: str | None = None,
    model: str | None = None,
) -> ProviderConfig:
    try:
        return ProviderConfig(
            type=provider_type,
            base_url=base_url,
            model=model,
            api_key_env=service.gateway.config.api_key_env,
            settings=service.gateway.config.settings,
        )
    except ValidationError as error:
        provider_label = {
            "ollama": "Ollama server",
            "openai_compatible": "OpenAI-compatible base",
        }.get(provider_type, "Provider")
        detail = {
            "code": "invalid_base_url" if provider_type != "fake" else "invalid_provider_configuration",
            "message": f"Invalid {provider_label} URL."
            if provider_type != "fake"
            else "Invalid provider configuration.",
        }
        raise HTTPException(status_code=422, detail=detail) from error


def _gateway(service: CharacterService, config: ProviderConfig) -> LLMGateway:
    return LLMGateway(config, registry=service.gateway.registry)


def _ollama_provider(service: CharacterService, base_url: str, model: str | None = None) -> tuple[LLMGateway, OllamaProvider]:
    gateway = _gateway(service, _config(service, "ollama", base_url, model))
    if not isinstance(gateway.provider, OllamaProvider):
        raise HTTPException(status_code=500, detail="Ollama provider is unavailable")
    return gateway, gateway.provider


def _raise_provider_http(error: ProviderError) -> None:
    status = {
        "ollama_unreachable": 503,
        "timeout": 504,
        "model_not_found": 404,
    }.get(error.code, 502)
    raise HTTPException(status_code=status, detail={"code": error.code, "message": str(error)}) from None


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    service = _service(request)
    profiles = request.app.state.provider_profiles
    active = _gateway(service, profiles.configuration(profiles.store.get()))
    return {"status": "ok", "provider": active.info(), "characters": service.repository.ids()}


@router.get("/characters/{character_id}/capabilities")
def capabilities(character_id: str, request: Request) -> dict[str, Any]:
    try:
        return _service(request).repository.get(character_id).capabilities()
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None


@router.get("/providers/ollama/models")
async def ollama_models(
    request: Request,
    base_url: str = Query(default=DEFAULT_OLLAMA_BASE_URL, alias="baseUrl", max_length=2048),
) -> dict[str, Any]:
    """Proxy Ollama model discovery; browsers never contact Ollama directly."""
    _, provider = _ollama_provider(_service(request), base_url)
    try:
        models = await provider.list_models()
    except ProviderError as error:
        _raise_provider_http(error)
    return {"status": "reachable", "models": models}


@router.post("/providers/ollama/test")
async def test_ollama_connection(body: OllamaConnectionRequest, request: Request) -> dict[str, Any]:
    """Discover models, then run one schema-constrained generation without session history."""
    service = _service(request)
    try:
        profile = service.repository.get(body.character)
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None

    gateway, provider = _ollama_provider(service, body.base_url, body.model)
    try:
        models = await provider.list_models()
    except ProviderError as error:
        _raise_provider_http(error)
    installed = any(body.model in {item["name"], item["model"]} for item in models)
    if not installed:
        return {
            "status": "selected_model_missing",
            "reachable": True,
            "modelsLoaded": True,
            "generationSucceeded": False,
            "models": models,
        }

    result = await gateway.generate_reply(
        build_system_prompt(profile),
        [ChatMessage(role="user", content="Reply with one short, friendly greeting for a connection test.")],
        reply_schema(profile),
    )
    if result.reply is None:
        return {
            "status": "generation_failed",
            "reachable": True,
            "modelsLoaded": True,
            "generationSucceeded": False,
            "error": result.error,
            "models": models,
        }
    return {
        "status": "generation_succeeded",
        "reachable": True,
        "modelsLoaded": True,
        "generationSucceeded": True,
        "models": models,
    }


@router.get("/providers/openai-compatible/status")
def openai_compatible_status(request: Request) -> dict[str, bool]:
    """Expose only whether the backend-managed generic API key is currently available."""
    configured = _service(request).gateway.config.resolve_api_key() is not None
    return {"apiKeyConfigured": configured}


@router.post("/providers/openai-compatible/test")
async def test_openai_compatible_connection(
    body: OpenAICompatibleConnectionRequest,
    request: Request,
) -> dict[str, Any]:
    """Run shared schema-constrained generation without touching conversation history."""
    service = _service(request)
    try:
        profile = service.repository.get(body.character)
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None

    gateway = _gateway(
        service,
        _config(service, "openai_compatible", body.base_url, body.model),
    )
    api_key_configured = gateway.config.resolve_api_key() is not None
    result = await gateway.generate_reply(
        build_system_prompt(profile),
        [ChatMessage(role="user", content="Reply with one short, friendly greeting for a connection test.")],
        reply_schema(profile),
    )
    if result.reply is not None:
        return {
            "status": "generation_succeeded",
            "apiKeyConfigured": api_key_configured,
            "generationSucceeded": True,
        }

    status = {
        "auth_not_configured": "auth_not_configured",
        "auth_failed": "auth_failed",
        "rate_limited": "rate_limited",
        "model_error": "model_error",
        "structured_output_unsupported": "structured_output_failed",
        "invalid_reply": "structured_output_failed",
        "timeout": "timeout",
        "openai_compatible_unreachable": "unreachable",
    }.get(result.error, "generation_failed")
    return {
        "status": status,
        "apiKeyConfigured": api_key_configured,
        "generationSucceeded": False,
        "error": result.error,
    }


@router.post("/chat")
async def chat(body: ChatRequest, request: Request) -> dict[str, Any]:
    message = body.message.strip()
    if not message and body.evidence is None:
        raise HTTPException(status_code=422, detail="message is empty")
    evidence = None
    if body.evidence is not None:
        try:
            evidence = parse_evidence(body.evidence.name, body.evidence.data)
        except EvidenceError as error:
            raise HTTPException(status_code=422, detail={"code": error.code, "message": str(error)}) from None
    # Replays of one request id must present the same file too.
    fingerprint_text = f"{message} [evidence sha256 {evidence.sha256}]" if evidence else message
    user_record = record_text(evidence, message) if evidence else message
    service = _service(request)
    if body.provider is not None:
        raise HTTPException(status_code=409, detail="Select a saved provider profile before chatting.")
    task = None
    async def perform(turn=None):
        profiles = request.app.state.provider_profiles
        config = await run_in_threadpool(profiles.resolve, profiles.store.get())
        gateway = _gateway(service, config)
        options = {}
        if turn is not None:
            options = {"artifact_store": request.app.state.artifact_store,
                "operation_key": hashlib.sha256(f"{body.session_id}:{body.character}:{turn.id}".encode()).hexdigest(),
                "fingerprint": request_fingerprint(body.character, fingerprint_text, body.session_id),
                "on_artifact_working": turn.artifact_working,
                "on_expected_workload": turn.set_expected_workload}
        result = await service.chat(body.character, message, body.session_id, gateway=gateway,
                                    evidence=evidence, language=body.language,
                                    tool_context=request.app.state.tools, **options)
        capture_turn(request.app, body.character, user_record, result, turn.id if turn else None)
        return result
    try:
        if body.request_id:
            # Legacy dialogue-only requests retain their contract. Artifact-capable turns require
            # the same local/same-origin boundary used by profile and music configuration.
            from .profile_routes import local_configuration_request
            local_configuration_request(request)
            result, task = await request.app.state.artifact_turns.run(body.request_id,
                request_fingerprint(body.character, fingerprint_text, body.session_id), perform)
            for artifact in result.artifacts:
                try:
                    available = request.app.state.artifact_store.get(artifact["id"])["status"] == "ready"
                except ArtifactNotFound:
                    available = False
                if not available:
                    request.app.state.artifact_turns.invalidate_artifact(artifact["id"])
                    raise TurnConflict()
        else:
            result = await perform()
    except CharacterNotReadyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from None
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None
    except TurnConflict:
        raise HTTPException(status_code=409, detail="Request ID already used or too many running turns.") from None
    except TurnCancelled:
        raise HTTPException(status_code=409, detail="This turn was cancelled.") from None
    return {
        # Raw semantic reply (validated), separate from the director's resolved performance.
        "reply": result.reply.model_dump(by_alias=True) if result.reply else None,
        "performance": result.performance,
        "provider": result.provider,
        "warnings": result.warnings,
        "generation": result.generation,
        "tool": result.tool,
        **({"task": task, "artifacts": result.artifacts} if task else {}),
    }
