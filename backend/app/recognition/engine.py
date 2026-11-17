"""Chooses and runs the recogniser for each frame.

Engines:

* ``builtin`` - geometric sign templates (works immediately, no data needed),
  blended with personal calibration samples for any sign that has them.
* ``trained`` - the Random Forest trained in the Training Studio.
* ``auto`` (default) - ``trained`` once a model covering every sign exists,
  otherwise ``builtin``.

Every engine returns per-sign scores in 0..1. A sign is only reported when its
score clears the threshold *and* beats the runner-up by a margin, so poses
that sit between two signs are reported as unknown instead of guessed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.computer_vision import FrameObservation, extract_features
from app.computer_vision.pose import FramePose, describe_frame
from app.core.config import IDLE_LABEL
from app.recognition.calibration import CalibrationIndex, relative_confidences
from app.recognition.classifier import SignClassifier
from app.recognition.templates import TemplateMatch, TemplateRecognizer

EngineSetting = Literal["auto", "builtin", "trained"]
RecognitionMode = Literal["easy", "balanced", "strict"]

#: Lead the trained model's best class needs over the runner-up.
TRAINED_MARGIN = 0.10


@dataclass(frozen=True)
class ModePreset:
    #: Added to each sign's template threshold.
    threshold_offset: float
    #: Required lead of the best sign over the runner-up.
    margin: float
    #: Short dropouts tolerated inside a hold.
    glitch_ms: int


MODE_PRESETS: dict[str, ModePreset] = {
    "easy": ModePreset(threshold_offset=-0.06, margin=0.04, glitch_ms=200),
    "balanced": ModePreset(threshold_offset=0.0, margin=0.07, glitch_ms=130),
    "strict": ModePreset(threshold_offset=0.07, margin=0.10, glitch_ms=80),
}


def sensitivity_offset(sensitivity: int) -> float:
    """Fine adjustment on top of the mode: 0 -> +0.06 (stricter), 100 -> -0.06."""
    clamped = max(0, min(100, sensitivity))
    return round(0.06 - 0.12 * clamped / 100.0, 4)


@dataclass
class Recognition:
    engine: Literal["builtin", "trained", "none"]
    #: (sign, score) for every scored sign, best first.
    ranked: list[tuple[str, float]] = field(default_factory=list)
    threshold: float = 0.0
    margin_required: float = 0.0
    #: Signs whose score included personal calibration.
    calibrated: set[str] = field(default_factory=set)
    template_matches: list[TemplateMatch] = field(default_factory=list)
    template_scores: dict[str, float] = field(default_factory=dict)
    calibration_scores: dict[str, float] = field(default_factory=dict)
    idle_score: float | None = None
    pose: FramePose | None = None

    @property
    def label(self) -> str | None:
        return self.ranked[0][0] if self.ranked else None

    @property
    def confidence(self) -> float:
        return self.ranked[0][1] if self.ranked else 0.0

    @property
    def idle_wins(self) -> bool:
        """The pose matches the user's own idle samples better than the best sign.

        Idle samples are explicit "this is not a sign" examples, so they veto a
        sign that only the generic template supports.
        """
        if self.idle_score is None or self.idle_score < 0.5 or not self.ranked:
            return False
        label = self.ranked[0][0]
        if label in self.calibrated:
            return self.idle_score > self.calibration_scores.get(label, 0.0)
        return True

    @property
    def margin(self) -> float:
        if len(self.ranked) < 2:
            return self.confidence
        return self.ranked[0][1] - self.ranked[1][1]


class SignRecognizer:
    def __init__(
        self,
        templates: TemplateRecognizer,
        calibration: CalibrationIndex,
        classifier: SignClassifier,
        sign_ids: list[str],
    ) -> None:
        self.templates = templates
        self.calibration = calibration
        self.classifier = classifier
        self._sign_ids = list(sign_ids)

    def set_templates(self, templates: TemplateRecognizer, sign_ids: list[str]) -> None:
        self.templates = templates
        self._sign_ids = list(sign_ids)

    def trained_covers_all(self) -> bool:
        classes = set(self.classifier.classes)
        return self.classifier.ready and all(sign in classes for sign in self._sign_ids)

    def resolve(self, setting: EngineSetting) -> Literal["builtin", "trained", "none"]:
        if setting == "builtin":
            return "builtin"
        if setting == "trained":
            return "trained" if self.classifier.ready else "none"
        return "trained" if self.trained_covers_all() else "builtin"

    def recognise(
        self, frame: FrameObservation, setting: EngineSetting, mode: RecognitionMode, sensitivity: int
    ) -> Recognition:
        engine = self.resolve(setting)
        if engine == "trained":
            return self._trained(frame, sensitivity)
        if engine == "none":
            return Recognition(engine="none")
        return self._builtin(frame, mode, sensitivity)

    # -- engines ----------------------------------------------------------

    def _trained(self, frame: FrameObservation, sensitivity: int) -> Recognition:
        from app.recognition import tuning

        raw = self.classifier.predict(extract_features(frame))
        if raw is None:
            return Recognition(engine="none")
        return Recognition(
            engine="trained",
            ranked=list(raw.ranked),
            threshold=tuning.confidence_threshold(sensitivity),
            margin_required=TRAINED_MARGIN,
        )

    def _builtin(self, frame: FrameObservation, mode: RecognitionMode, sensitivity: int) -> Recognition:
        preset = MODE_PRESETS.get(mode, MODE_PRESETS["easy"])
        pose = describe_frame(frame)
        matches = self.templates.match(pose)
        template_scores = {match.sign_id: match.score for match in matches}
        calibration = self.calibration.similarities(pose)
        relative = relative_confidences(calibration)

        # A calibrated sign is judged mainly by the player's own samples: how
        # much better the pose matches that sign's recordings than any other
        # recording. The generic template can raise the score (when the player
        # forms the sign the textbook way) but never caps it - players who form
        # a sign differently would otherwise never get past the threshold.
        scores: dict[str, float] = {}
        calibrated: set[str] = set()
        for sign_id, template_score in template_scores.items():
            if sign_id in relative:
                calibrated.add(sign_id)
                own = relative[sign_id]
                scores[sign_id] = max(own, 0.5 * (own + template_score))
            else:
                scores[sign_id] = template_score

        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        best = ranked[0][0] if ranked else None
        template = self.templates.template(best) if best else None
        base = template.threshold if template else 0.62
        threshold = round(min(0.95, max(0.3, base + preset.threshold_offset + sensitivity_offset(sensitivity))), 4)

        return Recognition(
            engine="builtin",
            ranked=ranked,
            threshold=threshold,
            margin_required=preset.margin,
            calibrated=calibrated,
            template_matches=matches,
            template_scores=template_scores,
            calibration_scores={k: v for k, v in calibration.items() if k != IDLE_LABEL},
            idle_score=calibration.get(IDLE_LABEL),
            pose=pose,
        )


Decision = Literal["accept", "no_score", "idle", "low_confidence", "ambiguous"]


def decide(result: Recognition) -> Decision:
    """The confidence gate shared by gameplay and offline measurements."""
    label = result.label
    if label is None:
        return "no_score"
    if label == IDLE_LABEL or result.idle_wins:
        return "idle"
    if result.confidence < result.threshold:
        return "low_confidence"
    if result.margin < result.margin_required:
        return "ambiguous"
    return "accept"


def with_scores(result: Recognition, scores: dict[str, float]) -> Recognition:
    """``result`` with its ranking replaced by (smoothed) ``scores``."""
    result.ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    return result
