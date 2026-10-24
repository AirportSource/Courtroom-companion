"""Atomic, bounded, application-owned text storage. Stored Python is never executed."""

import hashlib
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from .contracts import CreateTextArtifact, ArtifactFormat, MAX_ARTIFACT_BYTES, MIME_TYPES, display_filename

ARTIFACT_ID = re.compile(r"^[a-f0-9]{32}$")
MAX_ARTIFACTS = 200
MAX_TOTAL_BYTES = 8 * 1024 * 1024
MAX_RECEIPTS = 2000


class ArtifactError(RuntimeError):
    code = "artifact_storage_failed"

    def __init__(self, message="The file could not be saved. Existing files were preserved."):
        super().__init__(message)


class ArtifactNotFound(ArtifactError):
    code = "artifact_not_found"

    def __init__(self):
        super().__init__("This generated file is missing or has been deleted.")


class ArtifactLimitError(ArtifactError):
    code = "artifact_limit_reached"

    def __init__(self):
        super().__init__("Generated-file storage has reached a limit. Review the saved files and local catalog.")


class ArtifactConflict(ArtifactError):
    code = "artifact_request_conflict"

    def __init__(self):
        super().__init__("That request ID has already been used for a different or deleted file.")


def outputs_dir() -> Path:
    base = os.environ.get("COURTROOM_CONFIG_DIR", Path(__file__).resolve().parents[2] / ".local")
    return Path(os.environ.get("COURTROOM_OUTPUTS_DIR", Path(base) / "outputs"))


class GeneratedArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    display_name: str = Field(alias="displayName", min_length=1, max_length=120)
    extension: ArtifactFormat
    mime_type: str = Field(alias="mimeType")
    created_at: str = Field(alias="createdAt")
    size_bytes: int = Field(alias="sizeBytes", gt=0, le=MAX_ARTIFACT_BYTES)
    status: Literal["ready", "missing"] = "ready"
    content_preview: str = Field(default="", alias="contentPreview", max_length=1000)


