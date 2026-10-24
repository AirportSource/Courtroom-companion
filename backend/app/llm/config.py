"""Provider configuration.

Separates: provider type / endpoint / model / credentials / generation settings.
Persisted config contains only an environment reference. Profile resolution may bind a
transient SecretStr in a private attribute; it is excluded from serialization and repr.
Nothing here is ever sent to the frontend.
"""

import os
from collections.abc import Mapping
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, PrivateAttr, SecretStr, field_validator, model_validator

from .base import GenerationSettings

#: Provider types recognized by configuration. The registry decides which are available;
#: Fake, Ollama, OpenAI-compatible and Anthropic are implemented; openai reserves a future adapter.
KNOWN_PROVIDER_TYPES = ("fake", "ollama", "openai_compatible", "openai", "anthropic", "claude_code", "codex")
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_API_KEY_ENV = "COURTROOM_LLM_API_KEY"


class ProviderConfig(BaseModel):
    _profile_credential: SecretStr | None = PrivateAttr(default=None)
    type: str = Field(default="fake", pattern=r"^[a-z0-9_]{1,40}$")
    #: e.g. http://localhost:11434 for Ollama, or an OpenAI-compatible endpoint.
    base_url: str | None = None
    model: str | None = None
    #: Name of the environment variable holding the API key (never the key itself).
    api_key_env: str | None = Field(default=DEFAULT_API_KEY_ENV, pattern=r"^[A-Z0-9_]{1,64}$")
    settings: GenerationSettings = Field(default_factory=GenerationSettings)

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().rstrip("/")
        parts = urlsplit(normalized)
        parts.port  # Validate numeric ports and their range before HTTP transport.
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or any(character.isspace() for character in normalized)
            or "\\" in normalized
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or parts.fragment
        ):
            raise ValueError("base URL must use HTTP(S) and have no credentials, query, or fragment")
        return normalized

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: str | None) -> str | None:
        value = value.strip() if value else None
        return value or None

    @model_validator(mode="after")
    def apply_provider_defaults(self) -> "ProviderConfig":
        if self.type == "ollama" and self.base_url is None:
            self.base_url = DEFAULT_OLLAMA_BASE_URL
        return self

    def resolve_api_key(self, env: Mapping[str, str] | None = None) -> SecretStr | None:
        if self._profile_credential is not None:
            return self._profile_credential
        if not self.api_key_env:
            return None
        value = (env if env is not None else os.environ).get(self.api_key_env)
        return SecretStr(value) if value else None

    def bind_credential(self, secret: SecretStr | None) -> None:
        """Attach an ephemeral resolved credential; never serialized or persisted."""
        self._profile_credential = secret

    def public_info(self) -> dict[str, str | None]:
        """Safe to expose: no base URL credentials, no key, no env var values."""
        return {"type": self.type, "model": self.model}


def load_provider_config(env: Mapping[str, str] | None = None) -> ProviderConfig:
    """Build the active provider config from COURTROOM_LLM_* environment variables."""
    env = env if env is not None else os.environ
    settings = GenerationSettings(
        temperature=float(env.get("COURTROOM_LLM_TEMPERATURE", 0.7)),
        max_tokens=int(env.get("COURTROOM_LLM_MAX_TOKENS", 600)),
        timeout_s=float(env.get("COURTROOM_LLM_TIMEOUT_S", 120)),
    )
    return ProviderConfig(
        type=env.get("COURTROOM_LLM_PROVIDER", "fake"),
        base_url=env.get("COURTROOM_LLM_BASE_URL") or None,
        model=env.get("COURTROOM_LLM_MODEL") or None,
        api_key_env=env.get("COURTROOM_LLM_API_KEY_ENV") or DEFAULT_API_KEY_ENV,
        settings=settings,
    )
