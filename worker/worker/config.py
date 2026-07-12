"""Worker configuration. All values are local and overridable via environment."""

import os

# Backend internal API (localhost only).
BACKEND_URL = os.environ.get("SECURITYOS_BACKEND_URL", "http://127.0.0.1:4000")

# HTTP server for previews / health / control.
HOST = os.environ.get("SECURITYOS_WORKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("SECURITYOS_WORKER_PORT", "8001"))

# Detection model. YOLO11 nano gives real-time multi-camera CPU inference;
# swap for yolo11s/m if a GPU is available.
MODEL_NAME = os.environ.get("SECURITYOS_MODEL", "yolo11n.pt")

# Minimum confidence to accept a detection. Filters shadows, foliage,
# rain and other motion noise — YOLO only fires on actual object geometry.
CONFIDENCE_THRESHOLD = float(os.environ.get("SECURITYOS_CONFIDENCE", "0.5"))

# Which event types to detect (comma-separated). See detectors.COCO_CLASS_GROUPS.
DETECT_TYPES = tuple(
    t.strip()
    for t in os.environ.get("SECURITYOS_DETECT_TYPES", "person,animal,vehicle").split(",")
    if t.strip()
)

# Frames per second the pipeline processes per camera (capture may be faster;
# we always grab the latest frame and drop the rest). Capped to avoid CPU melt.
_raw_pipeline_fps = float(os.environ.get("SECURITYOS_PIPELINE_FPS", "12"))
PIPELINE_FPS = min(max(_raw_pipeline_fps, 1.0), 20.0)
if _raw_pipeline_fps > PIPELINE_FPS:
    import logging
    logging.getLogger(__name__).warning(
        "SECURITYOS_PIPELINE_FPS=%s is too high for CPU inference; using %s",
        _raw_pipeline_fps, PIPELINE_FPS,
    )

# Run inference on every Nth pipeline frame (12 fps pipeline / 2 = 6 inferences/s).
DETECT_EVERY_N_FRAMES = max(int(os.environ.get("SECURITYOS_DETECT_EVERY", "2")), 1)

# Downscale frames before YOLO so main-stream RTSP (2K+) stays usable on CPU.
INFERENCE_MAX_WIDTH = int(os.environ.get("SECURITYOS_INFERENCE_WIDTH", "960"))

# Seconds without a person before an event is considered over.
EVENT_LINGER_SECONDS = float(os.environ.get("SECURITYOS_EVENT_LINGER", "5"))

# Hard cap on a single event/clip; a longer presence rolls into a new event.
EVENT_MAX_SECONDS = float(os.environ.get("SECURITYOS_EVENT_MAX", "300"))

# Live preview JPEG quality / max width.
PREVIEW_JPEG_QUALITY = int(os.environ.get("SECURITYOS_PREVIEW_QUALITY", "80"))
PREVIEW_MAX_WIDTH = int(os.environ.get("SECURITYOS_PREVIEW_WIDTH", "960"))

# Clip encoding.
CLIP_FPS = int(os.environ.get("SECURITYOS_CLIP_FPS", "10"))
