"""Hand-sign and jutsu catalogues."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import ContainerDep, active_engine, calibrated_signs, recognizable_signs, trained_signs
from app.core.container import Container
from app.core.errors import InvalidRequestError, NotFoundError
from app.jutsu import RegistryError
from app.models import JutsuDefinition
from app.schemas.catalog import JutsuOut, JutsuResponse, JutsuUpdate, SignOut, SignsResponse

router = APIRouter(tags=["catalog"])

SEQUENCE_NOTE = (
    "Sequences are game-defined and configurable; they are not presented as canonical "
    "sequences from any series."
)


def _jutsu_out(jutsu: JutsuDefinition, recognizable: set[str], counts: dict[str, int]) -> JutsuOut:
    missing = [sign for sign in dict.fromkeys(jutsu.sequence) if sign not in recognizable]
    return JutsuOut(
        id=jutsu.id,
        name=jutsu.name,
        subtitle=jutsu.subtitle,
        element=jutsu.element,
        difficulty=jutsu.difficulty,
        points=jutsu.points,
        effect=jutsu.effect,
        description=jutsu.description,
        sequence=list(jutsu.sequence),
        requires_person=jutsu.requires_person,
        unlocked=not missing,
        missing_signs=missing,
        times_activated=counts.get(jutsu.id, 0),
    )


def _activation_counts(container: Container) -> dict[str, int]:
    return container.history.stats(container.config.default_player_id)["per_jutsu"]


@router.get("/signs", response_model=SignsResponse)
def list_signs(container: ContainerDep) -> SignsResponse:
    config = container.config
    counts = container.dataset.counts()
    trained = set(trained_signs(container))
    engine = active_engine(container)
    builtin = set(container.recognizer.templates.sign_ids)
    calibrated = calibrated_signs(container)
    report = container.classifier.report or {}
    evaluation = report.get("evaluation") or {}
    per_class = evaluation.get("per_class", {})
    jutsu = container.registry.jutsu

    signs: list[SignOut] = []
    for sign in container.registry.signs:
        count = counts.get(sign.id, 0)
        if sign.id in trained:
            status = "trained"
        elif count >= config.min_samples_per_class:
            status = "ready_to_train"
        elif count > 0:
            status = "collecting"
        else:
            status = "untrained"

        if engine == "trained":
            source = "trained" if sign.id in trained else "unavailable"
        elif engine == "builtin" and sign.id in builtin:
            source = "calibrated" if sign.id in calibrated else "builtin"
        else:
            source = "unavailable"

        reference = container.dataset.first_sample(sign.id)
        signs.append(
            SignOut(
                id=sign.id,
                name=sign.name,
                kanji=sign.kanji,
                order=sign.order,
                description=sign.description,
                how_to=list(sign.how_to),
                hands_required=sign.hands_required,
                diagram=sign.diagram,
                recognition_status=status,
                recognition_source=source,
                calibration_samples=calibrated.get(sign.id, 0),
                calibration_min_samples=container.calibration.min_samples,
                sample_count=count,
                min_samples=config.min_samples_per_class,
                recommended_samples=config.recommended_samples_per_class,
                metrics=per_class.get(sign.id) if sign.id in trained else None,
                used_in=[j.name for j in jutsu if sign.id in j.sequence],
                reference_hands=reference["hands"] if reference else None,
                reference_aspect=(
                    reference.get("image_width", 1280) / reference.get("image_height", 720)
                    if reference
                    else None
                ),
            )
        )
    return SignsResponse(
        signs=signs,
        model_ready=container.classifier.ready,
        recognition_engine=engine,
        trained_at=report.get("trained_at"),
        evaluation_note=evaluation.get("note") or report.get("evaluation_note"),
    )


@router.get("/jutsu", response_model=JutsuResponse)
def list_jutsu(container: ContainerDep) -> JutsuResponse:
    recognizable = set(recognizable_signs(container))
    counts = _activation_counts(container)
    return JutsuResponse(
        jutsu=[_jutsu_out(jutsu, recognizable, counts) for jutsu in container.registry.jutsu],
        note=SEQUENCE_NOTE,
    )


@router.put("/jutsu/{jutsu_id}", response_model=JutsuOut)
def update_jutsu_sequence(jutsu_id: str, update: JutsuUpdate, container: ContainerDep) -> JutsuOut:
    try:
        jutsu = container.registry.update_sequence(jutsu_id, update.sequence)
    except KeyError:
        raise NotFoundError(f"Unknown jutsu '{jutsu_id}'.") from None
    except RegistryError as exc:
        raise InvalidRequestError(str(exc), code="invalid_sequence") from exc
    return _jutsu_out(jutsu, set(recognizable_signs(container)), _activation_counts(container))
