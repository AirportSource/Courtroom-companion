"""Imported-music storage. Audio lives under server-generated IDs; only metadata carries titles.

Layout: <music dir>/library.json and <music dir>/audio/<id>.<ext>. Nothing here is ever served by
path from user input: every file is resolved from a validated ID and checked to stay inside the
audio directory. The directory defaults to backend/.local/music (git-ignored).
"""

import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from .sniff import DEFAULT_TITLE, FORMATS, SNIFF_BYTES, AudioFormat, sanitize_title, sniff_audio

TRACK_ID_PATTERN = r"^[a-f0-9]{32}$"
_TRACK_ID = re.compile(TRACK_ID_PATTERN)
MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_TRACKS = 200


class MusicLibraryError(RuntimeError):
    def __init__(self, message: str = "The music library could not be read or saved; existing data was preserved.") -> None:
        super().__init__(message)


class TrackNotFoundError(LookupError):
    pass


class UploadTooLargeError(ValueError):
    pass


class UnsupportedAudioError(ValueError):
    pass


class LibraryFullError(ValueError):
    pass


def music_dir() -> Path:
    explicit = os.environ.get("COURTROOM_MUSIC_DIR")
    if explicit:
        return Path(explicit)
    base = os.environ.get("COURTROOM_CONFIG_DIR", Path(__file__).resolve().parents[2] / ".local")
    return Path(base) / "music"


