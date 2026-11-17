"""Application factory (kept separate from ``main`` so tests can build isolated apps)."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import api_router
from app.core.config import AppConfig
from app.core.container import Container, build_container
from app.core.errors import register_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app(config: AppConfig | None = None, container: Container | None = None) -> FastAPI:
    config = config or (container.config if container else AppConfig.from_env())
    app = FastAPI(
        title="Naruto Jutsu Arena API",
        version=__version__,
        description="Hand-sign classification, sequence matching and game state.",
    )
    app.state.container = container or build_container(config)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )
    register_error_handlers(app)
    app.include_router(api_router)
    return app