class _Record(BaseModel):
    model_config = ConfigDict(extra="forbid")
    artifact: GeneratedArtifact
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class _Receipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    artifact_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class _Index(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    records: dict[str, _Record] = Field(default_factory=dict, max_length=MAX_ARTIFACTS)
    receipts: dict[str, _Receipt] = Field(default_factory=dict, max_length=MAX_RECEIPTS)


class ArtifactStore:
    """One local backend worker; threads share a lock. Orphan/temp files stay inert."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.files_dir = self.directory / "files"
        self.index_path = self.directory / "artifacts.json"
        self.lock = RLock()
        self._index = _Index()
        self._unavailable = False
        if self.index_path.exists():
            try:
                if self.index_path.is_symlink() or self.index_path.stat().st_size > 2 * 1024 * 1024:
                    raise ValueError()
                index = _Index.model_validate_json(self.index_path.read_text(encoding="utf-8"))
                if any(key != record.artifact.id for key, record in index.records.items()):
                    raise ValueError()
                if any(not re.fullmatch(r"[a-f0-9]{64}", key) for key in index.receipts):
                    raise ValueError()
                self._index = index
            except (OSError, ValueError):
                # Preserve corrupt metadata and backing files; never silently replace the catalog.
                self._unavailable = True

    def _check(self):
        if self._unavailable:
            raise ArtifactError("The generated-file catalog needs repair; existing data was preserved.")

    def _path(self, artifact_id: str) -> Path:
        if not ARTIFACT_ID.fullmatch(artifact_id):
            raise ArtifactNotFound()
        path = self.files_dir / f"{artifact_id}.text"
        try:
            if (self.files_dir.is_symlink() or path.is_symlink()
                    or not path.resolve().is_relative_to(self.directory.resolve())):
                raise ArtifactError()
        except OSError:
            raise ArtifactError() from None
        return path

    def _backing_size(self) -> int:
        """Orphans/interrupted writes count toward disk limits too; never auto-register them."""
        try:
            if self.files_dir.is_symlink() or not self.files_dir.resolve().is_relative_to(self.directory.resolve()):
                raise ArtifactError()
            if not self.files_dir.exists():
                return 0
            total = 0
            for path in self.files_dir.iterdir():
                if path.is_symlink():
                    raise ArtifactError()
                if path.is_file():
                    total += path.stat().st_size
            return total
        except OSError:
            raise ArtifactError() from None

    def _save(self, index: _Index):
        temporary = None
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            if self.index_path.is_symlink():
                raise OSError()
            descriptor, temporary = tempfile.mkstemp(prefix=".catalog-", dir=self.directory)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
                output.write(index.model_dump_json(by_alias=True, indent=2))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.index_path)
        except OSError:
            raise ArtifactError() from None
        finally:
            if temporary:
                try:
                    Path(temporary).unlink(missing_ok=True)
                except OSError:
                    pass  # inert temporary data, never catalogued or served

    def _read(self, record: _Record) -> str:
        path = self._path(record.artifact.id)
        try:
            # Bounded reads, including externally modified backing files.
            with path.open("rb") as source:
                data = source.read(MAX_ARTIFACT_BYTES + 1)
            if len(data) != record.artifact.size_bytes or hashlib.sha256(data).hexdigest() != record.sha256:
                raise ArtifactNotFound()
            return data.decode("utf-8")
        except (FileNotFoundError, UnicodeError):
            raise ArtifactNotFound() from None
        except OSError:
            raise ArtifactError("The generated file could not be read.") from None

    def _record(self, artifact_id: str) -> _Record:
        self._check()
        if not ARTIFACT_ID.fullmatch(artifact_id) or artifact_id not in self._index.records:
            raise ArtifactNotFound()
        return self._index.records[artifact_id]

    def _public(self, record: _Record) -> dict:
        public = record.artifact.model_dump(by_alias=True)
        try:
            self._read(record)
        except ArtifactNotFound:
            public.update(status="missing", contentPreview="")
        return public

    def list(self) -> list[dict]:
        with self.lock:
            self._check()
            return [self._public(record) for record in reversed(list(self._index.records.values()))]

    def get(self, artifact_id: str) -> dict:
        with self.lock:
            return self._public(self._record(artifact_id))

    def read(self, artifact_id: str) -> str:
        with self.lock:
            return self._read(self._record(artifact_id))

    def create(self, action: CreateTextArtifact, operation_key: str, fingerprint: str) -> dict:
        # Defense in depth: callers cannot bypass action validation with model_construct/copies.
        action = CreateTextArtifact.model_validate(action.model_dump())
        name = display_filename(action.filename, action.format)
        if (not isinstance(operation_key, str) or not isinstance(fingerprint, str)
                or not re.fullmatch(r"[a-f0-9]{64}", operation_key) or not re.fullmatch(r"[a-f0-9]{64}", fingerprint)):
            raise ArtifactConflict()
        data = action.content.encode("utf-8")
        with self.lock:
            self._check()
            previous = self._index.receipts.get(operation_key)
            if previous:
                if previous.fingerprint != fingerprint or previous.artifact_id not in self._index.records:
                    raise ArtifactConflict()
                record = self._record(previous.artifact_id)
                self._read(record)
                return self._public(record)
            if (len(self._index.records) >= MAX_ARTIFACTS or len(self._index.receipts) >= MAX_RECEIPTS
                    or max(sum(r.artifact.size_bytes for r in self._index.records.values()), self._backing_size()) + len(data) > MAX_TOTAL_BYTES):
                raise ArtifactLimitError()
            used = {r.artifact.display_name.casefold() for r in self._index.records.values()}
            stem, extension = name.rsplit(".", 1)
            serial = 2
            while name.casefold() in used:
                name = f"{stem}-{serial}.{extension}"
                serial += 1
            artifact_id = uuid4().hex
            path = self._path(artifact_id)
            temporary = None
            published = False
            try:
                self.files_dir.mkdir(parents=True, exist_ok=True)
                descriptor, temporary = tempfile.mkstemp(prefix=".artifact-", dir=self.files_dir)
                with os.fdopen(descriptor, "wb") as output:
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                # Link publishes atomically and cannot overwrite even an existing opaque ID.
                os.link(temporary, path)
                published = True
                artifact = GeneratedArtifact(id=artifact_id, displayName=name, extension=action.format,
                    mimeType=MIME_TYPES[action.format], createdAt=datetime.now(timezone.utc).isoformat(),
                    sizeBytes=len(data), contentPreview=action.content[:1000])
                index = self._index.model_copy(deep=True)
                index.records[artifact_id] = _Record(artifact=artifact, sha256=hashlib.sha256(data).hexdigest())
                index.receipts[operation_key] = _Receipt(artifact_id=artifact_id, fingerprint=fingerprint)
                self._save(index)
                self._index = index
                return artifact.model_dump(by_alias=True)
            except OSError:
                raise ArtifactError() from None
            finally:
                if published and artifact_id not in self._index.records:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        pass  # failed catalog publication leaves an inert orphan, not a ready file
                if temporary:
                    try:
                        Path(temporary).unlink(missing_ok=True)
                    except OSError:
                        pass

    def delete(self, artifact_id: str):
        with self.lock:
            self._record(artifact_id)
            path = self._path(artifact_id)
            index = self._index.model_copy(deep=True)
            del index.records[artifact_id]
            # Keep the receipt: retrying a deleted request must not silently recreate its file.
            self._save(index)
            self._index = index
            try:
                path.unlink(missing_ok=True)
            except OSError:
                raise ArtifactError("The file was removed from the catalog, but local storage cleanup failed.") from None
