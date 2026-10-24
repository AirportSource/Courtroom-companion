"""Native Messages transport. Character context and reply repair stay in shared code."""

from copy import deepcopy
import json
from typing import Any

import httpx
from pydantic import SecretStr

from ..errors import CONTEXT_HINTS, QUOTA_HINTS
from ..base import GenerationRequest, LLMProvider, ProviderCapabilities, ProviderError, RawCompletion, StructuredOutputMode

MESSAGES_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2026-10-21"


class AnthropicError(ProviderError):
    """Only static/bounded messages and provider-independent machine codes leave transport."""

    def __init__(self, code: str, message: str, *, stop_reason: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.stop_reason = stop_reason


def native_output_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Project the existing schema into Anthropic's documented grammar subset.

    This is transport translation, not another CharacterReply definition or validator.
    Like Anthropic's SDK transformation, unsupported bounds move into descriptions.
    The original schema remains in the shared character prompt and is never mutated;
    the shared validator/director retain authority over all reply constraints.
    """
    result = deepcopy(schema)
    constraints = {}
    for keyword in (
        "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
        "minLength", "maxLength", "maxItems", "uniqueItems",
    ):
        if keyword in result:
            constraints[keyword] = result.pop(keyword)
    if "minItems" in result and result["minItems"] not in (0, 1):
        constraints["minItems"] = result.pop("minItems")
    if constraints:
        description = result.get("description", "")
        result["description"] = f"{description} Application constraints: {json.dumps(constraints, sort_keys=True)}".strip()

    # Traverse schema positions only, never property names or enum/default payloads.
    for keyword in ("properties", "$defs", "definitions", "patternProperties"):
        if isinstance(result.get(keyword), dict):
            result[keyword] = {name: native_output_schema(value) for name, value in result[keyword].items()}
    for keyword in ("items", "additionalProperties", "not", "contains"):
        if isinstance(result.get(keyword), dict):
            result[keyword] = native_output_schema(result[keyword])
    for keyword in ("anyOf", "allOf", "oneOf", "prefixItems"):
        if isinstance(result.get(keyword), list):
            result[keyword] = [native_output_schema(value) for value in result[keyword]]
    return result


def _error_hints(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    error = body.get("error") if isinstance(body, dict) else None
    if not isinstance(error, dict):
        return ""
    return " ".join(value.lower()[:1000] for key in ("type", "message")
                    if isinstance(value := error.get(key), str))


class AnthropicProvider(LLMProvider):
    type = "anthropic"
    capabilities = ProviderCapabilities(
        structured_output=StructuredOutputMode.NATIVE, streaming=True, tool_calling=False,
    )

    def __init__(
        self,
        model: str | None,
        api_key: SecretStr | None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(model)
        self._api_key, self._transport = api_key, transport

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.is_success:
            return
        status = response.status_code
        if status in (401, 403):
            raise AnthropicError("auth_failed", "Anthropic authentication failed")
        if status == 429:
            raise AnthropicError("rate_limited", "Anthropic rate limit exceeded")
        hints = _error_hints(response)
        if status == 413:
            raise AnthropicError("provider_limit", "Anthropic request was too large")
        if status in (400, 422) and any(marker in hints for marker in CONTEXT_HINTS):
            raise AnthropicError(
                "context_window_exceeded",
                "Anthropic context window exceeded; reduce conversation/input length. Increasing max_tokens alone will not fix this",
                stop_reason="model_context_window_exceeded",
            )
        if status == 402 or (status in (400, 403) and any(marker in hints for marker in QUOTA_HINTS)):
            raise AnthropicError("provider_limit", "Anthropic account usage or billing limit reached")
        if status in (400, 422) and any(marker in hints for marker in ("output_config", "json_schema", "schema", "structured output")):
            raise AnthropicError("structured_output_unsupported", "Anthropic rejected native structured output")
        if status == 404 or (status in (400, 422) and "model" in hints):
            raise AnthropicError("model_error", "Anthropic model is unavailable or was rejected")
        if status in (400, 422):
            raise AnthropicError("invalid_provider_configuration", "Anthropic request configuration was rejected")
        raise AnthropicError("provider_http_error", f"Anthropic returned HTTP {status}")

    async def generate(self, request: GenerationRequest) -> RawCompletion:
        if not self.model:
            raise AnthropicError("model_error", "No Anthropic model is selected")
        if not self._api_key or not self._api_key.get_secret_value():
            raise AnthropicError("auth_not_configured", "Anthropic API key is not configured on the backend")
        payload = {
            "model": self.model,
            "system": request.system_prompt,
            "messages": [message.model_dump() for message in request.messages],
            "max_tokens": request.settings.max_tokens,
            "stream": False,
            "output_config": {"format": {"type": "json_schema", "schema": native_output_schema(request.response_schema)}},
        }
        # API 2026-10-21 removed temperature/top_p/top_k. Thinking uses model defaults;
        # only final text blocks are extracted below, regardless of thinking behavior.
        headers = {
            "Authorization": f"Bearer {self._api_key.get_secret_value()}",
            "anthropic-version": API_VERSION,
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(request.settings.timeout_s), transport=self._transport) as client:
                response = await client.post(MESSAGES_URL, headers=headers, json=payload)
        except httpx.TimeoutException:
            raise AnthropicError("timeout", "Anthropic request timed out") from None
        except httpx.RequestError:
            raise AnthropicError("anthropic_unreachable", "Anthropic is unreachable") from None
        except (UnicodeError, ValueError):
            raise AnthropicError("invalid_provider_configuration", "Anthropic request configuration is invalid") from None
        self._raise_for_status(response)
        try:
            body = response.json()
        except ValueError:
            raise AnthropicError("malformed_response", "Anthropic returned malformed JSON") from None
        if not isinstance(body, dict) or body.get("type") != "message" or body.get("role") != "assistant":
            raise AnthropicError("malformed_response", "Anthropic returned an invalid assistant message")
        stop_reason = body.get("stop_reason")
        if stop_reason == "refusal":
            raise AnthropicError("provider_refused", "Anthropic declined the generation request", stop_reason=stop_reason)
        if stop_reason == "max_tokens":
            raise AnthropicError("output_token_limit",
                f"Anthropic output reached the requested max_tokens budget ({request.settings.max_tokens} tokens); incomplete output was discarded",
                stop_reason=stop_reason)
        if stop_reason == "model_context_window_exceeded":
            raise AnthropicError("context_window_exceeded",
                "Anthropic exhausted the model context window; reduce conversation/input length. Increasing max_tokens alone will not fix this",
                stop_reason=stop_reason)
        if stop_reason not in ("end_turn", "stop_sequence"):
            raise AnthropicError("malformed_response", "Anthropic did not return a completed final answer")
        content = body.get("content")
        if not isinstance(content, list):
            raise AnthropicError("malformed_response", "Anthropic response is missing content blocks")
        texts = []
        for block in content:
            if not isinstance(block, dict) or block.get("type") not in ("text", "thinking", "redacted_thinking"):
                raise AnthropicError("malformed_response", "Anthropic returned unexpected content blocks")
            if block["type"] == "text":
                if not isinstance(block.get("text"), str):
                    raise AnthropicError("malformed_response", "Anthropic returned an invalid text block")
                texts.append(block["text"])
        text = "".join(texts)
        if not text.strip():
            raise AnthropicError("empty_output", "Anthropic returned no final text")
        usage = body.get("usage")
        metadata: dict[str, Any] = {"stop_reason": stop_reason}
        if isinstance(usage, dict):
            metadata["usage"] = {key: value for key in ("input_tokens", "output_tokens")
                                 if type(value := usage.get(key)) is int and value >= 0}
        return RawCompletion(text, model=self.model, metadata=metadata)
