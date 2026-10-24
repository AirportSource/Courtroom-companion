"""Provider-independent failure taxonomy and stop-reason normalization.

Public error codes stay specific (frontend contract); `failure_class` groups them for diagnostics.
Adapters only translate vendor signals into these codes; the gateway applies them uniformly.
"""

OUTPUT_TRUNCATED = "output_token_limit"
CONTEXT_EXCEEDED = "context_window_exceeded"
ARTIFACT_TOO_LARGE = "artifact_too_large"
PROVIDER_LIMIT = "provider_limit"

_CLASSES = {
    OUTPUT_TRUNCATED: "output_truncated",
    CONTEXT_EXCEEDED: "context_window_exceeded",
    ARTIFACT_TOO_LARGE: "artifact_too_large",
    PROVIDER_LIMIT: "provider_limit",
    "rate_limited": "provider_limit",
    "provider_http_error": "unknown_provider_error",
    "provider_error": "unknown_provider_error",
    "malformed_response": "unknown_provider_error",
}

CONTEXT_HINTS = (
    "context_length_exceeded", "context length", "context window", "prompt is too long",
    "too many tokens", "token count exceeds", "input token count", "maximum context", "input length",
)
QUOTA_HINTS = ("insufficient_quota", "quota", "billing", "credit balance", "request_too_large")

_STOP = {
    "length": "max_tokens", "max_tokens": "max_tokens",
    "stop": "end_turn", "end_turn": "end_turn", "stop_sequence": "stop_sequence",
    "content_filter": "refusal", "refusal": "refusal",
    "model_context_window_exceeded": "model_context_window_exceeded",
}


def failure_class(code: str | None) -> str | None:
    return _CLASSES.get(code or "")


def normalize_stop_reason(value) -> str | None:
    """Map vendor finish/done/stop reasons onto the existing bounded diagnostic vocabulary."""
    return _STOP.get(value) if isinstance(value, str) else None
