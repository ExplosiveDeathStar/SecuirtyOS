"""Event Service (worker side): turns raw per-frame detections into events.

State machine per camera and event type:

    idle --person detected--> ACTIVE (open event, snapshot, start clip)
    ACTIVE --person still present--> extend, track peak confidence
    ACTIVE --no person for EVENT_LINGER_SECONDS--> close (duration, clip)
    ACTIVE --EVENT_MAX_SECONDS reached--> close and allow a new event

Timestamps use wall-clock time; durations use the detection window between the
first and last positive detection.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np

from . import backend_client, config
from .detectors import Detection
from .media import ClipWriter, save_snapshot

log = logging.getLogger(__name__)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


@dataclass
class _ActiveEvent:
    event_id: str
    event_type: str
    started_at: float
    last_seen_at: float
    peak_confidence: float
    clip: ClipWriter
    last_reported_confidence: float = field(default=0.0)
    # Persons already attached to this event (avoid duplicate reports).
    reported_person_ids: set[str] = field(default_factory=set)


class EventTracker:
    """Tracks active events for a single camera."""

    def __init__(self, camera_id: str, snapshots_dir: str, clips_dir: str):
        self.camera_id = camera_id
        self.snapshots_dir = snapshots_dir
        self.clips_dir = clips_dir
        self._active: dict[str, _ActiveEvent] = {}  # keyed by event type

    @property
    def has_active_event(self) -> bool:
        return bool(self._active)

    def process(self, frame: np.ndarray, detections: list[Detection] | None,
                person_ids: list[str] | None = None) -> None:
        """Feed one pipeline frame.

        `detections` is None when inference was skipped this frame (frame is
        still appended to any open clips); otherwise it is the full detection
        list, possibly empty. `person_ids` carries face identities recognized
        in this frame (None when face ID did not run).
        """
        now = time.time()

        # Keep clips rolling on every frame while events are active.
        for active in self._active.values():
            active.clip.write(frame)

        if detections is not None:
            by_type: dict[str, list[Detection]] = {}
            for det in detections:
                by_type.setdefault(det.event_type, []).append(det)

            for event_type, dets in by_type.items():
                best = max(d.confidence for d in dets)
                active = self._active.get(event_type)
                if active is None:
                    self._open(event_type, frame, dets, best, now)
                else:
                    active.last_seen_at = now
                    if best > active.peak_confidence:
                        active.peak_confidence = best
                        # Report meaningful confidence jumps so the dashboard stays live.
                        if best - active.last_reported_confidence >= 0.05:
                            backend_client.update_event(active.event_id, confidence=best)
                            active.last_reported_confidence = best

        # Attach recognized faces to the open person event.
        if person_ids:
            person_event = self._active.get("person")
            if person_event is not None:
                new_ids = [p for p in person_ids
                           if p not in person_event.reported_person_ids]
                if new_ids:
                    backend_client.add_event_persons(person_event.event_id, new_ids)
                    person_event.reported_person_ids.update(new_ids)

        # Close events whose subject left, or that hit the max duration.
        for event_type in list(self._active):
            active = self._active[event_type]
            if now - active.last_seen_at >= config.EVENT_LINGER_SECONDS:
                self._close(event_type)
            elif now - active.started_at >= config.EVENT_MAX_SECONDS:
                log.info("Camera %s: event %s hit max duration, rolling over",
                         self.camera_id, active.event_id)
                self._close(event_type)

    def close_all(self) -> None:
        """Flush all active events (camera removed / worker shutting down)."""
        for event_type in list(self._active):
            self._close(event_type)

    # -- internals -----------------------------------------------------------

    def _open(self, event_type: str, frame: np.ndarray, dets: list[Detection],
              confidence: float, now: float) -> None:
        snapshot = save_snapshot(self.snapshots_dir, frame, dets)
        event_id = backend_client.open_event(
            self.camera_id, event_type, _iso(now), confidence, snapshot
        )
        if event_id is None:
            return  # backend unreachable; try again on the next detection
        clip = ClipWriter(self.clips_dir)
        clip.write(frame)
        self._active[event_type] = _ActiveEvent(
            event_id=event_id,
            event_type=event_type,
            started_at=now,
            last_seen_at=now,
            peak_confidence=confidence,
            clip=clip,
            last_reported_confidence=confidence,
        )
        log.info("Camera %s: %s event opened (%s, conf %.2f)",
                 self.camera_id, event_type, event_id, confidence)

    def _close(self, event_type: str) -> None:
        active = self._active.pop(event_type)
        clip_path = active.clip.close()
        duration = max(active.last_seen_at - active.started_at, 1.0)
        backend_client.close_event(
            active.event_id,
            ended_at=_iso(active.last_seen_at),
            duration_s=round(duration, 1),
            confidence=active.peak_confidence,
            clip_path=clip_path,
        )
        log.info("Camera %s: %s event closed (%.1fs, conf %.2f)",
                 self.camera_id, event_type, duration, active.peak_confidence)
