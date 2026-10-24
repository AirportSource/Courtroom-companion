"""OS credentials behind a small, provider-independent interface.

No file/plaintext fallback is permitted. A headless server can use environment secrets.
"""

from abc import ABC, abstractmethod

from pydantic import SecretStr


class CredentialStoreError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("The OS credential store is unavailable or locked.")


class CredentialStore(ABC):
    @abstractmethod
    def get(self, ref: str) -> SecretStr | None: ...

    @abstractmethod
    def set(self, ref: str, secret: SecretStr) -> None: ...

    @abstractmethod
    def delete(self, ref: str) -> None: ...

    def exists(self, ref: str) -> bool:
        return self.get(ref) is not None


class KeyringCredentialStore(CredentialStore):
    SERVICE = "Courtroom Companion"
    NATIVE_MODULES = {
        "keyring.backends.Windows",
        "keyring.backends.macOS",
        "keyring.backends.SecretService",
        "keyring.backends.kwallet",
    }

    def __init__(self, backend=None) -> None:
        # Explicit backend injection is for deterministic tests; production discovers keyring.
        self._backend = backend

    def _native_backend(self):
        if self._backend is not None:
            return self._backend
        try:
            import keyring

            backend = keyring.get_keyring()
            candidates = getattr(backend, "backends", [backend])
            self._backend = next(
                candidate for candidate in candidates
                if type(candidate).__module__ in self.NATIVE_MODULES
            )
            return self._backend
        except Exception:
            raise CredentialStoreError() from None

    @property
    def backend_name(self) -> str:
        backend = self._native_backend()
        return f"{type(backend).__module__}.{type(backend).__name__}"

    def get(self, ref: str) -> SecretStr | None:
        try:
            value = self._native_backend().get_password(self.SERVICE, ref)
            return SecretStr(value) if value else None
        except Exception:
            raise CredentialStoreError() from None

    def set(self, ref: str, secret: SecretStr) -> None:
        try:
            self._native_backend().set_password(self.SERVICE, ref, secret.get_secret_value())
        except Exception:
            raise CredentialStoreError() from None

    def delete(self, ref: str) -> None:
        try:
            backend = self._native_backend()
            if backend.get_password(self.SERVICE, ref) is not None:
                backend.delete_password(self.SERVICE, ref)
        except Exception:
            raise CredentialStoreError() from None
