from fastapi import APIRouter

from app.api import catalog, gameplay, history, settings, system, training

api_router = APIRouter(prefix="/api")
for module in (system, catalog, gameplay, training, history, settings):
    api_router.include_router(module.router)

__all__ = ["api_router"]
