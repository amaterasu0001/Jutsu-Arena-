"""Built-in, training-free hand-sign recognition from geometric rules.

Each sign in ``config/signs.json`` describes its pose in a ``recognition``
block:

* the state of every finger of both hands (taken from the sign's ``diagram``
  unless overridden): ``up`` (extended), ``fold`` (curled) or ``lock``
  (interlocked with the other hand - usually hidden, so it counts for less);
* a list of soft ``rules`` on named features from
  :mod:`app.computer_vision.pose`, e.g. "the index fingertips touch"
  (``tip_distance.index`` at most 0.45 palm widths).

Every condition yields a membership between 0 and 1 (soft edges instead of
hard cut-offs, so small differences in how people form a sign do not matter).
The sign's score is the weighted geometric mean of its memberships, gated by
its least-satisfied rule: a pose that clearly breaks one of the sign's
defining relations (say, palms far apart for a clasp) cannot score well no
matter how good the fingers look, while small deviations only cost a little.

The two hands are matched to the sign's two roles in whichever way fits best,
so detector handedness mix-ups and camera mirroring cannot break a sign.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.computer_vision.pose import FINGER_NAMES, FramePose, HandPose, ramp, role_features

FINGER_STATES = ("up", "fold", "lock", "any")

#: Default weight of each finger state (thumb, other fingers).
DEFAULT_STATE_WEIGHTS = {
    "up": (0.6, 1.0),
    "fold": (0.5, 1.0),
    # Interlocked fingers are hidden behind the other hand; the landmark model
    # has to guess where they are (it usually guesses "curled"), so they carry
    # less evidence than visible fingers - but enough that an extended finger
    # still rules a clasp sign out.
    "lock": (0.3, 0.6),
    "any": (0.0, 0.0),
}

DEFAULT_THRESHOLD = 0.62
_FLOOR = 0.03
#: Score multiplier when the least-satisfied rule is fully violated.
_GATE_FLOOR = 0.35


class TemplateConfigError(ValueError):
    """Raised when a sign's recognition block is invalid."""


@dataclass(frozen=True)
class Rule:
    feature: str
    minimum: float | None
    maximum: float | None
    soft: float
    weight: float
    label: str

    def membership(self, value: float) -> float:
        result = 1.0
        if self.minimum is not None:
            result = min(result, ramp(value, self.minimum - self.soft, self.minimum))
        if self.maximum is not None:
            result = min(result, 1.0 - ramp(value, self.maximum, self.maximum + self.soft))
        return result


@dataclass(frozen=True)
class SignTemplate:
    sign_id: str
    #: Finger states for role a and role b (thumb .. pinky).
    fingers_a: tuple[str, ...]
    fingers_b: tuple[str, ...]
    rules: tuple[Rule, ...]
    threshold: float = DEFAULT_THRESHOLD
    state_weights: dict[str, tuple[float, float]] = field(default_factory=lambda: dict(DEFAULT_STATE_WEIGHTS))


@dataclass(frozen=True)
class Condition:
    label: str
    membership: float
    weight: float


@dataclass(frozen=True)
class TemplateMatch:
    sign_id: str
    score: float
    #: True when hand roles were swapped relative to the detector's left/right.
    swapped: bool
    conditions: tuple[Condition, ...]

    def weakest(self, count: int = 2) -> list[Condition]:
        """The conditions that hurt the score most (for feedback / debugging)."""
        relevant = [c for c in self.conditions if c.weight > 0 and c.membership < 0.85]
        relevant.sort(key=lambda c: c.weight * math.log(max(c.membership, _FLOOR)))
        return relevant[:count]


_FINGER_LABEL = {"up": "extended", "fold": "curled", "lock": "interlocked"}


def finger_membership(state: str, extension: float) -> float:
    if state == "up":
        return ramp(extension, 0.2, 0.7)
    if state in ("fold", "lock"):
        return 1.0 - ramp(extension, 0.3, 0.8)
    return 1.0


