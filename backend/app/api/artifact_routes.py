"""Local artifact metadata/text/download/delete and semantic turn-status operations."""

import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..artifacts.store import ArtifactError, ArtifactNotFound, ArtifactStore
from ..artifacts.turns import TurnConflict
from .profile_routes import local_configuration_request


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"


router = APIRouter(prefix="/api", dependencies=[Depends(local_configuration_request), Depends(no_store)])


def store(request: Request) -> ArtifactStore:
    return request.app.state.artifact_store


@router.get("/artifacts")
def list_artifacts(request: Request):
    return {"artifacts": store(request).list()}


@router.get("/artifacts/{artifact_id}")
def get_artifact(artifact_id: str, request: Request):
    return store(request).get(artifact_id)


@router.get("/artifacts/{artifact_id}/content")
def read_artifact(artifact_id: str, request: Request):
    return {"id": artifact_id, "content": store(request).read(artifact_id)}


@router.get("/artifacts/{artifact_id}/download")
def download_artifact(artifact_id: str, request: Request):
    metadata = store(request).get(artifact_id)
    content = store(request).read(artifact_id)
    # Always attachment/plain text; no browser interpretation as HTML, Python or Markdown.
    disposition = f"attachment; filename=\"artifact.{metadata['extension']}\"; filename*=UTF-8''{quote(metadata['displayName'], safe='')}"
    return Response(content=content.encode("utf-8"), media_type="text/plain", headers={
        "Content-Disposition": disposition, "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'", "Cache-Control": "no-store",
    })


@router.delete("/artifacts/{artifact_id}", status_code=204)
def delete_artifact(artifact_id: str, request: Request):
    store(request).delete(artifact_id)
    request.app.state.artifact_turns.invalidate_artifact(artifact_id)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def turn_id(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", value):
        raise HTTPException(404, "Unknown turn.")
    return value


@router.get("/chat/turns/{request_id}")
async def get_turn(request_id: str, request: Request):
    status = request.app.state.artifact_turns.get(turn_id(request_id))
    if status is None:
        raise HTTPException(404, "Unknown turn.")
    if status["state"] == "artifact-ready":
        try:
            available = store(request).get(status["artifactId"])["status"] == "ready"
        except ArtifactNotFound:
            available = False
        if not available:
            request.app.state.artifact_turns.invalidate_artifact(status["artifactId"])
            status = request.app.state.artifact_turns.get(request_id)
    return status


@router.delete("/chat/turns/{request_id}")
async def cancel_turn(request_id: str, request: Request):
    try:
        return request.app.state.artifact_turns.cancel(turn_id(request_id))
    except TurnConflict:
        raise HTTPException(429, "Too many turns are currently running.") from None
