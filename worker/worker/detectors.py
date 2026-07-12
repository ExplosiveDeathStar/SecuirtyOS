"""Detection Service: pluggable detectors.

`Detector` is the extension point for every future module (face recognition,
license plates, packages, ...). A detector consumes a frame and returns typed
`Detection`s; the pipeline and event layers are detector-agnostic, so new
capabilities are added by registering another Detector — no rewrites.

Phase 1 ships one detector: `YoloDetector`, which classifies people, animals,
and vehicles in a single inference pass and emits a separate event type for
each group.
"""

from __future__ import annotations

import logging
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass

import cv2
import numpy as np

from . import config

log = logging.getLogger(__name__)

# COCO class ids grouped into SecurityOS event types.
COCO_CLASS_GROUPS: dict[str, set[int]] = {
    "person": {0},
    # bicycle, car, motorcycle, bus, truck
    "vehicle": {1, 2, 3, 5, 7},
    # bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe
    "animal": {14, 15, 16, 17, 18, 19, 20, 21, 22, 23},
}

# COCO objects that reveal what room/area a camera is watching.
# Used to auto-suggest the camera's location label.
ROOM_HINTS: dict[int, tuple[str, float]] = {
    72: ("Kitchen", 1.0),        # refrigerator
    69: ("Kitchen", 1.0),        # oven
    68: ("Kitchen", 0.9),        # microwave
    70: ("Kitchen", 0.8),        # toaster
    71: ("Kitchen", 0.6),        # sink (also bathrooms)
    59: ("Bedroom", 1.0),        # bed
    61: ("Bathroom", 1.0),       # toilet
    57: ("Living Room", 0.9),    # couch
    62: ("Living Room", 0.5),    # tv
    60: ("Dining Area", 0.8),    # dining table
    63: ("Office", 0.7),         # laptop
    66: ("Office", 0.5),         # keyboard
    2:  ("Driveway", 0.9),       # car
    7:  ("Driveway", 0.8),       # truck
    1:  ("Garage", 0.5),         # bicycle
}

# Overlay/snapshot colors per event type (BGR).
EVENT_COLORS: dict[str, tuple[int, int, int]] = {
    "person": (76, 175, 80),     # green
    "animal": (0, 165, 255),     # orange
    "vehicle": (255, 170, 60),   # blue
}
DEFAULT_COLOR = (200, 200, 200)


@dataclass
class Detection:
    """One detected object in one frame."""

    event_type: str                       # "person" | "animal" | "vehicle" | future types
    confidence: float                     # 0..1
    bbox: tuple[int, int, int, int]       # x1, y1, x2, y2 in pixels
    label: str = ""                       # concrete class, e.g. "dog", "car"


class Detector(ABC):
    """Interface every detection module implements."""

    @abstractmethod
    def detect(self, frame: np.ndarray) -> list[Detection]:
        """Analyze one BGR frame and return all detections in it."""


class YoloDetector(Detector):
    """YOLO11-based detector for people, animals, and vehicles.

    All enabled groups are detected in ONE inference pass, so adding event
    types costs nothing at runtime. Trees, shadows, rain, and lighting changes
    produce no object geometry, so they are ignored by construction.

    A single model instance is shared across all camera pipelines; inference
    is serialized with a lock for thread safety.
    """

    def __init__(self, model_name: str = config.MODEL_NAME,
                 enabled_types: tuple[str, ...] | None = None):
        from ultralytics import YOLO  # deferred: heavy import

        self._enabled = [t for t in (enabled_types or config.DETECT_TYPES)
                         if t in COCO_CLASS_GROUPS]
        self._class_to_type = {
            class_id: event_type
            for event_type in self._enabled
            for class_id in COCO_CLASS_GROUPS[event_type]
        }
        log.info("Loading YOLO model %s (detecting: %s) ...",
                 model_name, ", ".join(self._enabled))
        self._model = YOLO(model_name)
        self._class_names = self._model.names
        self._lock = threading.Lock()
        log.info("YOLO model ready")

    def suggest_room(self, frame: np.ndarray) -> str | None:
        """Guess the room/area this camera watches from visible objects
        (fridge -> Kitchen, bed -> Bedroom, car -> Driveway, ...)."""
        infer_frame = frame
        if frame.shape[1] > config.INFERENCE_MAX_WIDTH:
            scale = config.INFERENCE_MAX_WIDTH / frame.shape[1]
            infer_frame = cv2.resize(
                frame, (config.INFERENCE_MAX_WIDTH, int(frame.shape[0] * scale)))

        with self._lock:
            results = self._model.predict(
                infer_frame, classes=sorted(ROOM_HINTS), conf=0.35, verbose=False,
            )
        votes: dict[str, float] = {}
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                hint = ROOM_HINTS.get(int(box.cls[0]))
                if hint:
                    room, weight = hint
                    votes[room] = votes.get(room, 0.0) + weight * float(box.conf[0])
        if not votes:
            return None
        return max(votes, key=lambda room: votes[room])

    def detect(self, frame: np.ndarray) -> list[Detection]:
        infer_frame = frame
        scale = 1.0
        if frame.shape[1] > config.INFERENCE_MAX_WIDTH:
            scale = config.INFERENCE_MAX_WIDTH / frame.shape[1]
            infer_frame = cv2.resize(
                frame,
                (config.INFERENCE_MAX_WIDTH, int(frame.shape[0] * scale)),
            )

        with self._lock:
            results = self._model.predict(
                infer_frame,
                classes=sorted(self._class_to_type),
                conf=config.CONFIDENCE_THRESHOLD,
                verbose=False,
            )
        detections: list[Detection] = []
        inv_scale = 1.0 / scale
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                class_id = int(box.cls[0])
                event_type = self._class_to_type.get(class_id)
                if event_type is None:
                    continue
                x1, y1, x2, y2 = (int(v * inv_scale) for v in box.xyxy[0].tolist())
                detections.append(
                    Detection(
                        event_type=event_type,
                        confidence=float(box.conf[0]),
                        bbox=(x1, y1, x2, y2),
                        label=str(self._class_names.get(class_id, event_type)),
                    )
                )
        return detections
