# Naruto Jutsu Arena

Perform hand signs in front of your webcam. The game recognises them in real time, tracks the order you perform them in, and unleashes a cinematic jutsu when you complete a sequence.

- **Real computer vision.** MediaPipe tracks up to two hands (21 landmarks each) in the browser. A Python backend measures the hand pose (finger extension, hand orientation, how the hands touch), matches it against the twelve signs, smooths predictions over time and matches sequences.
- **Works on first launch.** All twelve signs are recognised by built-in geometric pose templates. No data collection or training is needed to play.
- **Personal when you want it.** One short burst of a sign in the Training Studio calibrates that sign to your hands immediately. Training a full Random Forest model is optional.
- **Nothing is faked.** If the recogniser is unsure, the UI says so ("Unknown sign", "Unclear - between Tiger and Ram"). No points are awarded for unrecognised or incorrect signs.
- **Original assets.** Every visual effect is hand-built with Canvas or Three.js, and every sound is synthesised with the Web Audio API. No anime footage, art, logos or music are used.

> A non-commercial fan project, not affiliated with or endorsed by the owners of Naruto. The sign sequences are game-defined configurations and are not presented as canonical.

---

## Features

| Area | What you get |
| --- | --- |
| **Home** | Hero, how-it-works, featured jutsu, a pipeline overview, feature highlights and a progress/achievement preview |
| **Game Arena** | Webcam preview with landmark overlay, left/right hand status, current sign with hold progress and confidence, animated "< TIGER DETECTED >" card, recognised-sign history, near-miss hints, Easy/Balanced/Strict mode, sequence progress with a timer, score, combo, accuracy, result panel with replay, free play or practice of a single jutsu, optional debug overlay |
| **Jutsu Library** | 8 jutsu with element, difficulty, points, sequence, unlock status, an effect preview and an in-app sequence editor |
| **Hand Signs** | The 12 signs with a guide diagram, steps, how each is recognised (built-in / calibrated / trained), your recorded pose, sample count and, for a trained model, per-sign precision, recall and F1 |
| **Training Studio** | Quick calibrate (12 frames, saved automatically), per-class sample counts, burst/single capture, review and delete before saving, saved-sample browser, background training, metrics plus confusion matrix, live recognition test |
| **History** | Activations with date, sequence, combo and points; totals; best combo; accuracy; training progress; 11 achievements |
| **Settings** | Camera selection, mirror, landmark overlay, sound, effects quality, recognition mode, hold time, sensitivity fine-tuning, recognition engine, debug overlay, time between signs, theme (crimson, azure or violet), reset. All persisted in SQLite |

States handled: camera not started, starting, permission denied, unavailable or busy, unsupported browser; hand tracker loading or failed; waiting for hands, one or both hands, recognising, recognised, unknown, sequence in progress, jutsu activated, incorrect sequence, timeout; model missing; insufficient data; backend offline (banner, automatic retry, error pages with retry); invalid requests.

## Technology

| Layer | Stack |
| --- | --- |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, Lucide icons, Three.js (energy-sphere effect), `@mediapipe/tasks-vision` (Hand Landmarker) |
| Backend | Python 3.10+, FastAPI, Uvicorn, Pydantic v2 |
| Recognition | NumPy (pose geometry, templates, calibration matching); optional scikit-learn `RandomForestClassifier` + joblib for a trained model |
| Storage | SQLite (settings, history, stats, achievements); JSON (signs, jutsu, achievements); JSONL (training samples) |
| Tests | pytest (backend), Vitest and Testing Library (frontend) |

**Why landmarks are detected in the browser:** raw video never leaves your machine, not even to the local server. The browser sends about 2 KB of landmark coordinates per frame, roughly 10 times a second. The backend stays authoritative for classification, smoothing, sequence matching and scoring.

## How recognition works

