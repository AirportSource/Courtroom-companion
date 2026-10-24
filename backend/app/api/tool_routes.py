"""Tool configuration API (D-067): authorized folders, web search provider/key, reminders.

Local/same-origin only, like the provider-profile routes. The web search key goes to the OS vault
and is never returned; only "configured" is reported.
"""

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, SecretStr

from ..tools.folders import FolderError
from ..tools.reminders import local_label
from ..tools.web_search import PROVIDERS, WebSearchError, credential_ref
from .profile_routes import local_configuration_request

router = APIRouter(prefix="/api/tools")


class FolderIn(BaseModel):
    path: str = Field(min_length=1, max_length=1024)


class ProviderIn(BaseModel):
    provider: Literal["brave", "tavily"] | None = None


class KeyIn(BaseModel):
    secret: SecretStr = Field(min_length=1, max_length=4096)


def _tools(request: Request):
    local_configuration_request(request)
    return request.app.state.tools


def _status(tools) -> dict[str, Any]:
    return {
        "folders": tools.folders.all(),
        "webSearch": {"provider": tools.web.provider, "configured": tools.web_key() is not None,
                      "providers": PROVIDERS},
        "reminders": [{**r, "local": local_label(r["due"])} for r in tools.reminders.pending()],
    }


@router.get("")
def status(request: Request) -> dict[str, Any]:
    return _status(_tools(request))


@router.post("/folders")
def add_folder(body: FolderIn, request: Request) -> dict[str, Any]:
    tools = _tools(request)
    try:
        tools.folders.add(body.path)
    except FolderError as error:
        raise HTTPException(status_code=422, detail={"code": "folder_rejected", "message": str(error)}) from None
    return _status(tools)


@router.delete("/folders/{folder_id}")
def remove_folder(folder_id: str, request: Request) -> dict[str, Any]:
    tools = _tools(request)
    if not tools.folders.remove(folder_id):
        raise HTTPException(status_code=404, detail="unknown folder")
    return _status(tools)


@router.put("/web-search")
def set_provider(body: ProviderIn, request: Request) -> dict[str, Any]:
    tools = _tools(request)
    try:
        tools.web.set_provider(body.provider)
    except WebSearchError as error:
        raise HTTPException(status_code=422, detail={"code": "provider_rejected", "message": str(error)}) from None
    return _status(tools)


@router.put("/web-search/key")
def set_key(body: KeyIn, request: Request) -> dict[str, Any]:
    tools = _tools(request)
    if not tools.web.provider or tools.credentials is None:
        raise HTTPException(status_code=409, detail={"code": "no_provider", "message": "Choose a web search provider first."})
    tools.credentials.set(credential_ref(tools.web.provider), body.secret)
    return _status(tools)


@router.delete("/web-search/key")
def delete_key(request: Request) -> dict[str, Any]:
    tools = _tools(request)
    if tools.web.provider and tools.credentials is not None:
        tools.credentials.delete(credential_ref(tools.web.provider))
    return _status(tools)


@router.delete("/reminders/{reminder_id}")
def cancel_reminder(reminder_id: str, request: Request) -> dict[str, Any]:
    tools = _tools(request)
    if not tools.reminders.cancel(reminder_id):
        raise HTTPException(status_code=404, detail="unknown reminder")
    return _status(tools)
