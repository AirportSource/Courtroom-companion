"""Event inbox API (D-067). Local/same-origin only: events come from this machine (hooks, scheduler)."""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..characters.repository import CharacterNotFoundError
from ..events.inbox import PROJECT_MAX, TEXT_MAX, EventRejected, event_performance
from .profile_routes import local_configuration_request

router = APIRouter(prefix="/api/events")


class EventIn(BaseModel):
    source: str = Field(default="external", pattern=r"^[a-z0-9_-]{1,40}$")
    type: str = Field(pattern=r"^[a-z_]{1,40}$")
    project: str = Field(default="", max_length=PROJECT_MAX)
    text: str = Field(default="", max_length=TEXT_MAX)


@router.post("")
def post_event(body: EventIn, request: Request) -> dict[str, Any]:
    local_configuration_request(request)
    try:
        event = request.app.state.event_inbox.push(body.type, body.source, body.project, body.text)
    except EventRejected as error:
        raise HTTPException(status_code=422, detail={"code": "event_rejected", "message": str(error)}) from None
    return {"id": event.id}


@router.get("")
def get_events(
    request: Request,
    character: str = Query(pattern=r"^[a-z0-9_]{1,64}$"),
    after: int = Query(default=0, ge=0),
    language: Literal["en", "fr", "ja", "it", "es"] = "en",
) -> dict[str, Any]:
    """Events newer than `after`, each performed by `character` in `language`.

    `after=0` only returns the current cursor, so a freshly opened conversation never replays
    old events.
    """
    local_configuration_request(request)
    inbox = request.app.state.event_inbox
    if after == 0:
        cursor = inbox.start_cursor()
        if cursor == inbox.last_id:
            return {"cursor": cursor, "events": []}
        after = cursor
    try:
        profile = request.app.state.character_service.repository.get(character)
    except CharacterNotFoundError:
        raise HTTPException(status_code=404, detail="unknown character") from None
    events = inbox.after(after)
    return {
        "cursor": events[-1].id if events else after,
        "events": [event_performance(profile, event, language) for event in events],
    }
