"""Approved character knowledge API (Character Lore Builder Phase D, D-102). Local, same-origin only.

- POST /api/documents/analyses/{id}/approval: apply the user's review of a proposal to the overlay
- GET /api/characters/{id}/knowledge: approved items, sources, rendered additions, context size
- DELETE /api/characters/{id}/knowledge/items/{item}: remove one approved item
- DELETE /api/characters/{id}/knowledge?confirm=true: factory reset (back to the built-in pack)
- GET /api/characters/{id}/knowledge/export: effective lore/personality as Markdown text (for an
  explicit developer export; nothing is written into the pack)

Every change invalidates the character's cached profile, so the next chat turn uses it.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field

from ..characters.prompt import build_system_prompt, context_size
from ..characters.repository import CharacterNotFoundError, CharacterProfile, CharacterRepository
from ..lore.approval import ApprovalError, apply_approval
from ..lore.jobs import AnalysisNotFoundError, AnalysisJobs
from ..lore.knowledge import InvalidCharacterIdError, KnowledgeStoreError, render_lore, render_personality
from .profile_routes import local_configuration_request


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api", dependencies=[Depends(local_configuration_request), Depends(_no_store)])


def repository(request: Request) -> CharacterRepository:
    return request.app.state.character_service.repository


def _profile(request: Request, character_id: str) -> CharacterProfile:
    try:
        return repository(request).get(character_id)
    except CharacterNotFoundError:
        raise HTTPException(404, "Unknown character.") from None


def _store_error(error: Exception) -> HTTPException:
    if isinstance(error, InvalidCharacterIdError):
        return HTTPException(404, "Unknown character.")
    return HTTPException(503, {"code": "knowledge_unavailable", "message": str(error)})


def _state(request: Request, character_id: str) -> dict:
    repo = repository(request)
    try:
        knowledge = repo.knowledge_store().load(character_id)
    except (KnowledgeStoreError, InvalidCharacterIdError) as error:
        raise _store_error(error) from None
    profile = _profile(request, character_id)
    body = knowledge.model_dump(by_alias=True, mode="json")
    body["rendered"] = {"lore": render_lore(knowledge), "personality": render_personality(knowledge)}
    body["contextSize"] = context_size(profile, build_system_prompt(profile))
    return body


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    fact_ids: list[str] = Field(default_factory=list, alias="factIds", max_length=300)
    trait_ids: list[str] = Field(default_factory=list, alias="traitIds", max_length=100)
    #: Item id -> replacement description/guidance written by the user.
    edits: dict[str, str] = Field(default_factory=dict, max_length=400)
    #: Items approved despite a conflict or an existing restatement.
    acknowledge: list[str] = Field(default_factory=list, max_length=400)


@router.post("/documents/analyses/{analysis_id}/approval")
def approve(analysis_id: str, body: ApprovalRequest, request: Request) -> dict:
    jobs: AnalysisJobs = request.app.state.lore_analyses
    try:
        job = jobs.get(analysis_id)
    except AnalysisNotFoundError:
        raise HTTPException(404, "Unknown analysis.") from None
    if job.proposal is None:
        raise HTTPException(409, {"code": "analysis_not_ready", "message": "The analysis has not produced a proposal."})
    if not body.fact_ids and not body.trait_ids:
        raise HTTPException(422, {"code": "nothing_selected", "message": "Select at least one fact or trait."})
    character_id = job.proposal.character_id
    _profile(request, character_id)
    repo = repository(request)
    store = repo.knowledge_store()
    try:
        knowledge = store.load(character_id)
        result = apply_approval(job.proposal, knowledge, body.fact_ids, body.trait_ids, body.edits, body.acknowledge)
        if result.approved:
            store.save(result.knowledge)
    except ApprovalError as error:
        status = 409 if error.code == "unacknowledged_conflict" else 422
        raise HTTPException(status, {"code": error.code, "message": str(error), "ids": error.ids}) from None
    except (KnowledgeStoreError, InvalidCharacterIdError) as error:
        raise _store_error(error) from None
    repo.invalidate(character_id)
    return {"approved": result.approved, "skipped": result.skipped, "knowledge": _state(request, character_id)}


@router.get("/characters/{character_id}/knowledge")
def get_knowledge(character_id: str, request: Request) -> dict:
    _profile(request, character_id)
    return _state(request, character_id)


@router.delete("/characters/{character_id}/knowledge/items/{item_id}")
def remove_item(character_id: str, item_id: str, request: Request) -> dict:
    _profile(request, character_id)
    repo = repository(request)
    store = repo.knowledge_store()
    try:
        knowledge = store.load(character_id)
        before = len(knowledge.facts) + len(knowledge.traits)
        knowledge.facts = [f for f in knowledge.facts if f.id != item_id]
        knowledge.traits = [t for t in knowledge.traits if t.id != item_id]
        if len(knowledge.facts) + len(knowledge.traits) == before:
            raise HTTPException(404, "Unknown approved item.")
        used = {i.provenance.source_sha256 for i in [*knowledge.facts, *knowledge.traits]}
        knowledge.sources = [s for s in knowledge.sources if s.sha256 in used]
        if knowledge.facts or knowledge.traits:
            store.save(knowledge)
        else:
            store.reset(character_id)
    except (KnowledgeStoreError, InvalidCharacterIdError) as error:
        raise _store_error(error) from None
    repo.invalidate(character_id)
    return _state(request, character_id)


@router.delete("/characters/{character_id}/knowledge")
def factory_reset(character_id: str, request: Request, confirm: bool = Query(False)) -> dict:
    """Remove every approved addition; the character returns to its built-in knowledge."""
    if not confirm:
        raise HTTPException(422, {"code": "confirmation_required", "message": "Pass confirm=true to reset."})
    _profile(request, character_id)
    repo = repository(request)
    try:
        removed = repo.knowledge_store().reset(character_id)
    except (KnowledgeStoreError, InvalidCharacterIdError) as error:
        raise _store_error(error) from None
    repo.invalidate(character_id)
    return {"reset": removed, "knowledge": _state(request, character_id)}


@router.get("/characters/{character_id}/knowledge/export", response_class=PlainTextResponse)
def export_knowledge(character_id: str, request: Request) -> PlainTextResponse:
    profile = _profile(request, character_id)
    text = f"# Effective lore ({profile.display_name})\n\n{profile.lore}\n\n---\n\n# Effective personality\n\n{profile.personality}\n"
    return PlainTextResponse(text, media_type="text/markdown; charset=utf-8", headers={"Cache-Control": "no-store"})
