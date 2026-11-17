from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import ContainerDep
from app.schemas.catalog import SettingsModel, SettingsUpdate

router = APIRouter(tags=["settings"])

#: Fields where an explicit ``null`` is meaningful (clears the value).
_NULLABLE = {"camera_device_id"}


@router.get("/settings", response_model=SettingsModel)
def get_settings(container: ContainerDep) -> SettingsModel:
    return container.settings.get(container.config.default_player_id)


@router.put("/settings", response_model=SettingsModel)
def update_settings(update: SettingsUpdate, container: ContainerDep) -> SettingsModel:
    changes = {
        key: value
        for key, value in update.model_dump(exclude_unset=True).items()
        if value is not None or key in _NULLABLE
    }
    return container.settings.update(container.config.default_player_id, changes)


@router.post("/settings/reset", response_model=SettingsModel)
def reset_settings(container: ContainerDep) -> SettingsModel:
    return container.settings.reset(container.config.default_player_id)
