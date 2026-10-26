"""User-approved character knowledge overlay (Character Lore Builder Phase D, D-102).

Layer A is the built-in pack (`lore.md`, `personality.md`), read-only and never modified.
Layer B is this overlay: one JSON file per character under the user-data directory
(`<data root>/character-knowledge/<character id>/knowledge.json`; frozen Windows builds:
`%LOCALAPPDATA%\\CourtroomCompanion\\character-knowledge`).

Effective profile, deterministic:
- effective lore = pack lore.md, then an "Approved additions" section rendering approved facts
  (approval order, then id); facts the source marks as uncertain go to "Approved uncertain additions"
- effective personality = pack personality.md, then "Approved personality notes"
The overlay only appends; it never removes or rewrites built-in text. Deleting the file (factory
reset) restores the pack exactly.

Only reviewed proposal items get here, with their provenance. Text that came from a model is
flattened to one plain line (no Markdown structure) before it can reach a system prompt.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel

SCHEMA_VERSION = 1
FILE_NAME = "knowledge.json"
CHARACTER_ID = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MAX_ITEMS = 300
MAX_TEXT = 500


class InvalidCharacterIdError(ValueError):
    pass


class KnowledgeStoreError(Exception):
    """The overlay could not be read or written; built-in knowledge is unaffected."""


def plain_line(text: str, limit: int = MAX_TEXT) -> str:
    """One plain line: no newlines, no leading Markdown markers, bounded length."""
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"^[#>*\-+\s]+", "", text)
    return text[:limit].rstrip()


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class Provenance(_Model):
    source_document: str
    source_sha256: str
    source_pages: list[int]
    evidence: str
    proposal_id: str
    approved_at: str
    edited: bool = False


class ApprovedFact(_Model):
    id: str
    category: str
    subject: str
    predicate: str
    object: str | None = None
    description: str = Field(max_length=MAX_TEXT)
    basis: Literal["explicit", "interpretation", "inferred", "uncertain"]
    provenance: Provenance


class ApprovedTrait(_Model):
    id: str
    trait: str = Field(max_length=80)
    guidance: str = Field(max_length=MAX_TEXT)
    kind: str
    provenance: Provenance


class SourceRecord(_Model):
    name: str
    sha256: str
    license: str | None = None
    url: str | None = None
    first_approved_at: str


class CharacterKnowledge(_Model):
    schema_version: int = SCHEMA_VERSION
    character_id: str
    facts: list[ApprovedFact] = Field(default_factory=list)
    traits: list[ApprovedTrait] = Field(default_factory=list)
    sources: list[SourceRecord] = Field(default_factory=list)
    updated_at: str | None = None


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


BASIS_LABEL = {"explicit": "", "interpretation": "source interpretation", "inferred": "derived", "uncertain": "uncertain"}


def _cite(item) -> str:
    pages = ", ".join(f"p.{p}" for p in item.provenance.source_pages)
    return f"{item.provenance.source_document} {pages}".strip()


def render_lore(knowledge: CharacterKnowledge) -> str:
    """Approved facts as lore.md-style Markdown (deterministic)."""
    facts = sorted(knowledge.facts, key=lambda f: (f.provenance.approved_at, f.id))
    certain = [f for f in facts if f.basis != "uncertain"]
    uncertain = [f for f in facts if f.basis == "uncertain"]
    parts = []
    if certain:
        lines = []
        for f in certain:
            label = BASIS_LABEL[f.basis]
            lines.append(f"- {plain_line(f.description)} ({'; '.join(filter(None, [label, _cite(f)]))})")
        parts.append("## Approved additions (user-imported sources)\n" + "\n".join(lines))
    if uncertain:
        parts.append("## Approved uncertain additions\n" + "\n".join(
            f"- {plain_line(f.description)} (uncertain; {_cite(f)})" for f in uncertain))
    return "\n\n".join(parts)


def render_personality(knowledge: CharacterKnowledge) -> str:
    traits = sorted(knowledge.traits, key=lambda t: (t.provenance.approved_at, t.id))
    if not traits:
        return ""
    return "## Approved personality notes (user-imported sources)\n" + "\n".join(
        f"- {plain_line(t.trait, 80)}: {plain_line(t.guidance)}" for t in traits)


class KnowledgeStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def _path(self, character_id: str) -> Path:
        if not CHARACTER_ID.match(character_id or ""):
            raise InvalidCharacterIdError(character_id)
        path = (self.root / character_id / FILE_NAME).resolve()
        if self.root.resolve() not in path.parents:
            raise InvalidCharacterIdError(character_id)
        return path

    def exists(self, character_id: str) -> bool:
        return self._path(character_id).is_file()

    def load(self, character_id: str) -> CharacterKnowledge:
        """The overlay, or an empty one. Raises KnowledgeStoreError for unreadable/corrupt files."""
        path = self._path(character_id)
        if not path.is_file():
            return CharacterKnowledge(character_id=character_id)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            knowledge = CharacterKnowledge.model_validate(data)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError) as error:
            raise KnowledgeStoreError(f"{FILE_NAME} for {character_id} is unreadable ({type(error).__name__})") from None
        if knowledge.character_id != character_id or knowledge.schema_version != SCHEMA_VERSION:
            raise KnowledgeStoreError(f"{FILE_NAME} for {character_id} belongs to another character or schema")
        return knowledge

    def save(self, knowledge: CharacterKnowledge) -> None:
        if len(knowledge.facts) + len(knowledge.traits) > MAX_ITEMS:
            raise KnowledgeStoreError(f"at most {MAX_ITEMS} approved items per character")
        path = self._path(knowledge.character_id)
        knowledge.updated_at = now()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".knowledge-", suffix=".tmp", dir=path.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(knowledge.model_dump_json(by_alias=True, indent=1))
                os.replace(tmp, path)  # atomic: a crash never leaves a half-written overlay
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
        except OSError as error:
            raise KnowledgeStoreError(f"could not save approved knowledge ({type(error).__name__})") from None

    def reset(self, character_id: str) -> bool:
        """Factory reset: remove the overlay. Returns whether anything was removed."""
        path = self._path(character_id)
        if not path.is_file():
            return False
        try:
            path.unlink()
            path.parent.rmdir() if not any(path.parent.iterdir()) else None
        except OSError as error:
            raise KnowledgeStoreError(f"could not reset approved knowledge ({type(error).__name__})") from None
        return True

    def overlay_text(self, character_id: str) -> tuple[str, str, list[str]]:
        """(lore addition, personality addition, warnings). Never raises: a corrupt overlay is
        reported and ignored so the built-in character still loads."""
        try:
            knowledge = self.load(character_id)
        except (KnowledgeStoreError, InvalidCharacterIdError) as error:
            return "", "", [f"approved knowledge ignored: {error}"]
        return render_lore(knowledge), render_personality(knowledge), []
