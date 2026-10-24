"""Thin adapter for Ollama's native HTTP API.

Only transport translation and response extraction live here. Character context, schema
construction, validation/repair and performance direction remain in their shared layers.
"""

from typing import Any

import httpx

from ..base import (
    GenerationRequest,
    LLMProvider,
    ProviderCapabilities,
    ProviderError,
    RawCompletion,
    StructuredOutputMode,
)
from ..config import DEFAULT_OLLAMA_BASE_URL


class OllamaUnavailableError(ProviderError):
    code = "ollama_unreachable"


class OllamaTimeoutError(ProviderError):
    code = "timeout"


class OllamaModelNotFoundError(ProviderError):
    code = "model_not_found"


class OllamaHTTPError(ProviderError):
    code = "provider_http_error"


class OllamaResponseError(ProviderError):
    code = "malformed_response"


class OllamaEmptyResponseError(ProviderError):
    code = "empty_output"


class OllamaProvider(LLMProvider):
    type = "ollama"
    capabilities = ProviderCapabilities(
        structured_output=StructuredOutputMode.NATIVE,
        streaming=True,
        tool_calling=False,
    )

    def __init__(
        self,
        base_url: str = DEFAULT_OLLAMA_BASE_URL,
        model: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        super().__init__(model)
        self.base_url = base_url.rstrip("/")
        self._transport = transport

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        timeout_s: float,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(timeout_s),
                transport=self._transport,
            ) as client:
                response = await client.request(method, path, json=json)
        except httpx.TimeoutException as error:
            raise OllamaTimeoutError("Ollama request timed out") from error
        except httpx.RequestError as error:
            raise OllamaUnavailableError("Ollama server is unreachable") from error

        if response.status_code == 404 and path == "/api/chat":
            raise OllamaModelNotFoundError("selected Ollama model is not installed")
        if not response.is_success:
            raise OllamaHTTPError(f"Ollama returned HTTP {response.status_code}")
        try:
            data = response.json()
        except ValueError as error:
            raise OllamaResponseError("Ollama returned malformed JSON") from error
        if not isinstance(data, dict):
            raise OllamaResponseError("Ollama response is not an object")
        return data

    async def generate(self, request: GenerationRequest) -> RawCompletion:
        if not self.model:
            raise OllamaModelNotFoundError("no Ollama model is selected")
        messages = [{"role": "system", "content": request.system_prompt}]
        messages.extend(message.model_dump() for message in request.messages)
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "think": False,
            "format": request.response_schema,
            "options": {
                "temperature": request.settings.temperature,
                "num_predict": request.settings.max_tokens,
            },
        }
        data = await self._request_json(
            "POST",
            "/api/chat",
            timeout_s=request.settings.timeout_s,
            json=payload,
        )
        message = data.get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise OllamaResponseError("Ollama response is missing message.content")
        content = message["content"]
        if not content.strip():
            raise OllamaEmptyResponseError("Ollama returned empty assistant content")
        metadata_keys = (
            "done_reason",
            "total_duration",
            "load_duration",
            "prompt_eval_count",
            "prompt_eval_duration",
            "eval_count",
            "eval_duration",
        )
        metadata = {key: data[key] for key in metadata_keys if key in data}
        # Deliberately ignore message.thinking: only final assistant content enters repair/history.
        return RawCompletion(content=content, model=data.get("model") or self.model, metadata=metadata)

    async def list_models(self, timeout_s: float = 10.0) -> list[dict[str, Any]]:
        data = await self._request_json("GET", "/api/tags", timeout_s=timeout_s)
        raw_models = data.get("models")
        if not isinstance(raw_models, list):
            raise OllamaResponseError("Ollama model list is malformed")
        models: list[dict[str, Any]] = []
        for raw in raw_models:
            if not isinstance(raw, dict):
                continue
            name = raw.get("name") if isinstance(raw.get("name"), str) else None
            model = raw.get("model") if isinstance(raw.get("model"), str) else name
            if not name and not model:
                continue
            details = raw.get("details") if isinstance(raw.get("details"), dict) else {}
            models.append(
                {
                    "name": name or model,
                    "model": model or name,
                    "parameterSize": details.get("parameter_size")
                    if isinstance(details.get("parameter_size"), str)
                    else None,
                    "quantizationLevel": details.get("quantization_level")
                    if isinstance(details.get("quantization_level"), str)
                    else None,
                    "size": raw.get("size") if isinstance(raw.get("size"), int) else None,
                }
            )
        return models
