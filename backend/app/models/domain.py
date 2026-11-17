from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SignDefinition:
    id: str
    name: str
    kanji: str
    order: int
    description: str
    how_to: tuple[str, ...]
    hands_required: int
    diagram: dict
    #: Built-in recogniser configuration (see app/recognition/templates.py).
    recognition: dict | None = None


@dataclass(frozen=True)
class JutsuDefinition:
    id: str
    name: str
    subtitle: str
    element: str
    difficulty: str
    points: int
    effect: str
    description: str
    sequence: tuple[str, ...]
    #: The effect is built from the live camera image, so the player must be visible.
    requires_person: bool = False


@dataclass(frozen=True)
class AchievementDefinition:
    id: str
    name: str
    description: str
    icon: str
    metric: str
    threshold: int
