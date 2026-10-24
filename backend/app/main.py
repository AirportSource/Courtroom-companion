"""FastAPI entry point.

Run from backend/:  .venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
The Vite dev server proxies /api to this port, so the browser never needs CORS or secrets.
"""

import logging

from fastapi import FastAPI

from .api.routes import router
from .characters.repository import CharacterRepository
from .characters.service import CharacterService
from .llm.config import ProviderConfig, load_provider_config
from .llm.gateway import LLMGateway, ProviderFactory

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def create_app(
    config: ProviderConfig | None = None,
    repository: CharacterRepository | None = None,
    provider_registry: dict[str, ProviderFactory] | None = None,
) -> FastAPI:
    app = FastAPI(title="Courtroom Companion API", version="0.1.0")
    gateway = LLMGateway(config or load_provider_config(), registry=provider_registry)
    app.state.character_service = CharacterService(repository or CharacterRepository(), gateway)
    app.include_router(router)
    return app


app = create_app()
