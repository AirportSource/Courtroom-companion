"""Validated local profile metadata, atomic persistence, and credential resolution."""

import os
import tempfile
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..llm.base import GenerationSettings
from ..runtime import paths as runtime_paths
from ..llm.config import ProviderConfig
from .credentials import CredentialStore, CredentialStoreError

ProviderType = Literal["fake", "ollama", "openai_compatible", "anthropic"]
CREDENTIAL_PROVIDER_TYPES = frozenset({"openai_compatible", "anthropic"})


class ProfileDraft(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    provider_type: ProviderType = Field(alias="providerType")
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=2048)
    model: str | None = Field(default=None, max_length=200)
    api_key_env: str | None = Field(default=None, alias="apiKeyEnv", pattern=r"^[A-Z0-9_]{1,64}$")
    generation_settings: GenerationSettings = Field(default_factory=GenerationSettings, alias="generationSettings")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("profile name is required")
        return value

    @model_validator(mode="after")
    def validate_provider(self):
        config = ProviderConfig(type=self.provider_type, base_url=self.base_url, model=self.model)
        self.base_url, self.model = config.base_url, config.model
        if self.provider_type == "anthropic":
            if self.base_url is not None or not self.model:
                raise ValueError("Anthropic profiles require a model and use the native endpoint without a base URL")
        elif self.provider_type != "fake" and (not self.base_url or not self.model):
            raise ValueError("network profiles require a base URL and model")
        if self.provider_type == "fake" and (self.base_url or self.model or self.api_key_env):
            raise ValueError("Fake profiles do not use network settings")
        if self.provider_type == "ollama" and self.api_key_env:
            raise ValueError("local Ollama profiles do not use credentials")
        return self


class ProviderProfile(ProfileDraft):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    credential_ref: str | None = Field(default=None, alias="credentialRef")

    @model_validator(mode="after")
    def validate_reference(self):
        expected = f"courtroom:profile:{self.id}" if self.provider_type in CREDENTIAL_PROVIDER_TYPES else None
        if self.credential_ref != expected:
            raise ValueError("credential reference must belong to this profile")
        return self


class ProfileCatalog(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    version: Literal[1] = 1
    active_profile_id: str = Field(alias="activeProfileId")
    profiles: list[ProviderProfile] = Field(min_length=1)
    legacy_imported: bool = Field(default=False, alias="legacyImported")

    @model_validator(mode="after")
    def valid_selection(self):
        ids = [profile.id for profile in self.profiles]
        if len(set(ids)) != len(ids) or self.active_profile_id not in ids:
            raise ValueError("invalid active profile or duplicate profile IDs")
        return self


class ProfileStoreError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Provider profiles could not be read or saved; existing data was preserved.")


class ProfileNotFoundError(LookupError):
    pass


def profile_path() -> Path:
    return runtime_paths.config_dir() / "provider-profiles.json"


def new_profile(draft: ProfileDraft) -> ProviderProfile:
    profile_id = uuid4().hex
    return ProviderProfile(
        **draft.model_dump(),
        id=profile_id,
        credential_ref=f"courtroom:profile:{profile_id}" if draft.provider_type in CREDENTIAL_PROVIDER_TYPES else None,
    )


class ProfileStore:
    """One local backend process owns this file; threads share a lock and snapshots."""

    def __init__(self, path: Path, initial: ProviderConfig) -> None:
        self.path = path
        self.lock = RLock()
        try:
            if path.exists():
                self._catalog = ProfileCatalog.model_validate_json(path.read_text(encoding="utf-8"))
            else:
                # Preserve a valid environment configuration as the initial active profile.
                draft = ProfileDraft(
                    name="Fake" if initial.type == "fake" else "Environment",
                    provider_type=initial.type,
                    base_url=initial.base_url if initial.type != "fake" else None,
                    model=initial.model if initial.type != "fake" else None,
                    api_key_env=initial.api_key_env if initial.type in CREDENTIAL_PROVIDER_TYPES else None,
                    generation_settings=initial.settings,
                )
                profile = new_profile(draft)
                self._write(ProfileCatalog(active_profile_id=profile.id, profiles=[profile]))
        except Exception:
            raise ProfileStoreError() from None

    def _write(self, catalog: ProfileCatalog) -> None:
        temporary = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(prefix=".profiles-", dir=self.path.parent)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(catalog.model_dump_json(by_alias=True, indent=2))
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, self.path)
            self._catalog = catalog
        except Exception:
            raise ProfileStoreError() from None
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def snapshot(self) -> ProfileCatalog:
        with self.lock:
            return self._catalog.model_copy(deep=True)

    def get(self, profile_id: str | None = None) -> ProviderProfile:
        catalog = self.snapshot()
        profile = next((profile for profile in catalog.profiles
                        if profile.id == (profile_id or catalog.active_profile_id)), None)
        if profile is None:
            raise ProfileNotFoundError()
        return profile

    def create(self, draft: ProfileDraft) -> ProviderProfile:
        with self.lock:
            profile = new_profile(draft)
            catalog = self.snapshot()
            catalog.profiles.append(profile)
            self._write(catalog)
            return profile

    def update(self, profile_id: str, draft: ProfileDraft) -> ProviderProfile:
        with self.lock:
            self.get(profile_id)
            profile = ProviderProfile(
                **draft.model_dump(), id=profile_id,
                credential_ref=f"courtroom:profile:{profile_id}" if draft.provider_type in CREDENTIAL_PROVIDER_TYPES else None,
            )
            catalog = self.snapshot()
            catalog.profiles = [profile if item.id == profile_id else item for item in catalog.profiles]
            self._write(catalog)
            return profile

    def activate(self, profile_id: str) -> None:
        with self.lock:
            self.get(profile_id)
            catalog = self.snapshot()
            catalog.active_profile_id = profile_id
            self._write(catalog)

    def delete(self, profile_id: str) -> None:
        with self.lock:
            self.get(profile_id)
            catalog = self.snapshot()
            if len(catalog.profiles) == 1:
                raise ValueError("Keep at least one AI profile.")
            catalog.profiles = [profile for profile in catalog.profiles if profile.id != profile_id]
            if catalog.active_profile_id == profile_id:
                catalog.active_profile_id = catalog.profiles[0].id
            self._write(catalog)

    def import_legacy(self, drafts: list[ProfileDraft], active_type: str, preserve_environment: bool) -> None:
        with self.lock:
            catalog = self.snapshot()
            if catalog.legacy_imported:
                return
            for draft in drafts:
                profile = next((item for item in catalog.profiles if item.provider_type == draft.provider_type
                                and item.base_url == draft.base_url and item.model == draft.model), None)
                if profile is None:
                    profile = new_profile(draft)
                    catalog.profiles.append(profile)
                if draft.provider_type == active_type and not preserve_environment:
                    catalog.active_profile_id = profile.id
            catalog.legacy_imported = True
            self._write(catalog)


