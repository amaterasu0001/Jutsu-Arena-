from __future__ import annotations

from app.core.config import IDLE_LABEL
from app.database import AchievementRepository, HistoryRepository
from app.jutsu import GameRegistry
from app.models import AchievementDefinition
from app.recognition.classifier import SignClassifier


class AchievementService:
    def __init__(
        self,
        registry: GameRegistry,
        history: HistoryRepository,
        repository: AchievementRepository,
        classifier: SignClassifier,
    ) -> None:
        self._registry = registry
        self._history = history
        self._repository = repository
        self._classifier = classifier

    def _metrics(self, player_id: str) -> dict[str, int]:
        stats = self._history.stats(player_id)
        return {
            "total_activations": stats["total_activations"],
            "best_combo": stats["best_combo"],
            "distinct_jutsu": len(stats["per_jutsu"]),
            "total_score": stats["total_score"],
            "trained_signs": len([c for c in self._classifier.classes if c != IDLE_LABEL]),
        }

    def evaluate(self, player_id: str) -> list[AchievementDefinition]:
        """Unlock everything newly earned and return those definitions."""
        metrics = self._metrics(player_id)
        unlocked = self._repository.unlocked(player_id)
        newly: list[AchievementDefinition] = []
        for achievement in self._registry.achievements:
            if achievement.id in unlocked:
                continue
            if metrics.get(achievement.metric, 0) >= achievement.threshold:
                if self._repository.unlock(player_id, achievement.id):
                    newly.append(achievement)
        return newly

    def overview(self, player_id: str) -> list[dict]:
        metrics = self._metrics(player_id)
        unlocked = self._repository.unlocked(player_id)
        return [
            {
                "id": a.id,
                "name": a.name,
                "description": a.description,
                "icon": a.icon,
                "metric": a.metric,
                "threshold": a.threshold,
                "progress": min(metrics.get(a.metric, 0), a.threshold),
                "unlocked": a.id in unlocked,
                "unlocked_at": unlocked.get(a.id),
            }
            for a in self._registry.achievements
        ]
