# Architecture

## Responsibilities

| Concern | Where | Notes |
| --- | --- | --- |
| Camera capture | `frontend/src/hooks/useCamera.ts` | Permission and error states; device fallback; stream released on stop and unmount |
| Hand landmarks | `frontend/src/hooks/useHandTracker.ts` + `services/handLandmarker.ts` | MediaPipe Hand Landmarker, `VIDEO` mode, `numHands: 2`, GPU with CPU fallback, capped at 30 fps; draws the overlay |
| Streaming to the server | `frontend/src/hooks/usePredictionLoop.ts` | One request in flight, ≥90 ms apart (≥300 ms while no hands are visible), 1.5 s back-off when offline, stale answers dropped, each event delivered once, debug data only on request |
| Arena UI state | `frontend/src/lib/arenaState.ts` | Pure function `deriveArenaPhase()`; unit-tested |
| Challenge clock | `frontend/src/lib/gameClock.ts` + `hooks/useGameClock.ts` | Timestamp-based phases (warm-up → challenge → ended), freeze reasons (player pause, jutsu animation); one interval only while ticking |
| Validation | `backend/app/schemas/landmarks.py` | 21 finite points per hand, ≤2 hands, `Left`/`Right`, non-degenerate |
| Features | `backend/app/computer_vision/` | `build_frame()` → left/right slots. `pose.py`: interpretable, scale-free pose measurements for the built-in recogniser. `features.py`: 195 floats for the trained model |
| Built-in recogniser | `backend/app/recognition/templates.py` + `config/signs.json` | Soft rule templates per sign, weighted geometric mean with a worst-rule gate, best role assignment of the two hands |
| Calibration | `backend/app/recognition/calibration.py` | Nearest neighbours over saved samples (8+ per sign), adaptive tolerance, idle veto; rebuilt when the dataset fingerprint changes |
| Engine selection | `backend/app/recognition/engine.py` | `auto` / `builtin` / `trained`; mode presets (threshold offset, margin, dropout tolerance) |
| Dataset | `backend/app/recognition/dataset.py` | `dataset/<label>/samples.jsonl`, raw landmarks, append-only with atomic rewrites on delete |
| Training | `backend/app/recognition/trainer.py`, `training_job.py` | Eligibility plan → group-aware cross-validation → fit on all data → atomic save; runs on a background thread |
| Inference | `backend/app/recognition/classifier.py` | Thread-safe hot reload; rejects models built with another feature version |
| Smoothing | `backend/app/recognition/smoothing.py`, `stabilizer.py` | 100 ms score EMA; hold time in ms (+ minimum frames), dropout tolerance, immediate sign switching with flicker resume, release time, same-sign cooldown |
| Sequences | `backend/app/sequence_engine/engine.py` | No vision imports; prefix matching, timeout, lockout, practice target |
| Game state | `backend/app/game/service.py` | Per-session pipeline; scoring; history and achievements on activation |
| Persistence | `backend/app/database/` | SQLite: `settings`, `activations`, `player_stats`, `achievements` |
| Content | `backend/config/*.json` via `app/jutsu/registry.py` | Validated at load and on edit; version counter makes live sessions pick up edits |

Services are built once in `app/core/container.py` and attached to `app.state`. Tests build isolated containers with temporary directories and a fake clock.

## One frame, end to end

1. `useHandTracker` runs `detectForVideo` on the un-mirrored `<video>`. Each hand becomes `{handedness, score, landmarks[21][3]}`.
2. `usePredictionLoop.submit()` rounds the values and POSTs `/api/predict` with `session_id`, `track_sequence` and `target_jutsu_id`.
3. `GameService.process_frame()`:
   - syncs the session with the current settings (mode, hold time, timeout) and the jutsu config,
   - `build_frame` → `SignRecognizer.recognise` (built-in: `describe_frame` → templates + calibration; trained: `extract_features` → `classifier.predict`) → gate (idle, threshold, margin over the runner-up, missing hand),
   - `stabilizer.observe` → accepted sign at most once per hold,
   - `engine.tick` (timeout) and `engine.on_sign` → event,
   - on activation: score, then SQLite row, then achievements.
4. The response carries prediction, hand status, sequence progress, game totals and at most one event. The arena plays sounds and effects from the event.

## Extension points

- **New sign or jutsu:** JSON only (see README). Effects are keyed by `effect`.
- **Sign rules:** edit the `recognition` blocks in `signs.json`. New measurements go into `pose.py` (`role_features`).
- **Different classifier:** replace the estimator in `trainer.py`. Anything with `predict_proba` and `classes_` works with `classifier.py`.
- **Feature changes:** edit `features.py` and bump `FEATURE_VERSION`. Old models are refused with a "retrain" message, and stored samples are re-featurised automatically.
- **Multiplayer:** game state is keyed by `session_id` and history by `player_id` (currently always `local`). Adding player identity to requests and a broadcast channel (for example WebSockets) builds on the existing `GameService` without touching recognition.
