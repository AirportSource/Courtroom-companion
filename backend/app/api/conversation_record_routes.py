"""Local conversation archive API (user-facing history; never fed to providers)."""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ..conversation_record.store import ConversationRecordStore, RecordNotFound
from .artifact_routes import no_store
from .profile_routes import local_configuration_request

router = APIRouter(prefix="/api/conversation-record",
    dependencies=[Depends(local_configuration_request), Depends(no_store)])


def store(request: Request) -> ConversationRecordStore:
    return request.app.state.conversation_record


def record_id(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}", value):
        raise HTTPException(404, "Unknown conversation record.")
    return value


class DeleteManyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(min_length=1, max_length=1000)


class ClearRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: bool


@router.get("")
def list_records(request: Request):
    return {"entries": store(request).list()}


@router.post("/delete")
def delete_records(body: DeleteManyRequest, request: Request):
    """Delete several entries at once (the Record's selection mode). Ids already gone are skipped."""
    ids = [record_id(value) for value in body.ids]
    return {"deleted": store(request).delete_many(ids)}


@router.get("/{entry_id}")
def get_record(entry_id: str, request: Request):
    try:
        return store(request).get(record_id(entry_id))
    except RecordNotFound:
        raise HTTPException(404, "Unknown conversation record.") from None


@router.delete("/{entry_id}", status_code=204)
def delete_record(entry_id: str, request: Request):
    try:
        store(request).delete(record_id(entry_id))
    except RecordNotFound:
        raise HTTPException(404, "Unknown conversation record.") from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.delete("", status_code=204)
def clear_records(body: ClearRequest, request: Request):
    if not body.confirm:
        raise HTTPException(400, "Set confirm to true to clear the conversation record.")
    store(request).clear()
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
