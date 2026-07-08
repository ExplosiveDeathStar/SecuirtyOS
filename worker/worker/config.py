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
# we always grab the latest frame and drop the rest).
PIPELINE_FPS = float(os.environ.get("SECURITYOS_PIPELINE_FPS", "10"))

# Run inference on every Nth pipeline frame (10 fps pipeline / 2 = 5 inferences/s).
DETECT_EVERY_N_FRAMES = int(os.environ.get("SECURITYOS_DETECT_EVERY", "2"))

# Seconds without a person before an event is considered over.
EVENT_LINGER_SECONDS = float(os.environ.get("SECURITYOS_EVENT_LINGER", "5"))

# Hard cap on a single event/clip; a longer presence rolls into a new event.
EVENT_MAX_SECONDS = float(os.environ.get("SECURITYOS_EVENT_MAX", "300"))

# Live preview JPEG quality / max width.
PREVIEW_JPEG_QUALITY = int(os.environ.get("SECURITYOS_PREVIEW_QUALITY", "80"))
PREVIEW_MAX_WIDTH = int(os.environ.get("SECURITYOS_PREVIEW_WIDTH", "960"))

# Clip encoding.
CLIP_FPS = int(os.environ.get("SECURITYOS_CLIP_FPS", "10"))
