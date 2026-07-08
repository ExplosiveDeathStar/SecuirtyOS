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

from . import config
from .capture import CameraStream
from .detectors import Detector
from .events import EventTracker

log = logging.getLogger(__name__)


class CameraPipeline(threading.Thread):
    """Drives detection for a single camera."""

    def __init__(self, camera_id: str, stream: CameraStream,
                 detectors: list[Detector], tracker: EventTracker):
        super().__init__(name=f"pipeline-{camera_id}", daemon=True)
        self.camera_id = camera_id
        self.stream = stream
        self.detectors = detectors
        self.tracker = tracker
        # Detections from the most recent inference, for preview overlays.
        self.last_detections: list = []
        self._stop = threading.Event()

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

                try:
                    self.tracker.process(data.frame, detections)
                except Exception:
                    log.exception("Camera %s: event tracking failed", self.camera_id)

            elapsed = time.monotonic() - started
            self._stop.wait(max(tick_interval - elapsed, 0.005))

        self.tracker.close_all()
