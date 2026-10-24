"""Provider configuration.

Separates: provider type / endpoint / model / credentials / generation settings.
Credentials are NEVER stored in config: `api_key_env` names an environment variable that holds
the key, resolved at runtime on the server only. Nothing here is ever sent to the frontend.
"""

import os
from collections.abc import Mapping

from pydantic import BaseModel, Field, SecretStr

from .base import GenerationSettings

#: Provider types the architecture plans for. Only "fake" is implemented in this milestone;
#: the gateway registry decides what is actually available.
KNOWN_PROVIDER_TYPES = ("fake", "ollama", "openai_compatible", "openai", "anthropic")


class ProviderConfig(BaseModel):
    type: str = Field(default="fake", pattern=r"^[a-z0-9_]{1,40}$")
    #: e.g. http://localhost:11434 for Ollama, or an OpenAI-compatible endpoint.
    base_url: str | None = None
    model: str | None = None
    #: Name of the environment variable holding the API key (never the key itself).
    api_key_env: str | None = Field(default=None, pattern=r"^[A-Z0-9_]{1,64}$")
    settings: GenerationSettings = Field(default_factory=GenerationSettings)

    def resolve_api_key(self, env: Mapping[str, str] | None = None) -> SecretStr | None:
        if not self.api_key_env:
            return None
        value = (env if env is not None else os.environ).get(self.api_key_env)
        return SecretStr(value) if value else None

    def public_info(self) -> dict[str, str | None]:
        """Safe to expose: no base URL credentials, no key, no env var values."""
        return {"type": self.type, "model": self.model}


def load_provider_config(env: Mapping[str, str] | None = None) -> ProviderConfig:
    """Build the active provider config from COURTROOM_LLM_* environment variables."""
    env = env if env is not None else os.environ
    settings = GenerationSettings(
        temperature=float(env.get("COURTROOM_LLM_TEMPERATURE", 0.7)),
        max_tokens=int(env.get("COURTROOM_LLM_MAX_TOKENS", 600)),
        timeout_s=float(env.get("COURTROOM_LLM_TIMEOUT_S", 30)),
    )
    return ProviderConfig(
        type=env.get("COURTROOM_LLM_PROVIDER", "fake"),
        base_url=env.get("COURTROOM_LLM_BASE_URL") or None,
        model=env.get("COURTROOM_LLM_MODEL") or None,
        api_key_env=env.get("COURTROOM_LLM_API_KEY_ENV") or None,
        settings=settings,
    )
