"""The authoritative per-frame pipeline.

recogniser (built-in templates + calibration, or the trained model) ->
confidence / margin gate -> temporal smoothing -> sequence engine ->
scoring / history / achievements.

State is keyed by session id (and player id), so several players could be
served side by side - the hook for future multiplayer support.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

from app.computer_vision import FrameObservation, build_frame
from app.computer_vision.pose import FramePose, HandPose, pair_features
from app.core.config import IDLE_LABEL, AppConfig
from app.database import HistoryRepository, SettingsRepository
from app.game.achievements import AchievementService
from app.game.scoring import ScoreState, combo_multiplier
from app.jutsu import GameRegistry
from app.recognition.engine import MODE_PRESETS, Recognition, SignRecognizer, decide, with_scores
from app.recognition.smoothing import ScoreSmoother
from app.recognition.stabilizer import SignStabilizer, StabilizerConfig
from app.schemas.catalog import SettingsModel
from app.schemas.game import (
    AchievementUnlock,
    ActivationOut,
    DebugOut,
    EventOut,
    HandDebug,
    GameOut,
    HandsStatus,
    PredictionOut,
    PredictRequest,
    PredictResponse,
    SequenceCandidate,
    SequenceOut,
    SignScore,
    TopPrediction,
)
from app.sequence_engine import SequenceEngine, SequenceEvent, SequenceEventType

Clock = Callable[[], float]


@dataclass
class GameSession:
    session_id: str
    player_id: str
    engine: SequenceEngine
    stabilizer: SignStabilizer
    smoother: ScoreSmoother
    registry_version: int
    score: ScoreState = field(default_factory=ScoreState)
    event_counter: int = 0
    last_seen: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)


class GameService:
    def __init__(
        self,
        config: AppConfig,
        registry: GameRegistry,
        recognizer: SignRecognizer,
        settings: SettingsRepository,
        history: HistoryRepository,
        achievements: AchievementService,
        clock: Clock = time.monotonic,
    ) -> None:
        self._config = config
        self._registry = registry
        self._recognizer = recognizer
        self._settings = settings
        self._history = history
        self._achievements = achievements
        self._clock = clock
        self._sessions: dict[str, GameSession] = {}
        self._sessions_lock = threading.Lock()

    # -- sessions ---------------------------------------------------------

    def _now_ms(self) -> float:
        return self._clock() * 1000.0

    def _session(self, session_id: str) -> GameSession:
        now = self._clock()
        with self._sessions_lock:
            expired = [
                key
                for key, session in self._sessions.items()
                if now - session.last_seen > self._config.session_ttl_seconds
            ]
            for key in expired:
                del self._sessions[key]

            session = self._sessions.get(session_id)
            if session is None:
                session = GameSession(
                    session_id=session_id,
                    player_id=self._config.default_player_id,
                    engine=SequenceEngine(
                        self._registry.sequence_definitions(),
                        lockout_ms=self._config.activation_lockout_ms,
                    ),
                    stabilizer=SignStabilizer(),
                    smoother=ScoreSmoother(self._config.score_smoothing_ms),
                    registry_version=self._registry.version,
                )
                self._sessions[session_id] = session
            session.last_seen = now
            return session

    def _sync(self, session: GameSession) -> SettingsModel:
        """Apply current settings / sequence config to the session."""
        settings = self._settings.get(session.player_id)
        preset = MODE_PRESETS.get(settings.recognition_mode, MODE_PRESETS["easy"])
        session.stabilizer.configure(
            StabilizerConfig(
                hold_ms=settings.hold_ms,
                min_frames=self._config.min_hold_frames,
                release_ms=self._config.release_ms,
                cooldown_ms=self._config.sign_cooldown_ms,
                glitch_ms=preset.glitch_ms,
            )
        )
        session.engine.timeout_ms = settings.sequence_timeout_seconds * 1000
        if session.registry_version != self._registry.version:
            session.engine.set_definitions(self._registry.sequence_definitions())
            session.registry_version = self._registry.version
        return settings

    # -- output helpers ---------------------------------------------------

    def _sequence_out(self, session: GameSession, now_ms: float) -> SequenceOut:
        snapshot = session.engine.snapshot(now_ms)
        return SequenceOut(
            signs=list(snapshot.signs),
            candidates=[
                SequenceCandidate(jutsu_id=jutsu_id, matched=matched, total=total)
                for jutsu_id, matched, total in snapshot.candidates
            ],
            target_jutsu_id=snapshot.target_jutsu_id,
            timeout_ms=snapshot.timeout_ms,
            time_remaining_ms=snapshot.time_remaining_ms,
            locked=snapshot.locked,
            paused=snapshot.paused,
        )

    @staticmethod
    def _game_out(score: ScoreState) -> GameOut:
        return GameOut(
            score=score.score,
            combo=score.combo,
            best_combo=score.best_combo,
            activations=score.activations,
            incorrect=score.incorrect,
            signs_accepted=score.signs_accepted,
            accuracy=score.accuracy,
            next_multiplier=combo_multiplier(score.combo + 1),
        )

    def _sign_name(self, sign_id: str | None) -> str:
        sign = self._registry.sign(sign_id) if sign_id else None
        return sign.name if sign else (sign_id or "")

    # -- classification ---------------------------------------------------

    def _classify(
        self, frame: FrameObservation, settings: SettingsModel, smoother: ScoreSmoother, now_ms: float
    ) -> tuple[PredictionOut, str | None, Recognition | None]:
        """Run the recogniser and the confidence gate.

        Returns ``(prediction, confident_sign, recognition)``. ``confident_sign``
        is only set when the recogniser genuinely predicts a sign.
        """
        engine = self._recognizer.resolve(settings.recognition_engine)
        if frame.hand_count == 0 or (engine == "builtin" and frame.hand_count < 2):
            smoother.reset()
        if frame.hand_count == 0:
            return (
                PredictionOut(status="no_hands", threshold=0.0, engine=engine, message="No hands detected - raise both hands into view."),
                None,
                None,
            )
        if engine == "none":
            message = (
                "The recogniser is set to use the trained model, but no model has been trained. "
                "Train one in the Training Studio or switch Settings -> Recognition engine to Auto."
            )
            return PredictionOut(status="model_missing", threshold=0.0, engine=engine, message=message), None, None

        if engine == "builtin" and frame.hand_count < 2:
            # Every built-in sign uses both hands.
            return (
                PredictionOut(
                    status="unknown", threshold=0.0, engine=engine,
                    message="One hand detected - show both hands to the camera.",
                ),
                None,
                None,
            )

        result = self._recognizer.recognise(
            frame, settings.recognition_engine, settings.recognition_mode, settings.recognition_sensitivity
        )
        result = with_scores(result, smoother.update(dict(result.ranked), now_ms))
        threshold = result.threshold
        top = [TopPrediction(sign=label, confidence=round(score, 4)) for label, score in result.ranked[:3]]
        confidence = round(result.confidence, 4)
        label = result.label

        def unknown(message: str, hint: str | None = None) -> tuple[PredictionOut, None, Recognition]:
            closest = label if label and label != IDLE_LABEL and result.confidence >= 0.3 else None
            return (
                PredictionOut(
                    status="unknown", confidence=confidence, threshold=threshold, message=message, top=top,
                    engine=result.engine, closest=closest, hint=hint,
                ),
                None,
                result,
            )

        verdict = decide(result)
        if verdict == "no_score":
            return unknown("Unknown sign.")
        if verdict == "idle":
            return unknown("Looks like your idle pose - no sign detected." if result.idle_wins else "No sign detected.")
        if verdict == "low_confidence":
            return unknown("Unknown sign - no sign matches closely enough.", self._hint(result))
        if verdict == "ambiguous":
            runner_up = result.ranked[1][0] if len(result.ranked) > 1 else None
            return unknown(
                f"Unclear - between {self._sign_name(label)} and {self._sign_name(runner_up)}.",
                self._hint(result),
            )
        sign = self._registry.sign(label)
        if sign is None:
            return unknown("The model predicted a sign that is no longer configured. Retrain the model.")
        if frame.hand_count < sign.hands_required:
            return unknown("One hand detected - show both hands to the camera.")

        prediction = PredictionOut(
            status="recognizing", sign=label, confidence=confidence, threshold=threshold, top=top,
            engine=result.engine, calibrated=label in result.calibrated,
        )
        return prediction, label, result

    def _hint(self, result: Recognition) -> str | None:
        """What keeps the closest built-in sign from matching, in plain words."""
        if not result.template_matches:
            return None
        best = result.template_matches[0]
        weakest = best.weakest(1)
        if not weakest:
            return None
        return f"Closest: {self._sign_name(best.sign_id)} - check: {weakest[0].label.lower()}."

    @staticmethod
    def _hand_debug(slot: str, hand: HandPose) -> HandDebug:
        fingers = ["extended" if e >= 0.6 else "curled" if e <= 0.4 else "half" for e in hand.extension]
        angle = math.degrees(math.atan2(float(hand.axis[0]), float(-hand.axis[1])))
        return HandDebug(
            slot=slot,  # type: ignore[arg-type]
            extension=[round(float(e), 3) for e in hand.extension],
            fingers=fingers,  # type: ignore[arg-type]
            axis_deg=round(angle, 1),
        )

    def _debug(self, result: Recognition | None, settings: SettingsModel, engine: str) -> DebugOut:
        debug = DebugOut(
            engine=engine,  # type: ignore[arg-type]
            hold_ms=settings.hold_ms,
            calibrated_signs=sorted(self._recognizer.calibration.calibrated().keys() - {IDLE_LABEL}),
        )
        if result is None:
            return debug
        pose: FramePose | None = result.pose
        if pose is not None:
            debug.hands = [
                self._hand_debug(slot, hand)
                for slot, hand in (("left", pose.left), ("right", pose.right))
                if hand is not None
            ]
            if pose.left is not None and pose.right is not None:
                debug.pair = {key: round(value, 3) for key, value in pair_features(pose.left, pose.right).items()}
        debug.scores = [
            SignScore(
                sign=label,
                score=round(score, 4),
                template=round(result.template_scores[label], 4) if label in result.template_scores else None,
                calibration=round(result.calibration_scores[label], 4) if label in result.calibration_scores else None,
            )
            for label, score in result.ranked
        ]
        if result.template_matches:
            debug.unmet = [c.label for c in result.template_matches[0].weakest(4)]
        debug.margin = round(result.margin, 4)
        debug.margin_required = result.margin_required
        debug.idle_similarity = None if result.idle_score is None else round(result.idle_score, 4)
        return debug

    # -- events -----------------------------------------------------------

    def _handle_event(self, session: GameSession, event: SequenceEvent, person_visible: bool | None = None) -> EventOut:
        session.event_counter += 1
        base = {
            "id": session.event_counter,
            "type": event.type.value,
            "sign": event.sign,
            "signs": list(event.signs),
        }
        trail = " → ".join(self._sign_name(sign) for sign in event.signs)

        if event.type is SequenceEventType.SIGN_ACCEPTED:
            return EventOut(**base, message=f"{self._sign_name(event.sign)} accepted")

        if event.type is SequenceEventType.NO_MATCH:
            target = self._registry.get_jutsu(session.engine.target) if session.engine.target else None
            if target is not None:
                message = f"{target.name} begins with {self._sign_name(target.sequence[0])}"
            else:
                message = f"No jutsu begins with {self._sign_name(event.sign)}"
            return EventOut(**base, message=message)

        if event.type is SequenceEventType.SEQUENCE_TIMEOUT:
            return EventOut(**base, message="Too slow - the sequence was reset")

        if event.type is SequenceEventType.INCORRECT_SEQUENCE:
            session.score.register_incorrect()
            self._history.record_incorrect(session.player_id)
            return EventOut(**base, message=f"Incorrect sequence: {trail}")

        # JUTSU_ACTIVATED
        jutsu = self._registry.get_jutsu(event.jutsu_id or "")
        if jutsu is None:  # config changed underneath us; treat as a reset
            return EventOut(**{**base, "type": "sequence_timeout"}, message="Sequence reset")
        if jutsu.requires_person and person_visible is False:
            # The clones are copied from the camera image: with nobody in frame
            # there is nothing to copy, so nothing is activated, scored or saved.
            session.engine.cancel_lockout()
            return EventOut(
                **{**base, "type": "person_required"},
                jutsu_id=jutsu.id,
                message=f"{jutsu.name} needs you in the picture. Please stand in front of your camera.",
            )

        points, multiplier = session.score.register_activation(jutsu.points)
        activation_id = self._history.add_activation(
            player_id=session.player_id,
            session_id=session.session_id,
            jutsu_id=jutsu.id,
            jutsu_name=jutsu.name,
            element=jutsu.element,
            points=points,
            combo=session.score.combo,
            sequence=list(event.signs),
        )
        unlocked = self._achievements.evaluate(session.player_id)
        activation = ActivationOut(
            activation_id=activation_id,
            jutsu_id=jutsu.id,
            jutsu_name=jutsu.name,
            element=jutsu.element,
            effect=jutsu.effect,
            base_points=jutsu.points,
            multiplier=multiplier,
            points=points,
            combo=session.score.combo,
            sequence=list(event.signs),
            new_achievements=[
                AchievementUnlock(id=a.id, name=a.name, description=a.description, icon=a.icon)
                for a in unlocked
            ],
        )
        return EventOut(**base, jutsu_id=jutsu.id, message=f"{jutsu.name} activated", activation=activation)

    # -- public API -------------------------------------------------------

    def process_frame(self, request: PredictRequest) -> PredictResponse:
        session = self._session(request.session_id)
        with session.lock:
            now_ms = self._now_ms()
            settings = self._sync(session)
            if request.track_sequence:
                session.engine.set_target(request.target_jutsu_id)

            frame = build_frame(request)
            prediction, confident_sign, recognition = self._classify(frame, settings, session.smoother, now_ms)
            state = session.stabilizer.observe(confident_sign, now_ms)
            if confident_sign is not None:
                prediction.stability = round(state.progress, 3)
                if state.held and state.candidate == confident_sign:
                    prediction.status = "recognized"

            event: EventOut | None = None
            if request.track_sequence:
                sequence_event = session.engine.tick(now_ms)
                if state.accepted is not None and not session.engine.paused:
                    session.score.signs_accepted += 1
                    # A sign arriving right at the timeout starts a fresh attempt;
                    # the sign's own event is the more useful one to report.
                    sequence_event = session.engine.on_sign(state.accepted, now_ms) or sequence_event
                if sequence_event is not None:
                    event = self._handle_event(session, sequence_event, request.person_visible)

            return PredictResponse(
                session_id=session.session_id,
                model_ready=prediction.engine != "none",
                hands=HandsStatus(
                    count=frame.hand_count, left=frame.left is not None, right=frame.right is not None
                ),
                prediction=prediction,
                sequence=self._sequence_out(session, now_ms),
                game=self._game_out(session.score),
                event=event,
                debug=self._debug(recognition, settings, prediction.engine) if request.debug else None,
            )

    def set_paused(self, session_id: str, paused: bool) -> tuple[SequenceOut, GameOut]:
        session = self._session(session_id)
        with session.lock:
            now_ms = self._now_ms()
            if paused:
                session.engine.pause(now_ms)
            else:
                session.engine.resume(now_ms)
            # A sign held across a pause boundary counts fresh afterwards.
            session.stabilizer.reset()
            session.smoother.reset()
            self._sync(session)
            return self._sequence_out(session, now_ms), self._game_out(session.score)

    def reset(self, session_id: str, reset_score: bool) -> tuple[SequenceOut, GameOut]:
        session = self._session(session_id)
        with session.lock:
            session.engine.reset()
            session.stabilizer.reset()
            session.smoother.reset()
            if reset_score:
                session.score = ScoreState()
            self._sync(session)
            return self._sequence_out(session, self._now_ms()), self._game_out(session.score)
