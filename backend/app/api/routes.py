"""HTTP API. Model output is returned only as validated, logical data."""

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from ..characters.repository import CharacterNotFoundError
from ..characters.service import CharacterService

router = APIRouter(prefix="/api")

ID_PATTERN = r"^[a-z0-9_]{1,64}$"


class ChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    character: str = Field(pattern=ID_PATTERN)
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(default="default", alias="sessionId", pattern=r"^[A-Za-z0-9_-]{1,64}$")


def _service(request: Request) -> CharacterService:
    return request.app.state.character_service


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


@router.post("/chat")
async def chat(body: ChatRequest, request: Request) -> dict[str, Any]:
    if not body.message.strip():
        raise HTTPException(status_code=422, detail="message is empty")
    try:
        result = await _service(request).chat(body.character, body.message.strip(), body.session_id)
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None
    return {
        # Raw semantic reply (validated), separate from the director's resolved performance.
        "reply": result.reply.model_dump(by_alias=True) if result.reply else None,
        "performance": result.performance,
        "provider": result.provider,
        "warnings": result.warnings,
    }
