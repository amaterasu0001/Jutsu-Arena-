# API reference

Base URL: `http://127.0.0.1:8000/api` (through the dev server: `http://localhost:5173/api`). Interactive docs are at `http://127.0.0.1:8000/docs`.

Every error uses one shape:

```json
{ "error": { "code": "validation_error", "message": "Invalid request data (hands.0.landmarks): …", "details": [ { "field": "…", "message": "…" } ] } }
```

Common codes: `validation_error` (422), `not_found` (404), `invalid_request` / `invalid_sequence` / `insufficient_data` / `no_valid_samples` (400), `training_in_progress` (409), `internal_error` (500).

## Landmark frame

```json
{
  "hands": [
    { "handedness": "Left", "score": 0.97, "landmarks": [[0.41, 0.62, -0.0], "… 21 points total"] }
  ],
  "image_width": 1280,
  "image_height": 720
}
```

`x` and `y` are normalised to the image (MediaPipe output, un-mirrored). There can be 0–2 hands. Coordinates must be finite, in [-2, 3].

## Endpoints

| Method & path | Body / query | Returns |
| --- | --- | --- |
| `GET /health` | – | status, version, model readiness and message, trained signs, active `recognition_engine` (`builtin`, `trained` or `none`), `recognizable_signs`, `calibrated_signs`, totals, training state |
| `GET /signs` | – | the 12 signs with guide, training status, `recognition_source` (`builtin`, `calibrated`, `trained` or `unavailable`), calibration sample count, sample count, per-sign metrics, reference pose |
| `GET /jutsu` | – | jutsu with sequence, unlock status, missing signs, activation count |
| `PUT /jutsu/{id}` | `{ "sequence": ["ox", "tiger"] }` | updated jutsu (validated and saved to `jutsu.json`) |
| `POST /predict` | frame + `session_id`, `track_sequence` (default `true`), `target_jutsu_id` (nullable), `debug` (default `false`), `person_visible` (optional; a jutsu with `requires_person` is refused with a `person_required` event when it is `false`) | `hands`, `prediction` (`no_hands`, `model_missing`, `unknown`, `recognizing` or `recognized`; sign, confidence, threshold, stability, top-3, `engine`, `calibrated`, and for near misses `closest` + `hint`), `sequence`, `game`, `event`, `debug` (per-hand finger extension and axis, pair measurements, every sign's template/calibration score, unmet conditions, margin; only when requested) |
| `POST /sequence/pause` | `{ "session_id": "…", "paused": true }` | sequence (with `paused`) and game state. While paused the time-between-signs countdown is frozen and signs are ignored; resuming continues where it stopped |
| `POST /sequence/reset` | `{ "session_id": "…", "reset_score": false }` | sequence and game state |
| `GET /training/status` | – | per-label counts and bursts, eligibility, `can_train` + `blocking_reason`, job state, model info and evaluation |
| `POST /training/samples` | `{ "label": "tiger", "capture_group": "burst-x", "samples": [frame, …] }` (≤300) | saved / rejected counts (frames missing a required hand are rejected) |
| `GET /training/samples?label=tiger&limit=48` | – | newest samples with landmarks |
| `DELETE /training/samples/{label}/{id}` | – | deletes one sample |
| `DELETE /training/samples/{label}` | – | deletes all samples of a label |
| `POST /training/train` | – | `202`; poll `/training/status` until `job.state` is `completed` or `failed` |
| `GET /history?limit=100` | – | activations, stats, achievements with progress, training progress |
| `DELETE /history` | – | `204`; clears activations, stats and achievements (not training data) |
| `GET /settings` | – | settings |
| `PUT /settings` | partial settings | merged settings (`camera_device_id: null` clears the camera). Recognition fields: `recognition_mode` (`easy`/`balanced`/`strict`), `hold_ms` (200–1500), `recognition_engine` (`auto`/`builtin`/`trained`), `recognition_sensitivity` (0–100), `debug_overlay`, `game_mode` (`easy`/`normal`/`challenge`), `sequence_timeout_seconds` (10–60, default 20). Only the fields you change are stored, so improved defaults reach the rest |
| `POST /settings/reset` | – | default settings |

### Events from `/predict`

| `type` | Meaning | Scoring |
| --- | --- | --- |
| `sign_accepted` | A stable sign extended the current attempt | – |
| `jutsu_activated` | The sequence was completed; `activation` holds points, multiplier, combo, new achievements | + points, combo + 1 |
| `incorrect_sequence` | The sign broke an attempt already in progress | combo reset, counted as a miss |
| `no_match` | A first sign that starts no available jutsu | none |
| `sequence_timeout` | Too long between signs; the attempt is cleared | none |
