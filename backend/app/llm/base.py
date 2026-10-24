"""The provider adapter contract.

A provider adapter is the ONLY place that knows a vendor's SDK, HTTP API or model quirks.
It turns a GenerationRequest into a RawCompletion. Parsing, validation and repair of the
completion are shared and happen in the gateway, so every provider gets the same safety.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from .schemas import ChatMessage


class StructuredOutputMode(str, Enum):
    """How a provider can be made to return the CharacterReply structure."""

    #: A: the API enforces a JSON schema natively.
    NATIVE = "native"
    #: B: the model is instructed to output JSON; the gateway parses + validates + repairs (C).
    JSON_INSTRUCTED = "json_instructed"


@dataclass(frozen=True)
class ProviderCapabilities:
    structured_output: StructuredOutputMode = StructuredOutputMode.JSON_INSTRUCTED
    streaming: bool = False
    tool_calling: bool = False


class GenerationSettings(BaseModel):
    """Generic generation parameters; adapters map them to vendor parameters."""

    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=600, ge=16, le=8192)
    timeout_s: float = Field(default=120.0, gt=0, le=300)


@dataclass
class GenerationRequest:
    system_prompt: str
    messages: list[ChatMessage]
    #: JSON schema of the expected reply (with this character's allowed IDs as enums).
    response_schema: dict[str, Any]
    settings: GenerationSettings = field(default_factory=GenerationSettings)


@dataclass
class RawCompletion:
    """Unvalidated provider output: a JSON string, plain text, or an already-parsed dict."""

    content: str | dict[str, Any] | None
    model: str | None = None
    #: Provider diagnostics (durations/token counts etc.); never part of CharacterReply.
    metadata: dict[str, Any] = field(default_factory=dict)


class ProviderError(Exception):
    """Raised by adapters for vendor/network failures (message must not contain secrets)."""

    code = "provider_error"


class LLMProvider(ABC):
    #: Registry key, e.g. "fake", "ollama".
    type: str = ""
    capabilities: ProviderCapabilities = ProviderCapabilities()

    def __init__(self, model: str | None = None) -> None:
        self.model = model

    @abstractmethod
    async def generate(self, request: GenerationRequest) -> RawCompletion:
        """Call the model. Must not parse/validate the reply; must not leak credentials."""
