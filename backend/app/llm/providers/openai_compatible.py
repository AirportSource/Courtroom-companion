"""Thin adapter for OpenAI-compatible Chat Completions endpoints.

The adapter owns HTTP translation and response extraction only. Character context, schema
construction, validation/repair and performance direction stay in their shared layers.
"""

from typing import Any

import httpx
from pydantic import SecretStr

from ..errors import CONTEXT_HINTS, QUOTA_HINTS, normalize_stop_reason
from ..base import (
    GenerationRequest,
    LLMProvider,
    ProviderCapabilities,
    ProviderError,
    RawCompletion,
    StructuredOutputMode,
)


class OpenAICompatibleConfigurationError(ProviderError):
    code = "invalid_provider_configuration"


class OpenAICompatibleAuthNotConfiguredError(ProviderError):
    code = "auth_not_configured"


class OpenAICompatibleAuthError(ProviderError):
    code = "auth_failed"


class OpenAICompatibleRateLimitError(ProviderError):
    code = "rate_limited"


class OpenAICompatibleLimitedError(ProviderError):
    """Output cap, context window or request/quota limit; `code` selects which."""

    def __init__(self, code: str, message: str, *, stop_reason: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.stop_reason = stop_reason


class OpenAICompatibleModelError(ProviderError):
    code = "model_error"


class OpenAICompatibleStructuredOutputError(ProviderError):
    code = "structured_output_unsupported"


class OpenAICompatibleUnavailableError(ProviderError):
    code = "openai_compatible_unreachable"


class OpenAICompatibleTimeoutError(ProviderError):
    code = "timeout"


class OpenAICompatibleHTTPError(ProviderError):
    code = "provider_http_error"


class OpenAICompatibleResponseError(ProviderError):
    code = "malformed_response"


class OpenAICompatibleEmptyResponseError(ProviderError):
    code = "empty_output"


def _error_hints(response: httpx.Response) -> str:
    """Extract bounded classification hints, never text used in a returned exception."""
    try:
        payload = response.json()
    except ValueError:
        return ""
    if not isinstance(payload, dict):
        return ""
    error = payload.get("error")
    if not isinstance(error, dict):
        return ""
    values = [error.get(key) for key in ("code", "type", "param", "message")]
    return " ".join(value.lower() for value in values if isinstance(value, str))[:1000]


class OpenAICompatibleProvider(LLMProvider):
    type = "openai_compatible"
    capabilities = ProviderCapabilities(
        structured_output=StructuredOutputMode.NATIVE,
        streaming=True,
        tool_calling=False,
    )

    def __init__(
        self,
        base_url: str | None,
        model: str | None,
        api_key: SecretStr | None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(model)
        self.base_url = (base_url or "").rstrip("/")
        self._api_key = api_key
        self._transport = transport

    @property
    def api_key_configured(self) -> bool:
        return self._api_key is not None and bool(self._api_key.get_secret_value())

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.is_success:
            return
        if response.status_code in {401, 403}:
            raise OpenAICompatibleAuthError("OpenAI-compatible authentication failed")
        if response.status_code == 429:
            raise OpenAICompatibleRateLimitError("OpenAI-compatible endpoint rate limit exceeded")

        hints = _error_hints(response)
        if response.status_code == 413 and not any(marker in hints for marker in CONTEXT_HINTS):
            raise OpenAICompatibleLimitedError("provider_limit", "OpenAI-compatible request was too large for the endpoint")
        if response.status_code in {400, 413, 422} and any(marker in hints for marker in CONTEXT_HINTS):
            raise OpenAICompatibleLimitedError(
                "context_window_exceeded",
                "OpenAI-compatible context window exceeded; shorten the conversation or input. Increasing max_tokens alone will not fix this",
                stop_reason="model_context_window_exceeded",
            )
        if response.status_code == 402 or (response.status_code in {400, 403} and any(m in hints for m in QUOTA_HINTS)):
            raise OpenAICompatibleLimitedError("provider_limit", "OpenAI-compatible account quota or billing limit reached")
        if response.status_code in {400, 422} and any(
            marker in hints for marker in ("response_format", "json_schema", "structured output")
        ):
            raise OpenAICompatibleStructuredOutputError(
                "OpenAI-compatible endpoint rejected native structured output"
            )
        if response.status_code in {400, 404, 422}:
            raise OpenAICompatibleModelError("OpenAI-compatible model or request was rejected")
        raise OpenAICompatibleHTTPError(
            f"OpenAI-compatible endpoint returned HTTP {response.status_code}"
        )

    async def generate(self, request: GenerationRequest) -> RawCompletion:
        if not self.base_url:
            raise OpenAICompatibleConfigurationError("OpenAI-compatible base URL is not configured")
        if not self.model:
            raise OpenAICompatibleModelError("no OpenAI-compatible model is selected")
        if not self.api_key_configured:
            raise OpenAICompatibleAuthNotConfiguredError(
                "OpenAI-compatible API key is not configured on the backend"
            )

        messages = [{"role": "system", "content": request.system_prompt}]
        messages.extend(message.model_dump() for message in request.messages)
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "temperature": request.settings.temperature,
            "max_tokens": request.settings.max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "character_reply",
                    "strict": True,
                    "schema": request.response_schema,
                },
            },
        }
        headers = {"Authorization": f"Bearer {self._api_key.get_secret_value()}"}
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(request.settings.timeout_s),
                transport=self._transport,
            ) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                )
        except httpx.TimeoutException as error:
            raise OpenAICompatibleTimeoutError("OpenAI-compatible request timed out") from error
        except httpx.RequestError as error:
            raise OpenAICompatibleUnavailableError(
                "OpenAI-compatible endpoint is unreachable"
            ) from error

        self._raise_for_status(response)
        try:
            data = response.json()
        except ValueError as error:
            raise OpenAICompatibleResponseError(
                "OpenAI-compatible endpoint returned malformed JSON"
            ) from error
        if not isinstance(data, dict):
            raise OpenAICompatibleResponseError("OpenAI-compatible response is not an object")
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise OpenAICompatibleResponseError("OpenAI-compatible response is missing choices")
        # Completion status is checked before content: a cut-off reply (even a parseable-looking or
        # empty one, e.g. reasoning consumed the whole cap) must never reach JSON repair.
        finish_reason = choices[0].get("finish_reason")
        stop_reason = normalize_stop_reason(finish_reason)
        if stop_reason == "max_tokens":
            raise OpenAICompatibleLimitedError(
                "output_token_limit",
                f"OpenAI-compatible output reached the requested max_tokens budget ({request.settings.max_tokens} tokens); incomplete output was discarded",
                stop_reason=stop_reason,
            )
        if stop_reason == "refusal":
            raise OpenAICompatibleLimitedError("provider_refused", "OpenAI-compatible endpoint declined the generation request", stop_reason=stop_reason)
        message = choices[0].get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise OpenAICompatibleResponseError(
                "OpenAI-compatible response is missing choices[0].message.content"
            )
        content = message["content"]
        if not content.strip():
            raise OpenAICompatibleEmptyResponseError(
                "OpenAI-compatible endpoint returned empty assistant content"
            )

        metadata: dict[str, Any] = {}
        if isinstance(finish_reason, str):
            metadata["finish_reason"] = finish_reason
        if stop_reason:
            metadata["stop_reason"] = stop_reason
        usage = data.get("usage")
        if isinstance(usage, dict):
            metadata["usage"] = {
                key: usage[key]
                for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                if isinstance(usage.get(key), int)
            }
        return RawCompletion(
            content=content,
            model=data.get("model") if isinstance(data.get("model"), str) else self.model,
            metadata=metadata,
        )
