"""Versioned local JSON store for the Conversation Record.

Location: ``$COURTROOM_CONVERSATION_RECORD_DIR`` or ``<$COURTROOM_CONFIG_DIR or backend/.local>/
conversation-record/records.json`` (git-ignored). Writes are temp + fsync + atomic replace under
a lock. A malformed file is preserved as ``records.corrupt-<ts>.json`` and the store starts empty
(the archive is a convenience; chat must keep working). Caps: MAX_ENTRIES (oldest pruned
deterministically by createdAt, then id) and per-field text limits (longer text is truncated).
Stored per entry: only the visible user text and visible final reply, never reasoning, prompts,
provider payloads, file content, keys or paths. Request IDs are kept only as SHA-256 receipts
(removed together with their entry).
"""

import hashlib
import json
import logging
import os
import re
import tempfile
import time
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from uuid import uuid4

from ..runtime import paths as runtime_paths

log = logging.getLogger(__name__)

VERSION = 1
MAX_ENTRIES = 5000
MAX_USER_TEXT = 2000  # the chat input cap
MAX_ASSISTANT_TEXT = 20000
MAX_ARTIFACT_IDS = 8
ID_RE = re.compile(r"^[a-f0-9]{32}$")
ARTIFACT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_KEYS = {"id", "characterId", "createdAt", "userText", "assistantText", "artifactIds", "receipt"}


class ConversationRecordError(Exception):
    """Storage failure; the message is safe to show (no paths)."""


class RecordNotFound(ConversationRecordError):
    pass


def record_dir() -> Path:
    return runtime_paths.conversation_record_dir()


def _receipt(request_id: str) -> str:
    return hashlib.sha256(f"conversation-record:{request_id}".encode()).hexdigest()


def _valid(item) -> bool:
    return (isinstance(item, dict) and set(item) <= _KEYS and isinstance(item.get("id"), str)
        and bool(ID_RE.match(item["id"])) and all(isinstance(item.get(k), str) for k in
        ("characterId", "createdAt", "userText", "assistantText"))
        and isinstance(item.get("artifactIds"), list) and all(isinstance(a, str) for a in item["artifactIds"]))


class ConversationRecordStore:
    def __init__(self, directory: Path) -> None:
        self.path = Path(directory) / "records.json"
        self.lock = RLock()
        self._entries: list[dict] = []
        self.recovered_corrupt = False
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            document = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(document, dict) or document.get("version") != VERSION:
                raise ValueError("unsupported")
            entries = document.get("entries")
            if not isinstance(entries, list) or not all(_valid(item) for item in entries):
                raise ValueError("malformed")
            self._entries = entries
        except Exception:
            self.recovered_corrupt = True
            try:
                stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
                self.path.replace(self.path.with_name(f"records.corrupt-{stamp}-{uuid4().hex[:6]}.json"))
            except OSError:
                log.warning("Conversation record file is unreadable and could not be preserved.")
            self._entries = []

    def _write(self, entries: list[dict]) -> None:
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".records-", dir=self.path.parent)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump({"version": VERSION, "entries": entries}, output, ensure_ascii=False)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
            self._entries = entries
        except Exception:
            raise ConversationRecordError("The conversation record could not be saved.") from None
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def public(entry: dict) -> dict:
        return {k: entry[k] for k in ("id", "characterId", "createdAt", "userText", "assistantText", "artifactIds")}

    def add(self, character_id: str, user_text: str, assistant_text: str,
            artifact_ids: list[str] | None = None, request_id: str | None = None) -> dict:
        """Create one entry; a repeated request_id returns the existing entry."""
        receipt = _receipt(request_id) if request_id else None
        with self.lock:
            if receipt:
                for existing in self._entries:
                    if existing.get("receipt") == receipt:
                        return self.public(existing)
            entry = {"id": uuid4().hex, "characterId": character_id,
                "createdAt": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
                "userText": user_text[:MAX_USER_TEXT], "assistantText": assistant_text[:MAX_ASSISTANT_TEXT],
                "artifactIds": [a for a in (artifact_ids or []) if ARTIFACT_ID_RE.match(a)][:MAX_ARTIFACT_IDS]}
            if receipt:
                entry["receipt"] = receipt
            entries = [*self._entries, entry]
            if len(entries) > MAX_ENTRIES:
                entries.sort(key=lambda e: (e["createdAt"], e["id"]))
                entries = entries[len(entries) - MAX_ENTRIES:]
            self._write(entries)
            return self.public(entry)

    def list(self) -> list[dict]:
        with self.lock:
            ordered = sorted(self._entries, key=lambda e: (e["createdAt"], e["id"]), reverse=True)
            return [self.public(e) for e in ordered]

    def get(self, entry_id: str) -> dict:
        with self.lock:
            for entry in self._entries:
                if entry["id"] == entry_id:
                    return self.public(entry)
        raise RecordNotFound("Unknown conversation record.")

    def delete(self, entry_id: str) -> None:
        with self.lock:
            remaining = [e for e in self._entries if e["id"] != entry_id]
            if len(remaining) == len(self._entries):
                raise RecordNotFound("Unknown conversation record.")
            self._write(remaining)

    def delete_many(self, entry_ids: Iterable[str]) -> int:
        """Remove every listed entry in one atomic write; unknown ids are ignored. Returns the count."""
        wanted = set(entry_ids)
        with self.lock:
            remaining = [e for e in self._entries if e["id"] not in wanted]
            removed = len(self._entries) - len(remaining)
            if removed:
                self._write(remaining)
            return removed

    def clear(self) -> None:
        with self.lock:
            self._write([])
