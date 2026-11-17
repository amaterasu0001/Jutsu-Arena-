"""Validated landmark payloads shared by prediction and training endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LANDMARKS_PER_HAND = 21
MAX_HANDS = 2

# MediaPipe coordinates are normalised to the image, but landmarks of a hand
# that is partly outside the frame can fall slightly outside [0, 1].
Coordinate = Annotated[float, Field(allow_inf_nan=False, ge=-2.0, le=3.0)]
Point = tuple[Coordinate, Coordinate, Coordinate]


class HandIn(BaseModel):
    """One detected hand: 21 landmarks as ``[x, y, z]`` triples."""

    model_config = ConfigDict(extra="forbid")

    handedness: Literal["Left", "Right"]
    score: float = Field(1.0, ge=0.0, le=1.0, allow_inf_nan=False)
    landmarks: list[Point] = Field(min_length=LANDMARKS_PER_HAND, max_length=LANDMARKS_PER_HAND)

    @model_validator(mode="after")
    def _reject_degenerate(self) -> "HandIn":
        xs = [point[0] for point in self.landmarks]
        ys = [point[1] for point in self.landmarks]
        if max(xs) - min(xs) < 1e-4 and max(ys) - min(ys) < 1e-4:
            raise ValueError("hand landmarks are degenerate (all points coincide)")
        return self


class FrameIn(BaseModel):
    """All hands detected in a single camera frame."""

    model_config = ConfigDict(extra="forbid")

    hands: list[HandIn] = Field(default_factory=list, max_length=MAX_HANDS)
    image_width: int = Field(1280, ge=16, le=16384)
    image_height: int = Field(720, ge=16, le=16384)