class LoopInput(BaseModel):
    """Loop metadata as accepted from the client (mirrors the frontend LoopMetadata contract)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    start_sample: StrictInt | None = Field(default=None, alias="startSample", ge=0, le=2**40)
    end_sample: StrictInt | None = Field(default=None, alias="endSample", ge=1, le=2**40)
    sample_rate: StrictInt | None = Field(default=None, alias="sampleRate", ge=8000, le=384000)
    crossfade_ms: float | None = Field(default=None, alias="crossfadeMs", ge=0, le=500, allow_inf_nan=False)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    provenance: Literal["auto-detected", "user-accepted", "user-adjusted", "none"]
    note: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def coherent(self):
        fields = (self.start_sample, self.end_sample, self.sample_rate)
        if self.provenance == "none":
            if any(item is not None for item in fields) or self.crossfade_ms is not None:
                raise ValueError("a 'none' loop has no region")
            return self
        if any(item is None for item in fields):
            raise ValueError("loop region requires startSample, endSample and sampleRate")
        if self.end_sample <= self.start_sample:
            raise ValueError("endSample must be greater than startSample")
        if self.crossfade_ms and self.crossfade_ms / 1000 * self.sample_rate > (self.end_sample - self.start_sample) / 2:
            raise ValueError("crossfade must be shorter than half the loop")
        return self

    def to_public(self) -> dict:
        region = None
        if self.provenance != "none":
            region = {"startSample": self.start_sample, "endSample": self.end_sample, "sampleRate": self.sample_rate}
            if self.crossfade_ms:
                region["crossfadeMs"] = self.crossfade_ms
        out = {"region": region, "confidence": self.confidence, "provenance": self.provenance}
        if self.note:
            out["note"] = self.note
        return out


class TrackRecord(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    id: str = Field(pattern=TRACK_ID_PATTERN)
    title: str = Field(min_length=1, max_length=120)
    format: Literal["mp3", "ogg", "wav", "flac"]
    size_bytes: int = Field(alias="sizeBytes", ge=0)
    created_at: str = Field(alias="createdAt")
    loop: LoopInput | None = None


class LibraryFile(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    version: Literal[1] = 1
    tracks: list[TrackRecord] = Field(default_factory=list)


def valid_track_id(value: str) -> bool:
    return bool(_TRACK_ID.fullmatch(value))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class MusicLibrary:
    """One local backend process owns the directory; threads share a lock."""

    def __init__(self, directory: Path, max_bytes: int = MAX_UPLOAD_BYTES) -> None:
        self.directory = Path(directory)
        self.audio_dir = self.directory / "audio"
        self.index_path = self.directory / "library.json"
        self.max_bytes = max_bytes
        self.lock = RLock()
        self._tracks: dict[str, TrackRecord] = {}
        self._load()

    # --- persistence -------------------------------------------------------------------------
    def _load(self) -> None:
        with self.lock:
            if not self.index_path.exists():
                return
            try:
                parsed = LibraryFile.model_validate_json(self.index_path.read_text(encoding="utf-8"))
                self._tracks = {track.id: track for track in parsed.tracks}
            except Exception:
                self._recover_corrupt_index()

    def _recover_corrupt_index(self) -> None:
        """Keep the unreadable index for inspection, then re-register orphaned audio files."""
        try:
            self.index_path.replace(self.directory / f"library.corrupt-{int(time.time())}.json")
        except OSError:
            pass
        self._tracks = {}
        if self.audio_dir.is_dir():
            for path in sorted(self.audio_dir.iterdir()):
                kind = FORMATS.get(path.suffix[1:])
                if kind and path.is_file() and valid_track_id(path.stem):
                    self._tracks[path.stem] = TrackRecord(
                        id=path.stem, title="Recovered track", format=kind.name,  # type: ignore[arg-type]
                        sizeBytes=path.stat().st_size, createdAt=_now())
        try:
            self._write()
        except MusicLibraryError:
            pass

    def _write(self) -> None:
        temporary = None
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".library-", dir=self.directory)
            payload = LibraryFile(tracks=list(self._tracks.values()))
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(payload.model_dump_json(by_alias=True, indent=2))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.index_path)
        except Exception:
            raise MusicLibraryError() from None
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    # --- file helpers ------------------------------------------------------------------------
    def audio_path(self, track: TrackRecord) -> Path | None:
        """Resolved audio path for a stored record, or None when it is missing or escapes storage."""
        if not valid_track_id(track.id) or track.format not in FORMATS:
            return None
        candidate = self.audio_dir / f"{track.id}.{FORMATS[track.format].extension}"
        try:
            resolved, root = candidate.resolve(), self.audio_dir.resolve()
        except OSError:
            return None
        if not resolved.is_relative_to(root) or not resolved.is_file():
            return None
        return resolved

    def public(self, track: TrackRecord) -> dict:
        """Client view: never any filesystem path or original file name."""
        return {
            "id": track.id,
            "title": track.title,
            "format": track.format,
            "mime": FORMATS[track.format].mime,
            "sizeBytes": track.size_bytes,
            "createdAt": track.created_at,
            "available": self.audio_path(track) is not None,
            "loop": track.loop.to_public() if track.loop else None,
        }

    # --- operations --------------------------------------------------------------------------
    def list_tracks(self) -> list[dict]:
        with self.lock:
            tracks = sorted(self._tracks.values(), key=lambda item: item.created_at)
            return [self.public(item) for item in tracks]

    def get(self, track_id: str) -> TrackRecord:
        with self.lock:
            track = self._tracks.get(track_id) if valid_track_id(track_id) else None
            if track is None:
                raise TrackNotFoundError()
            return track

    def begin_upload(self) -> "Upload":
        with self.lock:
            if len(self._tracks) >= MAX_TRACKS:
                raise LibraryFullError()
        return Upload(self)

    def _publish(self, temporary: str, kind: AudioFormat, size: int, filename: str | None) -> dict:
        track_id = uuid4().hex
        destination = self.audio_dir / f"{track_id}.{kind.extension}"
        with self.lock:
            os.replace(temporary, destination)
            record = TrackRecord(id=track_id, title=sanitize_title(filename) or DEFAULT_TITLE, format=kind.name,  # type: ignore[arg-type]
                                 sizeBytes=size, createdAt=_now())
            self._tracks[track_id] = record
            try:
                self._write()
            except MusicLibraryError:
                del self._tracks[track_id]
                destination.unlink(missing_ok=True)
                raise
            return self.public(record)

    def _replace(self, track_id: str, **changes) -> dict:
        with self.lock:
            track = self.get(track_id)
            updated = track.model_copy(update=changes)
            self._tracks[track_id] = updated
            try:
                self._write()
            except MusicLibraryError:
                self._tracks[track_id] = track
                raise
            return self.public(updated)

    def set_loop(self, track_id: str, loop: LoopInput) -> dict:
        return self._replace(track_id, loop=loop)

    def rename(self, track_id: str, title: str) -> dict:
        return self._replace(track_id, title=sanitize_title(title))

    def delete(self, track_id: str) -> None:
        with self.lock:
            track = self.get(track_id)
            path = self.audio_path(track)
            del self._tracks[track_id]
            try:
                self._write()
            except MusicLibraryError:
                self._tracks[track_id] = track
                raise
            if path is not None:
                try:
                    path.unlink()
                except OSError:
                    pass


class Upload:
    """Incremental, size-capped upload into a temp file; nothing is published until content is valid."""

    def __init__(self, library: MusicLibrary) -> None:
        self.library = library
        self.total = 0
        self.head = b""
        self.kind: AudioFormat | None = None
        try:
            library.audio_dir.mkdir(parents=True, exist_ok=True)
            descriptor, self.temporary = tempfile.mkstemp(prefix=".upload-", dir=library.audio_dir)
            self.output = os.fdopen(descriptor, "wb")
        except OSError:
            raise MusicLibraryError() from None

    def write(self, chunk: bytes) -> None:
        if not chunk:
            return
        self.total += len(chunk)
        if self.total > self.library.max_bytes:
            raise UploadTooLargeError()
        if self.kind is None and len(self.head) < SNIFF_BYTES:
            self.head += chunk[:SNIFF_BYTES - len(self.head)]
            if len(self.head) >= SNIFF_BYTES:
                self.kind = sniff_audio(self.head)
                if self.kind is None:
                    raise UnsupportedAudioError()
        try:
            self.output.write(chunk)
        except OSError:
            raise MusicLibraryError() from None

    def finish(self, filename: str | None) -> dict:
        try:
            self.kind = self.kind or sniff_audio(self.head)
            if self.kind is None:
                raise UnsupportedAudioError()
            self.output.flush()
            os.fsync(self.output.fileno())
            self.output.close()
            try:
                return self.library._publish(self.temporary, self.kind, self.total, filename)
            except OSError:
                raise MusicLibraryError() from None
        finally:
            self.abort()

    def abort(self) -> None:
        try:
            self.output.close()
        except OSError:
            pass
        if os.path.exists(self.temporary):
            os.unlink(self.temporary)
