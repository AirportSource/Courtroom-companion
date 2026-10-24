"""Strict artifact actions beside the existing shared dialogue repair pipeline."""

from dataclasses import dataclass, field

from pydantic import ValidationError

from ..llm.errors import ARTIFACT_TOO_LARGE
from ..llm.repair import decode_reply_content, parse_reply
from ..llm.schemas import CharacterReply
from .contracts import MAX_ARTIFACT_BYTES, CreateTextArtifact, display_filename


@dataclass
class TurnParseResult:
    reply: CharacterReply | None
    warnings: list[str] = field(default_factory=list)
    action: CreateTextArtifact | None = None
    error: str | None = None


def parse_artifact_turn(content) -> TurnParseResult:
    warnings = []
    data = decode_reply_content(content, warnings) if isinstance(content, str) else content
    # Malformed structured output must not be displayed as raw JSON or become a partial action.
    if isinstance(content, str) and "reply was not JSON; treating it as plain dialogue text" in warnings:
        if content.lstrip().startswith(("{", "```")):
            return TurnParseResult(None, ["Invalid structured turn; no file was created."], error="invalid_reply")
    action = None
    if isinstance(data, dict) and data.get("artifactAction") is not None:
        try:
            if set(data) - {"beats", "settleEmotion", "settle_emotion", "artifactAction", "toolRequest"}:
                raise ValueError()
            content = data["artifactAction"].get("content") if isinstance(data["artifactAction"], dict) else None
            if isinstance(content, str) and len(content.encode("utf-8", "replace")) > MAX_ARTIFACT_BYTES:
                return TurnParseResult(None, ["The generated file is larger than the 64 KiB limit; no file was created."], error=ARTIFACT_TOO_LARGE)
            action = CreateTextArtifact.model_validate(data["artifactAction"])
            display_filename(action.filename, action.format)
        except ValidationError as error:
            locations = {item["loc"][0] for item in error.errors(include_input=False) if item["loc"]}
            message = "Invalid artifact instruction; no file was created."
            if "format" in locations:
                message = "Only txt, md and py text artifacts are supported; no file was created."
            elif "content" in locations:
                message = "File content must be nonempty UTF-8 text of at most 64 KiB; no file was created."
            elif "filename" in locations:
                message = "The display filename must contain 1 to 512 characters; no file was created."
            return TurnParseResult(None, [message], error="invalid_artifact_action")
        except (ValueError, TypeError):
            return TurnParseResult(None, ["Invalid display name, extension or action fields; no file was created."], error="invalid_artifact_action")
    repaired = parse_reply(data)
    if repaired.reply is None:
        return TurnParseResult(None, warnings + repaired.warnings, error="invalid_reply")
    return TurnParseResult(repaired.reply, warnings + repaired.warnings, action)
