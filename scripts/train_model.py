"""Train the hand-sign classifier from the command line.

Equivalent to pressing "Train model" in the Training Studio. Uses the same
dataset, feature extraction and safeguards as the web app.

    backend\\.venv\\Scripts\\python scripts\\train_model.py
    backend\\.venv\\Scripts\\python scripts\\train_model.py --min-samples 30 --trees 300

A running backend picks up the new model the next time it starts (or
immediately if training is started from the web app instead).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import IDLE_LABEL, AppConfig  # noqa: E402
from app.jutsu import GameRegistry  # noqa: E402
from app.recognition.dataset import DatasetStore  # noqa: E402
from app.recognition.trainer import InsufficientDataError, plan_training, train_model  # noqa: E402


def main() -> int:
    config = AppConfig.from_env()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--min-samples", type=int, default=config.min_samples_per_class, help="minimum samples for a class to be trained")
    parser.add_argument("--trees", type=int, default=config.forest_trees, help="number of trees in the random forest")
    parser.add_argument("--dry-run", action="store_true", help="only show what would be trained")
    args = parser.parse_args()

    registry = GameRegistry(config.config_dir)
    dataset = DatasetStore(config.dataset_dir, registry.sign_ids + [IDLE_LABEL])
    counts = dataset.counts()
    plan = plan_training(counts, args.min_samples, config.min_classes)

    print(f"Dataset: {config.dataset_dir}")
    for label, count in counts.items():
        marker = "train" if label in plan.eligible else ("skip " if count else "     ")
        print(f"  [{marker}] {label:<8} {count:>5} samples")
    if not plan.can_train:
        print(f"\nCannot train: {plan.blocking_reason}")
        return 1
    if args.dry_run:
        print(f"\nWould train {len(plan.eligible)} classes.")
        return 0

    print(f"\nTraining {len(plan.eligible)} classes with {args.trees} trees...")
    try:
        report = train_model(dataset, config.model_dir, min_samples=args.min_samples, min_classes=config.min_classes, n_estimators=args.trees)
    except InsufficientDataError as exc:
        print(f"Cannot train: {exc}")
        return 1

    print(f"Saved model to {config.model_dir}")
    evaluation = report["evaluation"]
    if evaluation is None:
        print(f"No evaluation: {report['evaluation_note']}")
        return 0
    print(f"\n{evaluation['folds']}-fold {evaluation['method']}")
    print(f"  accuracy  {evaluation['accuracy']:.1%}")
    print(f"  macro F1  {evaluation['macro_f1']:.1%}")
    print(f"  {'class':<8} {'precision':>9} {'recall':>7} {'support':>8}")
    for label, metrics in evaluation["per_class"].items():
        print(f"  {label:<8} {metrics['precision']:>9.1%} {metrics['recall']:>7.1%} {metrics['support']:>8}")
    print(f"\nNote: {evaluation['note']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
