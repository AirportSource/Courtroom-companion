"""FastAPI entry point.

Run from backend/:  .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
The Vite dev server proxies /api to this port, so the browser never needs CORS or secrets.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse

from .api.routes import router
from .api.profile_routes import router as profile_router
from .characters.repository import CharacterRepository
from .characters.service import CharacterService
from .llm.config import ProviderConfig, load_provider_config
from .llm.gateway import LLMGateway, ProviderFactory
from .configuration.credentials import CredentialStore, CredentialStoreError, KeyringCredentialStore
from .configuration.profiles import ProfileManager, ProfileNotFoundError, ProfileStore, ProfileStoreError, profile_path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def create_app(
    config: ProviderConfig | None = None,
    repository: CharacterRepository | None = None,
    provider_registry: dict[str, ProviderFactory] | None = None,
    profile_store: ProfileStore | None = None,
    credential_store: CredentialStore | None = None,
) -> FastAPI:
    app = FastAPI(title="Courtroom Companion API", version="0.1.0")
    gateway = LLMGateway(config or load_provider_config(), registry=provider_registry)
    app.state.character_service = CharacterService(repository or CharacterRepository(), gateway)
    app.state.provider_profiles = ProfileManager(
        profile_store or ProfileStore(profile_path(), gateway.config),
        credential_store or KeyringCredentialStore(),
    )

    @app.exception_handler(RequestValidationError)
    async def safe_profile_validation(request: Request, error: RequestValidationError):
        if request.url.path.startswith("/api/provider-profiles"):
            # FastAPI's normal validation errors include submitted input. Never echo a key.
            return JSONResponse(status_code=422, content={"detail": {"code": "invalid_profile_request",
                "message": "Invalid profile or credential fields. Check the name, URL and model."}})
        return await request_validation_exception_handler(request, error)

    @app.exception_handler(CredentialStoreError)
    @app.exception_handler(ProfileStoreError)
    async def configuration_unavailable(request: Request, error: Exception):
        return JSONResponse(status_code=503, content={"detail": {"code": "configuration_unavailable",
            "message": str(error)}})

    @app.exception_handler(ProfileNotFoundError)
    async def missing_profile(request: Request, error: Exception):
        return JSONResponse(status_code=404, content={"detail": "Unknown provider profile."})

    @app.middleware("http")
    async def configuration_cache_control(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/provider-profiles"):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.include_router(router)
    app.include_router(profile_router)
    return app


app = create_app()
