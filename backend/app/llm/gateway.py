"""LLM Gateway: the single entry point the application uses to talk to any model.

Owns the provider registry, timeouts, exception isolation and response validation/repair.
Callers only see CharacterReply (or a failure they must degrade gracefully from).
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from .base import GenerationRequest, LLMProvider, ProviderError
from .config import DEFAULT_OLLAMA_BASE_URL, ProviderConfig
from .providers.fake import FakeProvider
from .providers.ollama import OllamaProvider
from .providers.openai_compatible import OpenAICompatibleProvider
from .providers.anthropic import AnthropicProvider
from .repair import parse_reply
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
        self, system_prompt: str, messages: list[ChatMessage], response_schema: dict[str, Any]
    ) -> GatewayResult:
        request = GenerationRequest(system_prompt, messages, response_schema, self.config.settings)
        try:
            raw = await asyncio.wait_for(self.provider.generate(request), timeout=self.config.settings.timeout_s)
        except TimeoutError:
            logger.warning("LLM provider %s timed out", self.config.type)
            return GatewayResult(None, ["provider timed out"], error="timeout")
        except ProviderError as error:
            logger.warning("LLM provider %s failed: %s", self.config.type, error)
            return GatewayResult(None, [str(error)], error=error.code)
        except Exception:  # isolate any adapter/vendor failure from the app
            logger.exception("LLM provider %s failed", self.config.type)
            return GatewayResult(None, ["provider failed"], error="provider_error")

        if "artifactAction" in response_schema.get("properties", {}):
            parsed = parse_artifact_turn(raw.content)
            return GatewayResult(parsed.reply, parsed.warnings, parsed.error, parsed.action)
        repaired = parse_reply(raw.content)
        if repaired.reply is None:
            return GatewayResult(None, repaired.warnings, error="invalid_reply")
        return GatewayResult(repaired.reply, repaired.warnings)