class ProfileManager:
    def __init__(self, store: ProfileStore, credentials: CredentialStore) -> None:
        self.store, self.credentials = store, credentials

    @staticmethod
    def configuration(profile: ProviderProfile) -> ProviderConfig:
        return ProviderConfig(
            type=profile.provider_type, base_url=profile.base_url, model=profile.model,
            api_key_env=profile.api_key_env, settings=profile.generation_settings,
        )

    def resolve(self, profile: ProviderProfile) -> ProviderConfig:
        config = self.configuration(profile)
        if profile.credential_ref:
            try:
                secret = self.credentials.get(profile.credential_ref)
            except CredentialStoreError:
                if config.resolve_api_key() is None:
                    raise
                secret = None
            config.bind_credential(secret)
        return config

    def status(self, profile: ProviderProfile) -> dict[str, bool]:
        stored, available = False, True
        if profile.credential_ref:
            try:
                stored = self.credentials.exists(profile.credential_ref)
            except CredentialStoreError:
                available = False
        env = bool(profile.api_key_env and os.environ.get(profile.api_key_env))
        return {"credentialConfigured": stored or env, "storedCredentialConfigured": stored,
                "credentialStoreAvailable": available}

    def public(self, profile: ProviderProfile) -> dict:
        return {**profile.model_dump(by_alias=True), **self.status(profile)}

    def catalog(self) -> dict:
        catalog = self.store.snapshot()
        return {"activeProfileId": catalog.active_profile_id,
                "profiles": [self.public(profile) for profile in catalog.profiles]}

    def duplicate(self, profile_id: str) -> ProviderProfile:
        source = self.store.get(profile_id)
        try:
            secret = self.credentials.get(source.credential_ref) if source.credential_ref else None
        except CredentialStoreError:
            if not (source.api_key_env and os.environ.get(source.api_key_env)):
                raise
            secret = None
        draft = ProfileDraft.model_validate(source.model_dump(exclude={"id", "credential_ref"}))
        draft.name = f"{draft.name[:73]} (copy)"
        profile = self.store.create(draft)
        try:
            if secret and profile.credential_ref:
                self.credentials.set(profile.credential_ref, secret)
        except CredentialStoreError:
            self.store.delete(profile.id)
            raise
        return profile

    def delete(self, profile_id: str) -> None:
        with self.store.lock:
            profile = self.store.get(profile_id)
            if len(self.store.snapshot().profiles) == 1:
                raise ValueError("Keep at least one AI profile.")
            if profile.credential_ref:
                self.credentials.delete(profile.credential_ref)
            self.store.delete(profile_id)
