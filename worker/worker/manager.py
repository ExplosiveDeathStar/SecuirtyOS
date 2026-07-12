"""Stream manager: reconciles running pipelines with the backend's camera registry.

The backend calls `/reload` after any camera change; the manager then starts,
restarts, or tears down pipelines so the running set always matches the
configured set.
"""

from __future__ import annotations

import logging
import threading
import time

from . import backend_client
from .backend_client import BackendState, CameraConfig
from .capture import CameraStream, build_stream_url
from .detectors import Detector, YoloDetector
from .events import EventTracker
from .faces import FaceIdentifier
from .pipeline import CameraPipeline

log = logging.getLogger(__name__)


class StreamManager:
    def __init__(self) -> None:
        self._pipelines: dict[str, CameraPipeline] = {}
        self._configs: dict[str, CameraConfig] = {}
        self._state: BackendState | None = None
        self._detectors: list[Detector] | None = None
        self._face_identifiers: dict[str, FaceIdentifier] = {}
        self._lock = threading.Lock()

    # -- lifecycle -----------------------------------------------------------

    def start(self) -> None:
        """Fetch config from the backend (retrying until it is up) and start pipelines."""
        threading.Thread(target=self._startup_loop, name="manager-startup", daemon=True).start()

    def _startup_loop(self) -> None:
        while True:
            try:
                self.reload()
                return
            except Exception as exc:
                log.warning("Backend not reachable yet (%s); retrying in 3s", exc)
                time.sleep(3)

    def _get_detectors(self) -> list[Detector]:
        """Detectors shared by all cameras. Future modules register here."""
        if self._detectors is None:
            self._detectors = [YoloDetector()]
        return self._detectors

    def reload(self) -> None:
        """Sync running pipelines with the backend's camera registry."""
        state = backend_client.fetch_state()
        with self._lock:
            self._state = state
            desired = {c.id: c for c in state.cameras if c.enabled}

            # Stop pipelines for removed/disabled/changed cameras.
            for camera_id in list(self._pipelines):
                current = self._configs.get(camera_id)
                new = desired.get(camera_id)
                if new is None or self._source_changed(current, new):
                    log.info("Stopping pipeline for camera %s", camera_id)
                    self._pipelines.pop(camera_id).stop()
                    self._configs.pop(camera_id, None)

            # Start pipelines for new cameras.
            for camera_id, cam in desired.items():
                if camera_id in self._pipelines:
                    self._configs[camera_id] = cam
                    continue
                log.info("Starting pipeline for camera %s (%s)", camera_id, cam.name)
                url = build_stream_url(cam.rtsp_url, cam.username, cam.password)
                stream = CameraStream(camera_id, url)
                tracker = EventTracker(camera_id, state.storage.snapshots_dir,
                                       state.storage.clips_dir)
                face_identifier = self._face_identifiers.setdefault(
                    cam.site_id, FaceIdentifier(state.storage.faces_dir, cam.site_id)
                )
                pipeline = CameraPipeline(camera_id, stream, self._get_detectors(),
                                          tracker, face_identifier)
                stream.start()
                pipeline.start()
                self._pipelines[camera_id] = pipeline
                self._configs[camera_id] = cam

    @staticmethod
    def _source_changed(old: CameraConfig | None, new: CameraConfig) -> bool:
        if old is None:
            return True
        return (old.rtsp_url, old.username, old.password) != (new.rtsp_url, new.username, new.password)

    def shutdown(self) -> None:
        with self._lock:
            for pipeline in self._pipelines.values():
                pipeline.stop()
            for pipeline in self._pipelines.values():
                pipeline.join(timeout=5)
            self._pipelines.clear()

    # -- introspection -------------------------------------------------------

    def get_pipeline(self, camera_id: str) -> CameraPipeline | None:
        with self._lock:
            return self._pipelines.get(camera_id)

    def health(self) -> dict:
        """Per-camera runtime health for the backend dashboard."""
        from datetime import datetime, timezone

        with self._lock:
            cameras = {}
            configured = {c.id: c for c in (self._state.cameras if self._state else [])}
            for camera_id, cam in configured.items():
                pipeline = self._pipelines.get(camera_id)
                if not cam.enabled or pipeline is None:
                    cameras[camera_id] = {
                        "status": "disabled" if not cam.enabled else "connecting",
                        "fps": 0, "lastFrameAt": None, "activeEvent": False, "error": None,
                    }
                    continue
                stream = pipeline.stream
                last = stream.last_frame_at
                # A stream is only healthy if frames are actually flowing.
                stale = last is None or (time.time() - last) > 10
                status = stream.status if not stale else ("connecting" if stream.status == "connecting" else "offline")
                cameras[camera_id] = {
                    "status": status,
                    "fps": round(stream.fps, 1),
                    "lastFrameAt": (
                        datetime.fromtimestamp(last, tz=timezone.utc).isoformat() if last else None
                    ),
                    "activeEvent": pipeline.tracker.has_active_event,
                    "error": stream.error,
                }
            return cameras
