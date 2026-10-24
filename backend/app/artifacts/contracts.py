"""The single provider-independent text-artifact action contract."""

import json
import re
import unicodedata
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_ARTIFACT_BYTES = 64 * 1024
ArtifactFormat = Literal["txt", "md", "py"]
MIME_TYPES = {"txt": "text/plain", "md": "text/markdown", "py": "text/x-python"}


class CreateTextArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    type: Literal["create_text_artifact"]
    filename: str = Field(min_length=1, max_length=512)
    format: ArtifactFormat
    content: str = Field(min_length=1, max_length=MAX_ARTIFACT_BYTES)

    @field_validator("content")
    @classmethod
    def small_utf8_text(cls, value: str) -> str:
        try:
            valid = bool(value.strip()) and "\x00" not in value and len(value.encode("utf-8")) <= MAX_ARTIFACT_BYTES
        except UnicodeError:
            valid = False
        if not valid:
            raise ValueError("Artifact content must be nonempty UTF-8 text of at most 64 KiB.")
        return value


def display_filename(filename: str, extension: ArtifactFormat) -> str:
    """Discard path components; a display name never participates in storage addressing."""
    name = re.split(r"[/\\]", unicodedata.normalize("NFC", filename))[-1]
    name = "".join(c for c in name if unicodedata.category(c)[0] != "C" and c not in '<>:"|?*')
    name = name.strip(" .")
    if not name or name in {".", ".."}:
        raise ValueError("The artifact needs a usable display filename.")
    if "." in name:
        stem, suffix = name.rsplit(".", 1)
        if suffix.lower() != extension:
            raise ValueError("The display extension must match txt, md or py format.")
    else:
        stem = name
    stem = stem.strip(" .")
    if not stem:
        raise ValueError("The artifact needs a usable display filename.")
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", stem, re.I):
        stem = "_" + stem
    stem = stem[:80]
    while len(stem.encode("utf-8")) > 160:
        stem = stem[:-1]
    return f"{stem.rstrip(' .')}.{extension}"


def turn_schema(character_schema: dict) -> dict:
    """Extend the shared turn envelope, leaving CharacterReply and its schema untouched."""
    schema = json.loads(json.dumps(character_schema))
    schema["properties"]["artifactAction"] = {
        "anyOf": [CreateTextArtifact.model_json_schema(), {"type": "null"}]
    }
    return schema


def turn_prompt(character_prompt: str, schema: dict) -> str:
    return character_prompt + "\n\n" + """## Optional saved text artifact
The dialogue/CharacterReply rules above still apply to beats. There is one separate optional
artifactAction field in the turn envelope; only that field may contain a display filename
and file content. Use it ONLY when the user explicitly asks you to create/save a textual file.
For ordinary conversation, explanations and questions, omit artifactAction or set it to null.
Allowed action: {type: "create_text_artifact", filename: "name.txt", format: "txt"|"md"|"py", content: "..."}.
Create at most one small file (64 KiB UTF-8). Supply complete textual content, without an outer
Markdown fence. Python is inert text: it is never executed, imported or compiled. You have no
shell, filesystem browsing, path, command, interpreter or execution tool. Do not request them.
Keep file content out of dialogue beats. Give one short coherent final acknowledgement in
character; the application saves successfully before presenting it, or replaces it with an
error response on failure. The backend chooses storage and may sanitize/uniquify the name.
This is the full shared turn schema (supersedes the earlier dialogue-only envelope):
""" + json.dumps(schema)
