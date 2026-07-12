"""SecurityOS detection worker — HTTP entry point.

Endpoints (localhost only, consumed by the backend):
    GET  /health              per-camera runtime health
    POST /reload              re-sync pipelines with the camera registry
    POST /test                one-shot connection test for camera settings
    GET  /preview/{camera}    MJPEG live preview with detection overlays

Run:  python -m worker.main
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

import anyio
import cv2
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from . import config
from .capture import test_connection
from .manager import StreamManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
)
log = logging.getLogger("worker")

manager = StreamManager()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    manager.start()
    yield
    manager.shutdown()


app = FastAPI(title="SecurityOS Detection Worker", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "cameras": manager.health()}


@app.post("/reload")
async def reload() -> dict:
    await anyio.to_thread.run_sync(manager.reload)
    return {"ok": True}


class TestRequest(BaseModel):
    rtsp_url: str
    username: str = ""
    password: str = ""


@app.post("/test")
async def test(body: TestRequest) -> dict:
    return await anyio.to_thread.run_sync(
        test_connection, body.rtsp_url, body.username, body.password
    )


@app.get("/suggest-location/{camera_id}")
async def suggest_location(camera_id: str) -> dict:
    """Guess the camera's location from what it currently sees."""
    pipeline = manager.get_pipeline(camera_id)
    data = pipeline.stream.latest_frame() if pipeline else None
    if pipeline is None or data is None:
        return {"location": None, "message": "Camera is not streaming"}
    location = await anyio.to_thread.run_sync(pipeline._suggest_room, data.frame)
    return {
        "location": location,
        "message": f"Looks like: {location}" if location
                   else "No recognizable room objects in view",
    }


def _mjpeg_generator(camera_id: str):
    """Yield the camera's latest frames as an MJPEG stream, with detection overlays."""
    last_seq = -1
    while True:
        pipeline = manager.get_pipeline(camera_id)
        if pipeline is None:
            break
        data = pipeline.stream.latest_frame()
        if data is None or data.seq == last_seq:
            time.sleep(0.05)
            continue
        last_seq = data.seq

        frame = data.frame
        if frame.shape[1] > config.PREVIEW_MAX_WIDTH:
            scale = config.PREVIEW_MAX_WIDTH / frame.shape[1]
            frame = cv2.resize(frame, (config.PREVIEW_MAX_WIDTH, int(frame.shape[0] * scale)))
        else:
            frame = frame.copy()
            scale = 1.0

        from .detectors import DEFAULT_COLOR, EVENT_COLORS

        for det in pipeline.last_detections:
            x1, y1, x2, y2 = (int(v * scale) for v in det.bbox)
            color = EVENT_COLORS.get(det.event_type, DEFAULT_COLOR)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, f"{det.label or det.event_type} {det.confidence:.0%}",
                        (x1, max(y1 - 8, 16)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, config.PREVIEW_JPEG_QUALITY])
        if not ok:
            continue
        yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
               + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg.tobytes() + b"\r\n")
        time.sleep(1.0 / 15)  # cap preview at ~15 fps


@app.get("/preview/{camera_id}")
def preview(camera_id: str):
    if manager.get_pipeline(camera_id) is None:
        return JSONResponse({"error": "Camera not streaming"}, status_code=404)
    return StreamingResponse(
        _mjpeg_generator(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


if __name__ == "__main__":
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")
