"""Imported-music library API. Local, same-origin only; no filesystem path ever leaves the server.

Wire in main.py:
    app.state.music_library = MusicLibrary(music_dir())
    app.include_router(music_router)
"""

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from ..music.library import (
    LibraryFullError,
    LoopInput,
    MusicLibrary,
    MusicLibraryError,
    TrackNotFoundError,
    UnsupportedAudioError,
    UploadTooLargeError,
)
from ..music.sniff import FORMATS
from .profile_routes import local_configuration_request


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/api/music/imports", dependencies=[Depends(local_configuration_request), Depends(_no_store)])


def library(request: Request) -> MusicLibrary:
    return request.app.state.music_library


class TitleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)


def _http(error: Exception) -> HTTPException:
    if isinstance(error, TrackNotFoundError):
        return HTTPException(404, "Unknown imported track.")
    if isinstance(error, UploadTooLargeError):
        return HTTPException(413, "The audio file is too large.")
    if isinstance(error, UnsupportedAudioError):
        return HTTPException(415, "Unsupported audio. Use a valid MP3, OGG, WAV or FLAC file.")
    if isinstance(error, LibraryFullError):
        return HTTPException(409, "The music library is full. Delete a track first.")
    return HTTPException(503, "The music library is unavailable; existing data was preserved.")


@router.get("")
def list_imports(request: Request) -> dict:
    return {"tracks": library(request).list_tracks()}


@router.post("", status_code=201)
async def upload_import(request: Request) -> dict:
    """Raw request body is the audio file; the original name is the percent-encoded X-Filename header."""
    music = library(request)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > music.max_bytes:
        raise _http(UploadTooLargeError())
    try:
        upload = await run_in_threadpool(music.begin_upload)
    except (LibraryFullError, MusicLibraryError) as error:
        raise _http(error) from None
    try:
        async for chunk in request.stream():
            upload.write(chunk)
        return await run_in_threadpool(upload.finish, request.headers.get("x-filename"))
    except (UploadTooLargeError, UnsupportedAudioError, MusicLibraryError) as error:
        raise _http(error) from None
    finally:
        upload.abort()  # no-op after a successful publish


@router.get("/{track_id}/audio")
def stream_audio(track_id: str, request: Request):
    music = library(request)
    try:
        track = music.get(track_id)
    except TrackNotFoundError as error:
        raise _http(error) from None
    path = music.audio_path(track)
    if path is None:
        raise HTTPException(404, "The audio file for this track is missing.")
    return FileResponse(
        path,
        media_type=FORMATS[track.format].mime,
        headers={"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
                 "Cache-Control": "private, no-cache"},
    )


@router.put("/{track_id}/loop")
def save_loop(track_id: str, request: Request, payload: dict = Body()) -> dict:
    # Validated by hand so a rejected body (e.g. NaN) is reported without echoing the input back.
    try:
        body = LoopInput.model_validate(payload)
    except ValidationError as error:
        raise HTTPException(422, [{"loc": item["loc"], "msg": item["msg"]} for item in error.errors(include_input=False, include_url=False, include_context=False)]) from None
    try:
        return library(request).set_loop(track_id, body)
    except (TrackNotFoundError, MusicLibraryError) as error:
        raise _http(error) from None


@router.patch("/{track_id}")
def rename_import(track_id: str, body: TitleInput, request: Request) -> dict:
    try:
        return library(request).rename(track_id, body.title)
    except (TrackNotFoundError, MusicLibraryError) as error:
        raise _http(error) from None


@router.delete("/{track_id}", status_code=204)
def delete_import(track_id: str, request: Request) -> Response:
    try:
        library(request).delete(track_id)
    except (TrackNotFoundError, MusicLibraryError) as error:
        raise _http(error) from None
    return Response(status_code=204, headers={"Cache-Control": "no-store"})