```
Webcam ─▶ MediaPipe Hand Landmarker (browser, up to 2 hands × 21 landmarks)
       ─▶ POST /api/predict  (landmarks only, ~11 req/s with hands, ~3 req/s without)
       ─▶ left/right slot assignment ─▶ scale-free pose measurements
       ─▶ recogniser: built-in sign templates (+ your calibration samples)
                      or a trained Random Forest
       ─▶ confidence + margin gate ─▶ temporal stabiliser (hold time in ms)
       ─▶ sequence engine ─▶ scoring · history · achievements ─▶ response + event
```

### Built-in recogniser (default, no training)

- **Pose measurements** (`backend/app/computer_vision/pose.py`). For each hand: how extended each finger is (0–1, from joint straightness and tip reach; the thumb is measured in the palm's own frame), which way the hand and each finger point, and where the palm sits. Between the hands: palm, wrist and knuckle distances, same-finger fingertip distances, vertical offset and relative orientation. Every length is divided by palm size, so distance from the camera, hand size and image resolution don't matter. Cross-hand values only use image-plane positions, because MediaPipe's depth is relative to each hand's own wrist.
- **Sign templates** (`backend/config/signs.json` → `recognition`, scored by `backend/app/recognition/templates.py`). Each sign lists its finger states (taken from the same diagram the app shows) and a few soft rules, for example Tiger: *hands clasped together*, *index fingertips together*, *index fingers point up*. Each condition gives a 0–1 membership with soft edges instead of hard cut-offs. A sign's score is the weighted geometric mean of its conditions, gated by the worst-violated rule or clearly contradicting finger. Interlocked fingers are usually hidden, so they count for less than visible ones. The two detected hands are matched to the sign's two roles whichever way fits best, so handedness mix-ups and camera mirroring don't break asymmetric signs such as Dog or Rat.
- **Personal calibration** (`backend/app/recognition/calibration.py`). Once a sign has 8+ saved two-hand samples (one Quick-calibrate burst), live frames are also compared with your own samples. This uses nearest neighbours on a compact pose descriptor. The tolerance comes from how much your samples vary *between* bursts, which is what a fresh attempt looks like. A calibrated sign is scored by how much better the pose matches its recordings than any other recording. The template can raise that score but never cap it, so a sign you form differently from the textbook still clears the threshold. Saved **Idle** samples act as explicit "not a sign" examples and veto signs that only the template supports. No training run is involved, and new samples take effect on the next frame.
- **Smoothing.** Scores pass through a 100 ms exponential moving average (`recognition/smoothing.py`), so a single jittery frame doesn't restart the hold.
- **Gate.** A sign is reported only when its score clears the threshold *and* leads the runner-up by a margin. Otherwise the UI shows "Unknown sign" or "Unclear – between X and Y", plus a hint naming the closest sign and the condition that isn't met.
- **Modes.** Easy (default): threshold 0.56, margin 0.04, 200 ms dropout tolerance. Balanced: 0.62 / 0.07 / 130 ms. Strict: 0.69 / 0.10 / 80 ms. **Fine-tune sensitivity** shifts the threshold by up to ±0.06, and a sign can set its own `threshold` in `signs.json`.

### Trained model (optional)

The original pipeline is still there: `features.py` (195 normalised features), a Random Forest trained in the Training Studio, and cross-validated metrics. **Settings → Recognition engine**: *Auto* (default) uses the trained model once it covers all twelve signs and the built-in recogniser before that. *Built-in* and *Trained model* force one or the other.

### Shared by both engines

- **Handedness**: MediaPipe labels hands from the subject's point of view when given the un-mirrored frame, which is what the app passes. Mirroring only flips the preview with CSS. If both hands get the same label (common while hands overlap in a seal), the more confident one keeps its slot and the other takes the free slot.
- **Stability** (`recognition/stabilizer.py`): a sign is accepted once it has been the confident prediction for the **hold time** (default 0.3 s, adjustable from 0.15 to 1.5 s) on at least 2 frames. Dropouts shorter than the mode's tolerance don't restart the hold. A *different* sign starts its own hold immediately, so Tiger → Snake → Ram flows without pauses. A one-frame flicker to another sign resumes the earlier hold instead of restarting it. Each hold counts once: holding a sign longer never repeats it. Once the sign has been absent for 250 ms, forming it again counts as a new sign. The 300 ms cooldown only applies to repeating the *same* sign and never delays a different one. Time is measured in milliseconds, so the feel doesn't depend on frame rate.

### Timed challenge

Press **Start game** in the arena once the camera, hand tracker and game server are ready (the panel shows each). A **15-second warm-up** follows, in which signs are shown but not scored. Then the challenge clock runs: **Easy 180 s, Normal 120 s (default), Challenge 90 s**, set in the arena or in Settings. The clock is computed from timestamps (`frontend/src/lib/gameClock.ts`), so it can't tick twice or reset on re-renders. One interval runs only while it counts down, it re-renders once per second, and it's cleared on pause, end and leaving the page. It **stops while paused** (Pause/Resume), **while a jutsu animation plays**, and when the camera stops. Pausing also freezes the server's time-between-signs countdown (`POST /api/sequence/pause`). Reminders appear at 30 s and 10 s left. At 0 the results panel shows score, jutsu, signs and best combo. Within a challenge you have **20 s between signs** by default (10–60 s in Settings).
- **Sequence engine** (`sequence_engine/engine.py`): separate from the vision code. It tracks the prefix of the attempt and reports `sign_accepted`, `jutsu_activated`, `incorrect_sequence`, `no_match` (a first sign that starts nothing, not penalised) or `sequence_timeout`. After an activation, a lockout prevents duplicate triggers. The config is validated: no duplicate sequences, no sequence that is the start of another, no immediately repeated sign.
- **Scoring**: points × combo multiplier (×1, +0.25 per consecutive success, capped at ×3). An incorrect sequence resets the combo. Accuracy = activations ÷ (activations + incorrect sequences).

## Project structure

```
Jutsu-Arena-/
├── start.bat                     # Windows launcher (runs setup on first use)
├── scripts/
│   ├── setup_project.py          # venv + pip, npm install, download hand model
│   └── train_model.py            # train from the command line
├── docs/
│   ├── architecture.md           # components, data flow, extension points
│   └── api.md                    # endpoint reference
├── backend/
│   ├── app/
│   │   ├── main.py               # uvicorn entrypoint
│   │   ├── factory.py            # create_app(): CORS, errors, routers
│   │   ├── api/                  # routers: system, catalog, gameplay, training, history, settings
│   │   ├── core/                 # config (env vars), errors, service container
│   │   ├── computer_vision/      # hand-slot assignment + feature extraction
│   │   ├── recognition/          # dataset store, trainer, classifier, stabiliser, background job
│   │   ├── sequence_engine/      # sequence matching (no CV dependencies)
│   │   ├── jutsu/                # JSON registry of signs / jutsu / achievements
│   │   ├── game/                 # per-session pipeline, scoring, achievements
│   │   ├── database/             # SQLite schema + repositories
│   │   ├── models/               # domain dataclasses
│   │   └── schemas/              # Pydantic request/response models
│   ├── config/                   # signs.json, jutsu.json, achievements.json  ← edit these
│   ├── dataset/                  # your samples: <label>/samples.jsonl (git-ignored)
│   ├── trained_models/           # sign_classifier.joblib + report (git-ignored)
│   ├── data/                     # jutsu_arena.sqlite3 (git-ignored)
│   ├── tests/                    # pytest suite
│   └── requirements*.txt
└── frontend/
    ├── public/                   # emblem; mediapipe/ and models/ are generated by setup
    ├── scripts/copy-mediapipe-wasm.mjs
    └── src/
        ├── pages/                # Home, Arena, JutsuLibrary, HandSigns, Training, History, Settings
        ├── layouts/              # app shell + navigation
        ├── components/           # UI primitives, camera stage, sign diagram, sequence track…
        ├── animations/           # effect engine + 8 effects (7 canvas, 1 Three.js)
        ├── hooks/                # useCamera, useHandTracker, usePredictionLoop, useApi, useCatalog
        ├── services/             # API client, hand landmarker loader, synthesised sound
        ├── context/              # backend status, settings, toasts
        ├── lib/                  # arena state machine, formatting, drawing helpers
        ├── styles/               # Tailwind + design tokens
        ├── types/                # API types
        └── test/                 # Vitest suite
```

## Installation

**Requirements:** Windows 10/11 (macOS and Linux work with the manual commands), **Python 3.10–3.13**, **Node.js 20+**, a webcam, and a current Chromium-based browser or Firefox.

### Quick start (Windows)

Double-click **`start.bat`**, or run it from a terminal:

```bat
start.bat
```

On the first run it calls `scripts\setup_project.py`, which:
1. creates `backend\.venv` and installs the Python packages,
2. runs `npm install` in `frontend\`, which also copies the MediaPipe WASM runtime into `public\mediapipe\wasm`,
3. downloads the MediaPipe hand-landmark model (about 8 MB) to `frontend\public\models\hand_landmarker.task`.

It then opens the backend and frontend in two console windows and launches **http://localhost:5173**. Close those two windows to stop the app.

### Manual setup

```bat
:: from the repository root
python scripts\setup_project.py
```

Or step by step:

```bat
:: backend
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt

:: frontend (also copies the MediaPipe WASM runtime)
cd ..\frontend
npm install
```

If the hand model isn't downloaded, the app loads it from the public MediaPipe CDN at runtime. That works, but needs internet access on every page load.

### Running each service manually

```bat
:: terminal 1 – backend API on http://127.0.0.1:8000  (docs at /docs)
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

:: terminal 2 – frontend on http://localhost:5173  (proxies /api to the backend)
cd frontend
npm run dev
```

macOS/Linux: use `.venv/bin/python` instead of `.venv\Scripts\python`.

Production-style frontend build: `npm run build` then `npm run preview` (also on port 5173, same proxy).

### Configuration

All settings are optional. Copy `backend/.env.example` to `backend/.env`, or `frontend/.env.example` to `frontend/.env`. No secrets are needed or stored.

| Variable | Default | Purpose |
| --- | --- | --- |
| `JUTSU_HOST` / `JUTSU_PORT` | `127.0.0.1` / `8000` | Used by your own launch command |
| `JUTSU_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins |
| `JUTSU_DATASET_DIR`, `JUTSU_MODEL_DIR`, `JUTSU_DATABASE_PATH` | `dataset`, `trained_models`, `data/jutsu_arena.sqlite3` | Storage locations |
| `JUTSU_MIN_SAMPLES_PER_CLASS` | `20` | A class needs this many samples to be trained |
| `JUTSU_RECOMMENDED_SAMPLES_PER_CLASS` | `80` | Target shown in the UI |
| `JUTSU_FOREST_TREES` | `150` | Random Forest size |
| `JUTSU_RELEASE_MS`, `JUTSU_SIGN_COOLDOWN_MS`, `JUTSU_MIN_HOLD_FRAMES` | `250`, `300`, `2` | Stabiliser tuning (hold time and mode are in-app settings; the cooldown only applies to repeating the same sign) |
| `JUTSU_SCORE_SMOOTHING_MS` | `100` | Score smoothing window (0 = off) |
| `JUTSU_CALIBRATION_MIN_SAMPLES` | `8` | Saved two-hand samples before a sign counts as calibrated |
| `JUTSU_ACTIVATION_LOCKOUT_MS` | `2500` | Duplicate-activation protection |
| `VITE_BACKEND_URL` | `http://127.0.0.1:8000` | Where the dev server proxies `/api` |
| `VITE_API_BASE_URL` | `/api` | Base URL the browser calls |
| `VITE_SWAP_HANDEDNESS` | `false` | Set to `true` only if left/right come out swapped on your camera |

## Camera permissions

- Browsers allow the camera only on **secure origins**. `http://localhost` counts as one; a LAN IP over plain HTTP does not.
- On the first **Start camera**, the browser asks for permission. If you clicked *Block*, click the camera icon in the address bar, choose *Allow*, and press **Try again**.
- Only one app can use a webcam at a time on many systems. Close Zoom, Teams or other tabs if the arena says the camera is busy.
- Choose a specific webcam in **Settings → Camera** (*Detect cameras* lists them by name).
- Windows: **Settings → Privacy & security → Camera** must allow desktop apps and your browser.

## Calibrating a sign (optional, seconds)

If a sign isn't picked up the way you form it, open **Training**, pick the sign, start the camera and press **Quick calibrate**. After a 3-second countdown, 12 frames are captured while you hold the sign, and saved automatically. From 8 samples on, the sign is matched against your own pose straight away. The Hand Signs page then shows it as *Calibrated*. To stop something from triggering a sign when you aren't making one, calibrate the **Idle** class the same way.

## Collecting training data (optional, for a full model)

1. Open **Training** in the menu and start the camera.
2. Pick a sign on the left. **Hand Signs** shows a guide for each one. What matters most is forming each sign the same way every time, and keeping the twelve clearly different from each other.
3. Press **Capture burst**. After a 3-second countdown, frames are captured while you hold the sign. Shift your position, distance and angle slightly during the burst. Frames without both hands are skipped automatically.
4. Review the thumbnails, delete any wrong poses, and press **Save to dataset**.
5. Repeat in **several separate bursts** per sign (different moments, distances and lighting). Separate bursts make the model more robust, and they make the evaluation honest: bursts are kept whole across cross-validation folds.
6. Record the **Idle** class too: relaxed hands, hands apart, hands moving between signs.

Minimum: **20 samples** per class to be included in training, and at least two classes. Recommended: **80+ per sign**, spread over 3+ bursts. Signs below the minimum are skipped, and the UI tells you which.

Samples are stored as raw landmarks in `backend/dataset/<label>/samples.jsonl`, never as images. You can browse and delete them in the Training Studio.

## Training the model

- **In the app:** press **Train model** (or **Retrain model**) in the Training Studio. Training runs in a background thread, so the UI stays responsive. The new model is used immediately, with no restart.
- **From the command line:**
  ```bat
  backend\.venv\Scripts\python scripts\train_model.py            :: train
  backend\.venv\Scripts\python scripts\train_model.py --dry-run  :: show what would be trained
  ```
  A backend that is already running loads a model trained this way the next time it starts.

After training you get accuracy, macro-F1, per-class precision and recall, and a confusion matrix. All of them come from cross-validation on your data, never from made-up numbers. When a class was captured in a single burst, the report says the numbers are optimistic. Training is refused on an empty or incomplete dataset, with a message explaining what is missing.

With the built-in recogniser every jutsu is playable from the start. If you force **Recognition engine → Trained model**, a jutsu unlocks once the model knows every sign in its sequence. For the trained model, **Fine-tune sensitivity** sets the confidence needed, from 0.80 (strict) down to 0.45 (lenient).

## Shadow Clone Jutsu: clones of whoever is in front of the camera

Shadow Clone Jutsu is a single **Ram** sign. No photo is uploaded or stored: every clone is a copy of the person in front of the webcam at the moment of activation.

1. **Person check.** While the camera runs, a small (256 px) copy of the frame is checked about every 0.6 s with MediaPipe's selfie-segmentation model, locally in the browser (`frontend/src/services/personSegmentation.ts`, `hooks/usePersonPresence.ts`). The arena shows *Person detected* or *Please stand in front of your camera.*
2. **Activation needs a person.** The browser reports `person_visible` with each frame (nothing else, no image). Jutsu marked `"requires_person": true` in `jutsu.json` (Shadow Clone) are refused by the backend with "Please stand in front of your camera." while nobody is visible. Nothing is scored or saved, and you can retry immediately. If the check is unavailable, nothing is blocked.
3. **Capture at the moment of activation.** When the real recogniser accepts Ram, the arena copies the video frame on screen *right then*: mirrored like the preview, at most 720 px. It cuts the person out with the segmenter: soft alpha matte, feathered edge, cropped to the person, never stretched. It also records where the person was in the frame.
4. **Clones of that exact capture.** The effect (`frontend/src/animations/ShadowCloneEffect.tsx`) maps the person's frame position onto the stage (accounting for `object-fit: cover`) and plays:
   1. "SHADOW CLONE JUTSU!", a flash and a smoke burst around you.
   2. A frozen copy of you over your live image.
   3. Clones of the same captured image emerge from smoke and spread out: left, right, centre background (rising above your head), upper-left and upper-right.
   4. Depth from scale, height, brightness and blur.
   5. The final formation, then "SHADOW CLONE JUTSU ACTIVATED!".
5. **Fallbacks.**
   - No person in the captured frame: the message is shown and no clones are made.
   - Segmentation unavailable (model missing, offline): framed copies of the captured frame are used.
   - Clones are never replaced by other images, avatars or characters. The Jutsu Library preview shows only the smoke, because it has no camera.
6. **Privacy and clean-up.**
   - Frames never leave the browser; only the segmentation model is downloaded (by the setup script, or once from Google's MediaPipe bucket).
   - The capture lives only in memory, for **Replay**, which reuses the same capture.
   - It is released at the next activation, when the camera stops, when a new game starts, or when you leave the arena.
   - Nothing is saved to disk.

Status messages in the arena: *Person detected*, *Ram sign detected*, *Capturing your shadow*, *Creating clones*, *Shadow Clone Jutsu activated*. Options (Settings → Shadow Clone Jutsu): number of clones (2, 3, 5 or 7; default 5), formation, duration, smoke and sound.

## Customising jutsu and signs

- **Sequences:** use **Edit** on any card in the Jutsu Library, or edit `backend/config/jutsu.json`. Each sequence has 1–6 signs, no repeated sign in a row, and no sequence may be the beginning of another. A single-sign sequence such as Shadow Clone's Ram therefore only works for a sign no other sequence starts with.
- **New jutsu:** add an entry to `jutsu.json`. Use an existing `effect` key (`fireball`, `water`, `clone`, `transform`, `lightning`, `wind`, `earth`, `sphere`), or add an effect in `frontend/src/animations/effects/` and register it in `animations/index.ts`.
- **New signs:** add an entry to `backend/config/signs.json` (with a `diagram` and, for the built-in recogniser, a `recognition` block), then restart the backend. Labels are read from the config everywhere.
- **Sign recognition rules:** each sign's `recognition` block in `signs.json` is editable. Use `rules` with `feature`, `min`/`max`, `soft` and `weight`, an optional `threshold`, and optional `finger_weights`. Feature names are listed in `pose.py`, and an unknown feature name stops the backend with a clear error. Turn on the arena's **Debug overlay** to see the live values.
- **Achievements:** `backend/config/achievements.json`. Metrics: `total_activations`, `best_combo`, `distinct_jutsu`, `trained_signs`, `total_score`.

## Testing

```bat
cd backend
.venv\Scripts\python -m pytest            :: 158 tests

cd ..\frontend
npm test                                  :: 107 tests
npm run typecheck
npm run build
```

Backend tests cover the built-in recogniser (each of the 12 signs is recognised from its synthetic pose, with handedness swapped, mirrored and at different scales; non-sign poses such as open hands, fists, relaxed or waving hands never trigger; near-miss explanations; config validation), personal calibration (a personal variant becomes recognisable after 10 samples, too few samples don't count, idle samples veto), out-of-the-box play (Fireball activates with no training), the millisecond hold time, feature normalisation (invariance to position, scale and resolution; missing hands; handedness assignment), landmark validation, the dataset store, training safeguards, model saving, loading and corruption handling, real inference, the stabiliser, the sequence engine (correct, incorrect, retry, timeout, lockout, practice mode, config validation), and the API end to end. The end-to-end path is collect → train → recognise → activate → score → history, plus settings persistence and the sequence editor.

Frontend tests cover navigation and every route, camera state handling (granted, denied, missing, busy, unsupported, fallback device, cleanup on stop and unmount), the API client's error handling (offline, proxy errors, validation errors, timeouts), arena state transitions, the prediction loop (throttling, no overlapping requests, one delivery per event, offline back-off, stale responses), and jutsu-effect triggering and cleanup.

**About the test data:** the automated tests use synthetic hand landmarks from a small 3D hand model (`backend/tests/helpers.py`). They prove the pipeline is wired correctly and that the twelve templates are consistent and clearly separated from each other and from non-sign poses. They are **not** a measurement of accuracy on real webcam landmarks, which has not been measured.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Red "game server is not reachable" banner | The backend isn't running. Start it (see above) and check that port 8000 is free: `netstat -ano \| findstr :8000` |
| `Port 5173 is in use` | Another dev server is running. Close it, or stop the process on that port |
| "Camera permission denied" | Allow the camera via the address-bar icon and in Windows privacy settings, then press **Try again** |
| "Camera is busy" | Close other apps or tabs using the webcam |
| "Hand tracking unavailable" — *library could not be loaded from the dev server* | Two frontend dev servers were started for the same folder, and the second rebuilt Vite's dependency cache under the first. Close every frontend window, run `start.bat` once, and reload the page. `npm run dev` now refuses to start while port 5173 is taken, so this can't recur through `start.bat` or `npm run dev` |
| "Hand tracking unavailable" — *model could not be loaded (…)* | Run `python scripts\setup_project.py` to fetch the model and WASM runtime, or make sure you're online for the CDN fallback. The reason in brackets is the browser's own error. Update your browser |
| "No trained model" | **Recognition engine** is set to *Trained model* but none exists. Switch it to *Auto*, or train a model |
| A sign is never detected | Turn on the **Debug overlay**, form the sign, and read *Not met* (for example "index fingertips together"). Adjust your pose, or **Quick calibrate** the sign so your own version is accepted |
| Always "Unknown sign" | Keep both hands fully in frame, in good light, about an arm's length away. Try **Easy** mode, a lower hold time, or higher sensitivity |
| Wrong signs get accepted | Switch to **Balanced** or **Strict**, Quick-calibrate the **Idle** class, or calibrate the signs that get confused |
| Left and right are swapped | Set `VITE_SWAP_HANDEDNESS=true` in `frontend/.env` and restart `npm run dev`, then re-record samples |
| Effects stutter | **Settings → Visual effects quality → Low/Medium** |
| "The saved model was trained with an older feature format" | Retrain. Your samples are kept, and features are recomputed from them |
| `pip install` fails | Use Python 3.10–3.13 from python.org and rerun the setup script |
| PowerShell blocks `npm` | Use `cmd`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

## Known limitations

- **Real-webcam accuracy of the built-in recogniser has not been measured.** The templates were tuned on synthetic poses. Real MediaPipe landmarks for interlocked fingers are guesses by the model, so expect some signs to need calibration.
- **Signs most likely to need calibration:** the clasped signs, which differ mainly in partly hidden fingers. These are Tiger, Ram, Bird, Dragon and Snake (for example, Bird vs Dragon differ only in the index fingers). Monkey and Ox (flat palms seen edge-on) and Boar (knuckles turned down) are also likely candidates. Rat, Rabbit, Dog and Horse have more distinctive shapes.
- **The poses are game-defined.** The hand-sign guides and templates follow commonly shown references, but sources disagree on some seals (Rat, Rabbit/Hare, Dog). The definitions are configurable in `signs.json`.
- Fast motion, poor lighting and heavily overlapping fingers reduce landmark quality. MediaPipe sometimes loses one hand while fingers are interlocked. The game then shows "One hand detected" instead of guessing.
- One local player profile (`local`). Sessions are already keyed by id, which is the hook for future multiplayer.
- The gameplay layout is optimised for desktop. Other pages are fully responsive.
