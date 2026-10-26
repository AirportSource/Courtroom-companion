"""LLM Gateway: the single entry point the application uses to talk to any model.

Owns the provider registry, timeouts, exception isolation and response validation/repair.
Callers only see CharacterReply (or a failure they must degrade gracefully from).
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .base import GenerationRequest, GenerationSettings, LLMProvider, OutputWorkload, ProviderError
from .budgets import settings_for_workload
from .errors import CONTEXT_EXCEEDED, OUTPUT_TRUNCATED, failure_class, normalize_stop_reason
from .config import DEFAULT_OLLAMA_BASE_URL, ProviderConfig
from .providers.fake import FakeProvider
from .providers.ollama import OllamaProvider
from .providers.openai_compatible import OpenAICompatibleProvider
from .providers.anthropic import AnthropicProvider
from .providers.subscription_cli import ClaudeCodeProvider, CodexProvider
from .repair import parse_reply, decode_reply_content
from .schemas import CharacterReply, ChatMessage
from ..artifacts.contracts import CreateTextArtifact
from ..artifacts.parsing import parse_artifact_turn

logger = logging.getLogger(__name__)

ProviderFactory = Callable[[ProviderConfig], LLMProvider]

#: Provider type -> factory. Adding a provider = writing an adapter + registering it here.
DEFAULT_REGISTRY: dict[str, ProviderFactory] = {
    "fake": lambda config: FakeProvider(model=config.model),
    "ollama": lambda config: OllamaProvider(base_url=config.base_url or DEFAULT_OLLAMA_BASE_URL, model=config.model),
    "openai_compatible": lambda config: OpenAICompatibleProvider(
        base_url=config.base_url,
        model=config.model,
        api_key=config.resolve_api_key(),
    ),
    "anthropic": lambda config: AnthropicProvider(model=config.model, api_key=config.resolve_api_key()),
    # Subscription plans through the official CLIs (D-072); no API key involved.
    "claude_code": lambda config: ClaudeCodeProvider(model=config.model),
    "codex": lambda config: CodexProvider(model=config.model),
}


class UnknownProviderError(ValueError):
    pass


@dataclass
class GatewayResult:
    reply: CharacterReply | None
    warnings: list[str] = field(default_factory=list)
    #: Short machine-readable failure reason ("timeout", "provider_error", "invalid_reply").
    error: str | None = None
    artifact_action: CreateTextArtifact | None = None
    generation: dict[str, Any] = field(default_factory=dict)
    #: The decoded structured reply (dict) when available; the service reads `toolRequest` from it.
    raw_data: Any = None


class LLMGateway:
    def __init__(self, config: ProviderConfig, registry: dict[str, ProviderFactory] | None = None) -> None:
        registry = registry if registry is not None else DEFAULT_REGISTRY
        factory = registry.get(config.type)
        if factory is None:
            raise UnknownProviderError(
                f"unknown LLM provider '{config.type}' (available: {', '.join(sorted(registry))})"
            )
        self.config = config
        self.registry = registry
        self.provider = factory(config)

    def info(self) -> dict[str, Any]:
        """Public, secret-free description of the active provider."""
        caps = self.provider.capabilities
        return {
            **self.config.public_info(),
            "model": self.provider.model,
            "capabilities": {
                "structuredOutput": caps.structured_output.value,
                "streaming": caps.streaming,
                "toolCalling": caps.tool_calling,
            },
        }

    async def generate_reply(
        self, system_prompt: str, messages: list[ChatMessage], response_schema: dict[str, Any],
        *, workload: OutputWorkload = OutputWorkload.DIALOGUE, language: str = "en",
    ) -> GatewayResult:
        workload = OutputWorkload(workload)
        settings = settings_for_workload(self.config.settings, workload)
        request = GenerationRequest(system_prompt, messages, response_schema, settings, workload, language)
        generation = {"workload": workload.value, "maxOutputTokens": settings.max_tokens}
        def with_stop(reason):
            # Only bounded transport status, never arbitrary provider metadata or hidden text.
            reason = normalize_stop_reason(reason)
            if reason:
                generation["stopReason"] = reason
        def failed(warnings, code):
            if failure_class(code):
                generation["failureClass"] = failure_class(code)
            return GatewayResult(None, warnings, error=code, generation=generation)
        try:
            raw = await asyncio.wait_for(self.provider.generate(request), timeout=settings.timeout_s)
        except TimeoutError:
            logger.warning("LLM provider %s timed out", self.config.type)
            return failed(["provider timed out"], "timeout")
        except ProviderError as error:
            logger.warning("LLM provider %s failed: %s", self.config.type, error)
            with_stop(getattr(error, "stop_reason", None))
            return failed([str(error)], error.code)
        except Exception:  # isolate any adapter/vendor failure from the app
            logger.exception("LLM provider %s failed", self.config.type)
            return failed(["provider failed"], "provider_error")

        with_stop(raw.metadata.get("stop_reason"))
        # Defence in depth for any adapter: an incomplete generation is never parsed, even if it
        # looks like valid JSON.
        if generation.get("stopReason") == "max_tokens":
            return failed([f"Output reached the requested max_tokens budget ({settings.max_tokens} tokens); incomplete output was discarded"], OUTPUT_TRUNCATED)
        if generation.get("stopReason") == "model_context_window_exceeded":
            return failed(["The model context window was exceeded; incomplete output was discarded"], CONTEXT_EXCEEDED)
        raw_data = raw.content if isinstance(raw.content, dict) else None
        if raw_data is None and "toolRequest" in response_schema.get("properties", {}) and isinstance(raw.content, str):
            raw_data = decode_reply_content(raw.content, [])
        if "artifactAction" in response_schema.get("properties", {}):
            parsed = parse_artifact_turn(raw.content)
            if parsed.error and failure_class(parsed.error):
                generation["failureClass"] = failure_class(parsed.error)
            return GatewayResult(parsed.reply, parsed.warnings, parsed.error, parsed.action, generation, raw_data)
        repaired = parse_reply(raw.content)
        if repaired.reply is None:
            return GatewayResult(None, repaired.warnings, error="invalid_reply", generation=generation)
        return GatewayResult(repaired.reply, repaired.warnings, generation=generation, raw_data=raw_data)


#: Output budget for non-dialogue structured tasks (e.g. lore extraction, D-101). Same cap as text
#: artifacts would be wasteful; one chunk's facts fit comfortably in 8k tokens.
STRUCTURED_OUTPUT_TOKENS = 8192
STRUCTURED_TEMPERATURE = 0.2


@dataclass
class StructuredResult:
    """A decoded JSON object for a caller-defined schema; the CALLER validates it (never trusted)."""

    data: dict[str, Any] | None
    warnings: list[str] = field(default_factory=list)
    error: str | None = None
    generation: dict[str, Any] = field(default_factory=dict)


def decode_json_object(content: str | dict[str, Any] | None) -> dict[str, Any] | None:
    """A JSON object from a dict, a JSON string, fenced JSON, or JSON embedded in prose."""
    if isinstance(content, dict):
        return content
    if not isinstance(content, str):
        return None
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    for candidate in (text, text[text.find("{"):text.rfind("}") + 1] if "{" in text else ""):
        try:
            value = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(value, dict):
            return value
    return None


async def generate_structured(
    gateway: "LLMGateway", system_prompt: str, messages: list[ChatMessage], response_schema: dict[str, Any],
    *, max_tokens: int = STRUCTURED_OUTPUT_TOKENS, temperature: float = STRUCTURED_TEMPERATURE,
) -> StructuredResult:
    """Same providers, timeout, truncation guard and failure isolation as `generate_reply`, for a
    caller-supplied schema. The conversation CharacterReply contract is not involved."""
    values = gateway.config.settings.model_dump()
    values.update(max_tokens=max(int(values["max_tokens"]), max_tokens), temperature=temperature)
    settings = GenerationSettings.model_validate(values)
    request = GenerationRequest(system_prompt, messages, response_schema, settings, OutputWorkload.TEXT_ARTIFACT)
    generation: dict[str, Any] = {"maxOutputTokens": settings.max_tokens}
    try:
        raw = await asyncio.wait_for(gateway.provider.generate(request), timeout=settings.timeout_s)
    except TimeoutError:
        return StructuredResult(None, ["provider timed out"], "timeout", generation)
    except ProviderError as error:
        logger.warning("LLM provider %s failed: %s", gateway.config.type, error)
        return StructuredResult(None, [str(error)], error.code, generation)
    except Exception:  # isolate any adapter/vendor failure from the app
        logger.exception("LLM provider %s failed", gateway.config.type)
        return StructuredResult(None, ["provider failed"], "provider_error", generation)
    stop = normalize_stop_reason(raw.metadata.get("stop_reason"))
    if stop:
        generation["stopReason"] = stop
    if stop == "max_tokens":
        return StructuredResult(None, [f"Output reached the {settings.max_tokens}-token budget; incomplete output was discarded"],
                                OUTPUT_TRUNCATED, generation)
    if stop == "model_context_window_exceeded":
        return StructuredResult(None, ["The model context window was exceeded"], CONTEXT_EXCEEDED, generation)
    data = decode_json_object(raw.content)
    if data is None:
        return StructuredResult(None, ["the model did not return a JSON object"], "invalid_json", generation)
    return StructuredResult(data, [], None, generation)