def parse_template(sign_id: str, diagram: dict, block: dict | None) -> SignTemplate:
    """Build a template from a sign's ``diagram`` and optional ``recognition`` block."""
    block = block or {}
    fingers = block.get("fingers", {})
    fingers_a = tuple(fingers.get("a", diagram.get("left", ())))
    fingers_b = tuple(fingers.get("b", diagram.get("right", ())))
    for states in (fingers_a, fingers_b):
        if len(states) != 5 or any(state not in FINGER_STATES for state in states):
            raise TemplateConfigError(
                f"Sign '{sign_id}': finger states must list 5 of {', '.join(FINGER_STATES)}."
            )

    weights = dict(DEFAULT_STATE_WEIGHTS)
    for state, value in block.get("finger_weights", {}).items():
        if state not in FINGER_STATES:
            raise TemplateConfigError(f"Sign '{sign_id}': unknown finger state '{state}' in finger_weights.")
        if isinstance(value, (int, float)):
            weights[state] = (float(value) * 0.6, float(value))
        else:
            weights[state] = (float(value[0]), float(value[1]))

    rules: list[Rule] = []
    for raw in block.get("rules", []):
        try:
            minimum = raw.get("min")
            maximum = raw.get("max")
            if minimum is None and maximum is None:
                raise TemplateConfigError(f"Sign '{sign_id}': rule on '{raw['feature']}' needs 'min' or 'max'.")
            rules.append(
                Rule(
                    feature=str(raw["feature"]),
                    minimum=None if minimum is None else float(minimum),
                    maximum=None if maximum is None else float(maximum),
                    soft=max(float(raw.get("soft", 0.3)), 1e-3),
                    weight=float(raw.get("weight", 1.0)),
                    label=str(raw.get("label", raw["feature"])),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            if isinstance(exc, TemplateConfigError):
                raise
            raise TemplateConfigError(f"Sign '{sign_id}': invalid rule {raw!r}: {exc}") from exc

    threshold = float(block.get("threshold", DEFAULT_THRESHOLD))
    if not 0.0 < threshold < 1.0:
        raise TemplateConfigError(f"Sign '{sign_id}': threshold must be between 0 and 1.")
    return SignTemplate(sign_id, fingers_a, fingers_b, tuple(rules), threshold, weights)


def match_template(template: SignTemplate, a: HandPose, b: HandPose, swapped: bool) -> TemplateMatch:
    features = role_features(a, b)
    conditions: list[Condition] = []
    for role, hand, states in (("a", a, template.fingers_a), ("b", b, template.fingers_b)):
        for index, state in enumerate(states):
            thumb_weight, finger_weight = template.state_weights[state]
            weight = thumb_weight if index == 0 else finger_weight
            if weight <= 0:
                continue
            conditions.append(
                Condition(
                    label=f"{'hand A' if role == 'a' else 'hand B'} {FINGER_NAMES[index]} {_FINGER_LABEL.get(state, state)}",
                    membership=finger_membership(state, hand.extension[index]),
                    weight=weight,
                )
            )
    for rule in template.rules:
        value = features.get(rule.feature)
        if value is None:
            raise TemplateConfigError(f"Sign '{template.sign_id}': unknown feature '{rule.feature}'.")
        conditions.append(Condition(label=rule.label, membership=rule.membership(value), weight=rule.weight))

    total = sum(c.weight for c in conditions)
    if total <= 0:
        return TemplateMatch(template.sign_id, 0.0, swapped, tuple(conditions))
    log_score = sum(c.weight * math.log(max(c.membership, _FLOOR)) for c in conditions) / total
    rule_memberships = [c.membership for c in conditions[len(conditions) - len(template.rules):] if c.weight > 0]
    worst = min(rule_memberships, default=1.0)
    # A clearly contradicting visible finger (an extended finger where the sign
    # needs it curled, or the reverse) also gates the score, more gently than a
    # rule since single-finger estimates are noisier.
    finger_memberships = [c.membership for c in conditions[: len(conditions) - len(template.rules)] if c.weight >= 0.5]
    if finger_memberships:
        worst = min(worst, 0.4 + 0.6 * min(finger_memberships))
    gate = _GATE_FLOOR + (1.0 - _GATE_FLOOR) * worst**0.7
    return TemplateMatch(template.sign_id, math.exp(log_score) * gate, swapped, tuple(conditions))


class TemplateRecognizer:
    """Scores a two-hand pose against every configured sign template."""

    def __init__(self, templates: list[SignTemplate]) -> None:
        self._templates = {template.sign_id: template for template in templates}

    @property
    def sign_ids(self) -> list[str]:
        return list(self._templates)

    def template(self, sign_id: str) -> SignTemplate | None:
        return self._templates.get(sign_id)

    def match(self, pose: FramePose) -> list[TemplateMatch]:
        """All matches, best first. Empty unless both hands are visible."""
        if pose.left is None or pose.right is None:
            return []
        matches = []
        for template in self._templates.values():
            direct = match_template(template, pose.left, pose.right, swapped=False)
            flipped = match_template(template, pose.right, pose.left, swapped=True)
            matches.append(direct if direct.score >= flipped.score else flipped)
        matches.sort(key=lambda m: m.score, reverse=True)
        return matches


def validate_features(template: SignTemplate) -> None:
    """Fail fast on rules that reference features that do not exist."""
    import numpy as np

    from app.computer_vision.pose import HandPose

    dummy = HandPose(
        extension=(0.5,) * 5,
        axis=np.array([0.0, -1.0]),
        finger_dirs=np.tile(np.array([0.0, -1.0]), (5, 1)),
        palm_center=np.zeros(2),
        wrist=np.zeros(2),
        knuckles=np.zeros(2),
        tips=np.zeros((5, 2)),
        scale=1.0,
    )
    known = role_features(dummy, dummy)
    for rule in template.rules:
        if rule.feature not in known:
            raise TemplateConfigError(
                f"Sign '{template.sign_id}': unknown feature '{rule.feature}'. "
                f"Known features: {', '.join(sorted(known))}."
            )
