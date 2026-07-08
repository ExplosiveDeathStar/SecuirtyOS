"""Camera Service (capture side): resilient frame acquisition.

Each camera gets a `CameraStream` thread that owns its source, reconnects
with backoff, and always exposes only the *latest* frame — detection never
falls behind a live stream.

Supported sources:
  rtsp://...    real IP cameras (OpenCV/FFmpeg)
  webcam://N    local webcam device N (0 = built-in camera)
  screen://N    live capture of monitor N (1 = primary; 0 = all monitors)
  /path/to.mp4  video files, looped forever (development / demos)
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from urllib.parse import quote, urlsplit, urlunsplit

import cv2
import numpy as np

log = logging.getLogger(__name__)

_RECONNECT_BACKOFF_S = [1, 2, 5, 10, 30]

# Screen capture runs at this rate and is downscaled to keep inference fast.
_SCREEN_FPS = 10.0
_SCREEN_MAX_WIDTH = 1280


def build_stream_url(rtsp_url: str, username: str, password: str) -> str:
    """Inject credentials into an RTSP URL (rtsp://user:pass@host/...).

    Local file paths / non-RTSP URLs are passed through untouched, which also
    makes the pipeline testable against video files.
    """
    if not rtsp_url.startswith("rtsp://") or not username:
        return rtsp_url
    parts = urlsplit(rtsp_url)
    if "@" in parts.netloc:  # URL already carries credentials
        return rtsp_url
    cred = quote(username, safe="")
    if password:
        cred += ":" + quote(password, safe="")
    return urlunsplit(parts._replace(netloc=f"{cred}@{parts.netloc}"))


@dataclass
class FrameData:
    frame: np.ndarray
    captured_at: float  # time.time()
    seq: int


class CameraStream(threading.Thread):
    """Continuously reads one camera and holds the most recent frame."""

    def __init__(self, camera_id: str, source_url: str):
        super().__init__(name=f"capture-{camera_id}", daemon=True)
        self.camera_id = camera_id
        self.source_url = source_url
        self.status: str = "connecting"  # connecting | online | offline
        self.error: str | None = None
        self.fps: float = 0.0

        self._latest: FrameData | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._seq = 0
        self._is_screen = source_url.startswith("screen://")
        self._is_webcam = source_url.startswith("webcam://")
        self._is_file = (not self._is_screen and not self._is_webcam
                         and not source_url.startswith(("rtsp://", "http://", "https://")))

    # -- public API ----------------------------------------------------------

    def latest_frame(self) -> FrameData | None:
        with self._lock:
            return self._latest

    def stop(self) -> None:
        self._stop.set()

    @property
    def last_frame_at(self) -> float | None:
        with self._lock:
            return self._latest.captured_at if self._latest else None

    # -- capture loop --------------------------------------------------------

    def run(self) -> None:
        if self._is_screen:
            self._run_screen()
        else:
            self._run_video()
        self.status = "offline"

    def _publish(self, frame: np.ndarray) -> None:
        self._seq += 1
        with self._lock:
            self._latest = FrameData(frame=frame, captured_at=time.time(), seq=self._seq)

    def _run_screen(self) -> None:
        """Continuously capture a monitor (screen://N) as if it were a camera."""
        import mss

        try:
            monitor_index = int(self.source_url.removeprefix("screen://") or "1")
        except ValueError:
            monitor_index = 1

        interval = 1.0 / _SCREEN_FPS
        while not self._stop.is_set():
            try:
                with mss.mss() as sct:
                    # monitors[0] = all displays combined, monitors[1] = primary, ...
                    index = max(0, min(monitor_index, len(sct.monitors) - 1))
                    monitor = sct.monitors[index]
                    self.status = "online"
                    self.error = None
                    log.info("Camera %s: screen capture online (monitor %d, %dx%d)",
                             self.camera_id, index, monitor["width"], monitor["height"])
                    fps_window_start, fps_frames = time.monotonic(), 0

                    while not self._stop.is_set():
                        started = time.monotonic()
                        shot = np.asarray(sct.grab(monitor))          # BGRA
                        frame = cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)
                        if frame.shape[1] > _SCREEN_MAX_WIDTH:
                            scale = _SCREEN_MAX_WIDTH / frame.shape[1]
                            frame = cv2.resize(
                                frame, (_SCREEN_MAX_WIDTH, int(frame.shape[0] * scale))
                            )
                        self._publish(frame)

                        fps_frames += 1
                        now = time.monotonic()
                        if now - fps_window_start >= 2.0:
                            self.fps = fps_frames / (now - fps_window_start)
                            fps_window_start, fps_frames = now, 0

                        self._stop.wait(max(interval - (time.monotonic() - started), 0.005))
            except Exception as exc:
                self.status = "offline"
                self.error = f"Screen capture failed: {exc}"
                log.warning("Camera %s: screen capture failed (%s); retrying in 5s "
                            "(is Screen Recording permission granted?)", self.camera_id, exc)
                self._stop.wait(5)

    def _open_capture(self) -> cv2.VideoCapture:
        if self._is_webcam:
            # webcam://0 -> local device 0 (built-in camera). OpenCV picks the
            # native backend (AVFoundation on macOS, V4L2 on Linux).
            return cv2.VideoCapture(_device_index(self.source_url))
        return cv2.VideoCapture(self.source_url, cv2.CAP_FFMPEG)

    def _run_video(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            cap = self._open_capture()
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # keep latency low on RTSP
            if not cap.isOpened():
                cap.release()
                self.status = "offline"
                self.error = ("Unable to open webcam — is Camera permission granted?"
                              if self._is_webcam else "Unable to open stream")
                delay = _RECONNECT_BACKOFF_S[min(attempt, len(_RECONNECT_BACKOFF_S) - 1)]
                attempt += 1
                log.warning("Camera %s: open failed, retrying in %ss", self.camera_id, delay)
                self._stop.wait(delay)
                continue

            attempt = 0
            self.status = "online"
            self.error = None
            log.info("Camera %s: stream online (%s)", self.camera_id, _redact(self.source_url))

            src_fps = cap.get(cv2.CAP_PROP_FPS) or 0
            frame_interval = 1.0 / src_fps if self._is_file and src_fps > 0 else 0.0
            fps_window_start, fps_frames = time.monotonic(), 0

            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    if self._is_file:
                        # Loop files forever — they emulate a live camera in dev/tests.
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    self.status = "offline"
                    self.error = "Stream dropped"
                    log.warning("Camera %s: stream dropped, reconnecting", self.camera_id)
                    break

                self._publish(frame)

                fps_frames += 1
                now = time.monotonic()
                if now - fps_window_start >= 2.0:
                    self.fps = fps_frames / (now - fps_window_start)
                    fps_window_start, fps_frames = now, 0

                if frame_interval:
                    time.sleep(frame_interval)  # play files at native speed

            cap.release()


def _redact(url: str) -> str:
    """Strip credentials from a URL for logging."""
    if "@" not in url:
        return url
    scheme_rest = url.split("://", 1)
    if len(scheme_rest) != 2:
        return url
    return f"{scheme_rest[0]}://***@{scheme_rest[1].split('@', 1)[1]}"


def _device_index(url: str) -> int:
    """webcam://N -> N (defaults to 0)."""
    try:
        return int(url.removeprefix("webcam://") or "0")
    except ValueError:
        return 0


def test_connection(rtsp_url: str, username: str, password: str) -> dict:
    """Open a stream once and report whether frames are readable."""
    if rtsp_url.startswith("screen://"):
        return _test_screen(rtsp_url)
    if rtsp_url.startswith("webcam://"):
        cap = cv2.VideoCapture(_device_index(rtsp_url))
    else:
        cap = cv2.VideoCapture(build_stream_url(rtsp_url, username, password), cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            return {"ok": False, "message": "Could not open source. For webcams, check Camera "
                                            "permission; for RTSP, check the URL and credentials."}
        ok, frame = cap.read()
        if not ok or frame is None:
            return {"ok": False, "message": "Stream opened but no frames were received."}
        h, w = frame.shape[:2]
        return {"ok": True, "message": f"Connected — receiving {w}x{h} video.", "width": w, "height": h}
    finally:
        cap.release()


def _test_screen(url: str) -> dict:
    """Grab one frame from a screen:// source."""
    import mss

    try:
        index = int(url.removeprefix("screen://") or "1")
    except ValueError:
        index = 1
    try:
        with mss.mss() as sct:
            index = max(0, min(index, len(sct.monitors) - 1))
            shot = sct.grab(sct.monitors[index])
            return {
                "ok": True,
                "message": f"Screen capture OK — monitor {index} at {shot.width}x{shot.height}.",
                "width": shot.width,
                "height": shot.height,
            }
    except Exception as exc:
        return {
            "ok": False,
            "message": f"Screen capture failed: {exc}. On macOS, grant Screen Recording "
                       "permission to the terminal running the worker.",
        }
