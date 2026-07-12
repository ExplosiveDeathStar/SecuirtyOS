"""Per-camera detection pipeline.

One `CameraPipeline` thread per camera:

    CameraStream (latest frame) -> Detector(s) -> EventTracker -> backend/media

The pipeline runs at PIPELINE_FPS, always consuming the newest frame (never a
backlog), and runs inference every DETECT_EVERY_N_FRAMES ticks. Frames between
inferences still feed active clip recordings, keeping clips smooth while
inference stays cheap.
"""

from __future__ import annotations

import logging
import threading
import time

from . import backend_client, config
from .capture import CameraStream
from .detectors import Detector
from .events import EventTracker
from .faces import FaceIdentifier

log = logging.getLogger(__name__)

# Face identification is heavier than YOLO; run it at most this often
# per camera, and only while a person is in frame.
FACE_ID_INTERVAL_SECONDS = 1.0


class CameraPipeline(threading.Thread):
    """Drives detection for a single camera."""

    def __init__(self, camera_id: str, stream: CameraStream,
                 detectors: list[Detector], tracker: EventTracker,
                 face_identifier: FaceIdentifier | None = None):
        super().__init__(name=f"pipeline-{camera_id}", daemon=True)
        self.camera_id = camera_id
        self.stream = stream
        self.detectors = detectors
        self.tracker = tracker
        self.face_identifier = face_identifier
        # Detections from the most recent inference, for preview overlays.
        self.last_detections: list = []
        self._stop = threading.Event()
        self._last_face_id_at = 0.0
        self._location_suggested = False

    def stop(self) -> None:
        self._stop.set()
        self.stream.stop()

    def run(self) -> None:
        tick_interval = 1.0 / config.PIPELINE_FPS
        last_seq = -1
        tick = 0

        while not self._stop.is_set():
            started = time.monotonic()
            data = self.stream.latest_frame()

            if data is not None and data.seq != last_seq:
                last_seq = data.seq
                tick += 1

                detections = None
                if tick % config.DETECT_EVERY_N_FRAMES == 0:
                    detections = []
                    for detector in self.detectors:
                        try:
                            detections.extend(detector.detect(data.frame))
                        except Exception:
                            log.exception("Camera %s: detector %s failed",
                                          self.camera_id, type(detector).__name__)
                    self.last_detections = detections

                # One-shot: guess the camera's location from what it sees and
                # offer it to the backend (applied only if location is empty).
                if not self._location_suggested and detections is not None:
                    self._location_suggested = True
                    try:
                        room = self._suggest_room(data.frame)
                        if room:
                            backend_client.report_location_suggestion(self.camera_id, room)
                    except Exception:
                        log.exception("Camera %s: location suggestion failed", self.camera_id)

                person_ids = None
                if (detections and self.face_identifier is not None
                        and any(d.event_type == "person" for d in detections)):
                    now = time.monotonic()
                    if now - self._last_face_id_at >= FACE_ID_INTERVAL_SECONDS:
                        self._last_face_id_at = now
                        person_ids = self.face_identifier.identify(data.frame)

                try:
                    self.tracker.process(data.frame, detections, person_ids)
                except Exception:
                    log.exception("Camera %s: event tracking failed", self.camera_id)

            elapsed = time.monotonic() - started
            self._stop.wait(max(tick_interval - elapsed, 0.005))

        self.tracker.close_all()

    def _suggest_room(self, frame) -> str | None:
        for detector in self.detectors:
            suggest = getattr(detector, "suggest_room", None)
            if suggest is not None:
                return suggest(frame)
        return None
