"""HTTP API. Model output is returned only as validated, logical data."""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..characters.prompt import build_system_prompt, reply_schema
from ..characters.repository import CharacterNotFoundError
from ..characters.service import CharacterService
from ..llm.base import ProviderError
from ..llm.config import DEFAULT_OLLAMA_BASE_URL, ProviderConfig
from ..llm.gateway import LLMGateway
from ..llm.providers.ollama import OllamaProvider
from ..llm.schemas import ChatMessage

router = APIRouter(prefix="/api")

ID_PATTERN = r"^[a-z0-9_]{1,64}$"


class ProviderSelection(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    type: Literal["fake", "ollama"]
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=2048)
    model: str | None = Field(default=None, max_length=200)


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character: str = Field(pattern=ID_PATTERN)
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(default="default", alias="sessionId", pattern=r"^[A-Za-z0-9_-]{1,64}$")
    provider: ProviderSelection | None = None


class OllamaConnectionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_url: str = Field(default=DEFAULT_OLLAMA_BASE_URL, alias="baseUrl", max_length=2048)
    model: str = Field(min_length=1, max_length=200)
    character: str = Field(pattern=ID_PATTERN)


def _service(request: Request) -> CharacterService:
    return request.app.state.character_service


def _config(
    service: CharacterService,
    provider_type: Literal["fake", "ollama"],
    base_url: str | None = None,
    model: str | None = None,
) -> ProviderConfig:
    try:
        return ProviderConfig(
            type=provider_type,
            base_url=base_url,
            model=model,
            settings=service.gateway.config.settings,
        )
    except ValidationError as error:
        detail = {
            "code": "invalid_base_url" if provider_type == "ollama" else "invalid_provider_configuration",
            "message": "Invalid Ollama server URL."
            if provider_type == "ollama"
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
    return {"status": "ok", "provider": service.gateway.info(), "characters": service.repository.ids()}


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


@router.post("/chat")
async def chat(body: ChatRequest, request: Request) -> dict[str, Any]:
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="message is empty")
    service = _service(request)
    gateway = None
    if body.provider is not None:
        if body.provider.type == "ollama" and not body.provider.model:
            raise HTTPException(status_code=422, detail="an Ollama model must be selected")
        config = _config(service, body.provider.type, body.provider.base_url, body.provider.model)
        gateway = _gateway(service, config)
    try:
        result = await service.chat(body.character, body.message.strip(), body.session_id, gateway=gateway)
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None
    return {
        # Raw semantic reply (validated), separate from the director's resolved performance.
        "reply": result.reply.model_dump(by_alias=True) if result.reply else None,
        "performance": result.performance,
        "provider": result.provider,
        "warnings": result.warnings,
    }
