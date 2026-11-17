"""One-time project setup (safe to run again).

    python scripts\\setup_project.py

1. Creates backend/.venv and installs the Python dependencies.
2. Installs the frontend npm packages (this also copies the MediaPipe WASM runtime).
3. Downloads the MediaPipe hand-landmark model into frontend/public/models.

Use --skip-model to skip the download; the app then loads the model from the
public MediaPipe CDN at runtime instead.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
MODEL_PATH = FRONTEND / "public" / "models" / "hand_landmarker.task"
# Person segmentation for the Shadow Clone photo. It runs in the browser: the
# photo is processed on your machine and never uploaded anywhere.
SEGMENTER_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite"
)
SEGMENTER_PATH = FRONTEND / "public" / "models" / "selfie_segmenter.tflite"


def step(message: str) -> None:
    print(f"\n==> {message}", flush=True)


def run(command: list[str], cwd: Path) -> None:
    print("    $ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def setup_backend(dev: bool) -> None:
    step("Backend: Python virtual environment")
    if sys.version_info < (3, 10):
        sys.exit(f"Python 3.10 or newer is required (found {sys.version.split()[0]}).")
    if not venv_python().exists():
        run([sys.executable, "-m", "venv", str(VENV)], ROOT)
    run([str(venv_python()), "-m", "pip", "install", "--upgrade", "pip"], ROOT)
    requirements = "requirements-dev.txt" if dev else "requirements.txt"
    run([str(venv_python()), "-m", "pip", "install", "-r", requirements], BACKEND)
    for folder in ("dataset", "trained_models", "data"):
        (BACKEND / folder).mkdir(exist_ok=True)


def setup_frontend() -> None:
    step("Frontend: npm packages")
    npm = shutil.which("npm")
    if npm is None:
        sys.exit("npm was not found. Install Node.js 20 or newer from https://nodejs.org and run this again.")
    run([npm, "install"], FRONTEND)


def fetch(title: str, url: str, path: Path, min_bytes: int, force: bool) -> None:
    step(title)
    if path.exists() and path.stat().st_size > min_bytes and not force:
        print(f"    already present: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".download")
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "jutsu-arena-setup"})
        with urllib.request.urlopen(request, timeout=60) as response, temp.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        temp.replace(path)
        print(f"    saved {path.stat().st_size / 1e6:.2f} MB to {path}")
    except OSError as exc:
        temp.unlink(missing_ok=True)
        print(f"    download failed ({exc}). The app will fall back to the MediaPipe CDN at runtime.")


def download_model(force: bool) -> None:
    fetch("MediaPipe hand-landmark model", MODEL_URL, MODEL_PATH, 1_000_000, force)
    fetch("MediaPipe selfie-segmentation model (Shadow Clone photo)", SEGMENTER_URL, SEGMENTER_PATH, 50_000, force)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip-model", action="store_true", help="do not download the MediaPipe models")
    parser.add_argument("--force-model", action="store_true", help="download the model even if it exists")
    parser.add_argument("--no-dev", action="store_true", help="skip test dependencies (pytest, httpx)")
    args = parser.parse_args()

    setup_backend(dev=not args.no_dev)
    setup_frontend()
    if not args.skip_model:
        download_model(args.force_model)

    print("\nSetup complete. Run start.bat (or see README.md) to launch the app.")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(f"\nSetup failed while running: {' '.join(map(str, exc.cmd))}")
