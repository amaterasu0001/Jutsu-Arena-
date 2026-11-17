"""Load and update the JSON game configuration (signs, jutsu, achievements)."""

from __future__ import annotations

import json
import threading
from pathlib import Path

from app.models import AchievementDefinition, JutsuDefinition, SignDefinition
from app.recognition.templates import (
    SignTemplate,
    TemplateConfigError,
    TemplateRecognizer,
    parse_template,
    validate_features,
)
from app.sequence_engine import SequenceConfigError, SequenceDefinition, validate_definitions

SIGNS_FILE = "signs.json"
JUTSU_FILE = "jutsu.json"
ACHIEVEMENTS_FILE = "achievements.json"

DIFFICULTIES = ("Beginner", "Intermediate", "Advanced")
ACHIEVEMENT_METRICS = (
    "total_activations",
    "best_combo",
    "distinct_jutsu",
    "trained_signs",
    "total_score",
)


class RegistryError(ValueError):
    """Raised when the configuration files are missing or invalid."""


def _load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RegistryError(f"Missing configuration file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RegistryError(f"{path.name} is not valid JSON: {exc}") from exc


class GameRegistry:
    def __init__(self, config_dir: Path) -> None:
        self._dir = config_dir
        self._lock = threading.RLock()
        #: Incremented whenever sequences change so live sessions can refresh.
        self.version = 0
        self._signs: dict[str, SignDefinition] = {}
        self._jutsu: dict[str, JutsuDefinition] = {}
        self._achievements: list[AchievementDefinition] = []
        self._load()

    # -- loading ----------------------------------------------------------

    def _load(self) -> None:
        signs = self._parse_signs(_load_json(self._dir / SIGNS_FILE))
        jutsu = self._parse_jutsu(_load_json(self._dir / JUTSU_FILE), signs)
        achievements = self._parse_achievements(_load_json(self._dir / ACHIEVEMENTS_FILE))
        with self._lock:
            self._signs, self._jutsu, self._achievements = signs, jutsu, achievements
            self.version += 1

    @staticmethod
    def _parse_signs(data: dict) -> dict[str, SignDefinition]:
        signs: dict[str, SignDefinition] = {}
        try:
            for index, raw in enumerate(data["signs"]):
                sign = SignDefinition(
                    id=raw["id"],
                    name=raw["name"],
                    kanji=raw.get("kanji", ""),
                    order=int(raw.get("order", index + 1)),
                    description=raw["description"],
                    how_to=tuple(raw.get("how_to", ())),
                    hands_required=int(raw.get("hands_required", 2)),
                    diagram=raw["diagram"],
                    recognition=raw.get("recognition"),
                )
                if sign.id in signs:
                    raise RegistryError(f"Duplicate sign id '{sign.id}' in {SIGNS_FILE}.")
                signs[sign.id] = sign
        except (KeyError, TypeError) as exc:
            raise RegistryError(f"{SIGNS_FILE} is missing a required field: {exc}") from exc
        if not signs:
            raise RegistryError(f"{SIGNS_FILE} defines no signs.")
        for sign in signs.values():
            try:
                validate_features(GameRegistry._template(sign))
            except TemplateConfigError as exc:
                raise RegistryError(f"{SIGNS_FILE}: {exc}") from exc
        return signs

    @staticmethod
    def _template(sign: SignDefinition) -> SignTemplate:
        return parse_template(sign.id, sign.diagram, sign.recognition)

    @staticmethod
    def _parse_jutsu(data: dict, signs: dict[str, SignDefinition]) -> dict[str, JutsuDefinition]:
        jutsu: dict[str, JutsuDefinition] = {}
        try:
            for raw in data["jutsu"]:
                item = JutsuDefinition(
                    id=raw["id"],
                    name=raw["name"],
                    subtitle=raw.get("subtitle", ""),
                    element=raw["element"],
                    difficulty=raw["difficulty"],
                    points=int(raw["points"]),
                    effect=raw["effect"],
                    description=raw["description"],
                    sequence=tuple(raw["sequence"]),
                    requires_person=bool(raw.get("requires_person", False)),
                )
                if item.id in jutsu:
                    raise RegistryError(f"Duplicate jutsu id '{item.id}' in {JUTSU_FILE}.")
                if item.difficulty not in DIFFICULTIES:
                    raise RegistryError(f"Jutsu '{item.id}' has unknown difficulty '{item.difficulty}'.")
                unknown = [sign for sign in item.sequence if sign not in signs]
                if unknown:
                    raise RegistryError(f"Jutsu '{item.id}' uses unknown signs: {', '.join(unknown)}.")
                jutsu[item.id] = item
        except (KeyError, TypeError) as exc:
            raise RegistryError(f"{JUTSU_FILE} is missing a required field: {exc}") from exc
        try:
            validate_definitions([SequenceDefinition(j.id, j.sequence) for j in jutsu.values()])
        except SequenceConfigError as exc:
            raise RegistryError(f"{JUTSU_FILE}: {exc}") from exc
        return jutsu

    @staticmethod
    def _parse_achievements(data: dict) -> list[AchievementDefinition]:
        achievements = []
        try:
            for raw in data["achievements"]:
                if raw["metric"] not in ACHIEVEMENT_METRICS:
                    raise RegistryError(f"Achievement '{raw['id']}' uses unknown metric '{raw['metric']}'.")
                achievements.append(
                    AchievementDefinition(
                        id=raw["id"],
                        name=raw["name"],
                        description=raw["description"],
                        icon=raw.get("icon", "award"),
                        metric=raw["metric"],
                        threshold=int(raw["threshold"]),
                    )
                )
        except (KeyError, TypeError) as exc:
            raise RegistryError(f"{ACHIEVEMENTS_FILE} is missing a required field: {exc}") from exc
        return achievements

    # -- accessors --------------------------------------------------------

    @property
    def signs(self) -> list[SignDefinition]:
        with self._lock:
            return sorted(self._signs.values(), key=lambda sign: sign.order)

    @property
    def sign_ids(self) -> list[str]:
        return [sign.id for sign in self.signs]

    def sign(self, sign_id: str) -> SignDefinition | None:
        return self._signs.get(sign_id)

    def template_recognizer(self) -> TemplateRecognizer:
        """Built-in recogniser for every sign that requires two hands."""
        return TemplateRecognizer([self._template(sign) for sign in self.signs if sign.hands_required == 2])

    @property
    def jutsu(self) -> list[JutsuDefinition]:
        with self._lock:
            return list(self._jutsu.values())

    def get_jutsu(self, jutsu_id: str) -> JutsuDefinition | None:
        return self._jutsu.get(jutsu_id)

    @property
    def achievements(self) -> list[AchievementDefinition]:
        return list(self._achievements)

    def sequence_definitions(self) -> list[SequenceDefinition]:
        return [SequenceDefinition(j.id, j.sequence) for j in self.jutsu]

    # -- updates ----------------------------------------------------------

    def update_sequence(self, jutsu_id: str, sequence: list[str]) -> JutsuDefinition:
        """Validate and persist a new sign sequence for one jutsu."""
        with self._lock:
            current = self._jutsu.get(jutsu_id)
            if current is None:
                raise KeyError(jutsu_id)
            unknown = [sign for sign in sequence if sign not in self._signs]
            if unknown:
                raise RegistryError(f"Unknown signs: {', '.join(unknown)}.")
            for previous, following in zip(sequence, sequence[1:]):
                if previous == following:
                    raise RegistryError(
                        "A sequence cannot repeat the same sign twice in a row - the player "
                        "would have to release and re-form it, which reads as one hold."
                    )
            updated = JutsuDefinition(**{**current.__dict__, "sequence": tuple(sequence)})
            candidate = {**self._jutsu, jutsu_id: updated}
            try:
                validate_definitions([SequenceDefinition(j.id, j.sequence) for j in candidate.values()])
            except SequenceConfigError as exc:
                raise RegistryError(str(exc)) from exc

            path = self._dir / JUTSU_FILE
            data = _load_json(path)
            for raw in data["jutsu"]:
                if raw["id"] == jutsu_id:
                    raw["sequence"] = list(sequence)
            temp = path.with_suffix(".tmp")
            temp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            temp.replace(path)

            self._jutsu = candidate
            self.version += 1
            return updated
