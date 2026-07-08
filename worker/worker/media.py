"""Storage helpers: snapshots (JPEG) and event clips (H.264 MP4).

Media is written directly into the backend's `data/media/` tree and referenced
by relative path (e.g. "clips/<event>.mp4"), which the backend serves at
`/media/...`. Clips are encoded with the ffmpeg binary bundled by
imageio-ffmpeg, so browser-playable H.264 works with zero system dependencies.
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
import uuid

import cv2
import numpy as np

from . import config

log = logging.getLogger(__name__)


def save_snapshot(snapshots_dir: str, frame: np.ndarray,
                  detections: list | None = None) -> str | None:
    """Write a JPEG snapshot (with detection boxes burned in). Returns the
    path relative to the media dir, e.g. "snapshots/<id>.jpg"."""
    from .detectors import DEFAULT_COLOR, EVENT_COLORS

    try:
        os.makedirs(snapshots_dir, exist_ok=True)
        annotated = frame.copy()
        for det in detections or []:
            x1, y1, x2, y2 = det.bbox
            color = EVENT_COLORS.get(det.event_type, DEFAULT_COLOR)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            label = f"{det.label or det.event_type} {det.confidence:.0%}"
            cv2.putText(annotated, label, (x1, max(y1 - 8, 16)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        filename = f"{uuid.uuid4().hex}.jpg"
        cv2.imwrite(os.path.join(snapshots_dir, filename),
                    annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return f"snapshots/{filename}"
    except Exception:
        log.exception("Failed to save snapshot")
        return None


class ClipWriter:
    """Streams frames to an H.264 MP4 file while an event is active."""

    def __init__(self, clips_dir: str):
        os.makedirs(clips_dir, exist_ok=True)
        self._filename = f"{uuid.uuid4().hex}.mp4"
        self._path = os.path.join(clips_dir, self._filename)
        self._proc: subprocess.Popen | None = None
        self._size: tuple[int, int] | None = None  # (w, h)
        self._last_write = 0.0
        self._failed = False

    @property
    def relative_path(self) -> str:
        return f"clips/{self._filename}"

    def _start(self, width: int, height: int) -> None:
        import imageio_ffmpeg

        # H.264 requires even dimensions.
        width -= width % 2
        height -= height % 2
        self._size = (width, height)
        cmd = [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}", "-r", str(config.CLIP_FPS),
            "-i", "-",
            "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            self._path,
        ]
        self._proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def write(self, frame: np.ndarray) -> None:
        """Append a frame, rate-limited to the clip FPS."""
        if self._failed:
            return
        now = time.monotonic()
        if now - self._last_write < 1.0 / config.CLIP_FPS:
            return
        self._last_write = now
        try:
            if self._proc is None:
                h, w = frame.shape[:2]
                self._start(w, h)
            w, h = self._size  # type: ignore[misc]
            if frame.shape[1] != w or frame.shape[0] != h:
                frame = cv2.resize(frame, (w, h))
            self._proc.stdin.write(frame.tobytes())  # type: ignore[union-attr]
        except Exception:
            log.exception("Clip write failed; disabling clip for this event")
            self._failed = True

    def close(self) -> str | None:
        """Finalize the MP4. Returns the media-relative path, or None on failure."""
        if self._proc is None:
            return None
        try:
            self._proc.stdin.close()  # type: ignore[union-attr]
            self._proc.wait(timeout=30)
        except Exception:
            log.exception("Failed to finalize clip")
            self._proc.kill()
            return None
        if self._failed or self._proc.returncode != 0 or not os.path.exists(self._path):
            return None
        return self.relative_path
