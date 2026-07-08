# SecurityOS

**The AI intelligence layer for physical security.**

SecurityOS is not a camera company and not an NVR. It sits on top of your
existing IP cameras and answers one question: **"What happened?"** — without
you ever watching hours of footage.

> Front Door · 2:14 AM · Person detected · Stayed 41 seconds · Confidence 98% · [View clip]

**Phase 1 (this milestone):** AI person detection + event timeline, running
100% locally.

---

## What it does

- **Connect existing IP cameras** (RTSP). Add, edit, delete, test connection,
  live preview. Credentials are AES-256-GCM encrypted with a local key.
- **Real-time detection** of people, animals, and vehicles on every camera
  with YOLO11 (configurable via `SECURITYOS_DETECT_TYPES`). Live previews show
  color-coded bounding boxes and labels drawn on the video. Trees, shadows,
  rain, and lighting changes are ignored by construction — YOLO only fires on
  actual object geometry.
- **Event timeline.** Each appearance becomes one event with camera,
  timestamp, peak confidence, snapshot, duration, and a recorded H.264 clip
  that plays in the browser.
- **Dashboard.** Live camera grid, detections today, active detections right
  now, camera health (online/offline/fps), recent events.
- **Private by design.** Everything runs on your machine. No cloud AI, no
  third-party image processing. The API binds to `127.0.0.1` only.

## Architecture

```
┌────────────────┐     ┌─────────────────────┐     ┌──────────────────────────┐
│  Next.js UI    │────▶│  Node.js backend    │◀────│  Python detection worker │
│  (port 3000)   │     │  API layer          │     │  (port 8001)             │
│                │     │  (port 4000)        │     │                          │
│  Dashboard     │     │  Camera Service     │     │  Camera capture (OpenCV) │
│  Timeline      │     │  Event Service      │     │  Detection (YOLO11)      │
│  Cameras       │     │  Storage Service    │     │  Event tracking          │
└────────────────┘     │  SQLite + media     │     │  Clips + MJPEG preview   │
                       └─────────────────────┘     └──────────────────────────┘
                                 │                            │
                                 └────────── data/ ───────────┘
                                   securityos.db, media/, secret.key
```

- **`backend/`** — Express + SQLite (better-sqlite3). Owns the camera
  registry, encrypted credentials, the event store, and media serving. The
  worker talks to it over a localhost-only `/internal` API.
- **`worker/`** — Python. One capture thread + one detection pipeline per
  camera. Turns raw detections into open/close events, writes snapshots and
  H.264 clips (bundled ffmpeg), serves MJPEG live previews.
- **`frontend/`** — Next.js + Tailwind. Proxies `/api/*` and `/media/*` to
  the backend, so the browser never leaves localhost.

### Built to extend

Future modules (vehicle detection, face recognition, LPR, package detection,
loitering, threat scoring, natural-language search, ...) plug in without
rewrites:

- **Worker:** implement the `Detector` interface (`worker/worker/detectors.py`)
  and register it in `StreamManager._get_detectors()`.
- **Data:** events are generic — `events.type` + a JSON `metadata` column.
- **API/UI:** the timeline, dashboard, and event services are
  detector-agnostic.

## Getting started

Prerequisites: Node.js 20+, Python 3.10+.

```bash
# 1. Install
npm --prefix backend install
npm --prefix frontend install
python3 -m venv worker/.venv
worker/.venv/bin/pip install -r worker/requirements.txt

# 2. Run everything in the background
./scripts/start.sh                    # UI on http://localhost:3000
./scripts/stop.sh                     # stop all services (data is kept)

# ...or run each service in its own terminal during development:
cd backend  && npm run dev            # API on http://127.0.0.1:4000
cd worker   && .venv/bin/python -m worker.main   # detection worker on :8001
cd frontend && npm run dev            # UI on http://localhost:3000
```

Open http://localhost:3000, go to **Cameras → Add camera**, and enter your
camera's RTSP URL (e.g. `rtsp://192.168.1.20:554/stream1`) plus credentials.
Use **Test connection** to verify, then watch the dashboard.

The YOLO11 model (~5 MB) downloads automatically on first run. For offline
setups, place `yolo11n.pt` in `worker/` beforehand.

### Camera sources

The source field accepts more than RTSP:

| Source | Meaning |
| --- | --- |
| `rtsp://host:554/stream1` | Real IP camera |
| `webcam://0` | Local webcam (0 = built-in camera) |
| `screen://1` | Live capture of monitor 1 (your primary display) |
| `/path/to/video.mp4` | Video file, looped like a live stream (demos/tests) |

On macOS, webcam and screen sources require the terminal running the worker
to have **Camera** / **Screen Recording** permission (System Settings →
Privacy & Security). macOS prompts automatically on first use; restart the
worker after granting.

## Configuration

Everything has sensible defaults; override via environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECURITYOS_PORT` | `4000` | Backend API port |
| `SECURITYOS_DATA_DIR` | `./data` | Database, media, encryption key |
| `SECURITYOS_MODEL` | `yolo11n.pt` | YOLO model (use `yolo11s/m` with a GPU) |
| `SECURITYOS_CONFIDENCE` | `0.5` | Min confidence for a person detection |
| `SECURITYOS_EVENT_LINGER` | `5` | Seconds without a person before an event closes |
| `SECURITYOS_EVENT_MAX` | `300` | Max seconds per event/clip |
| `SECURITYOS_PIPELINE_FPS` | `10` | Frames/second processed per camera |

## Repository layout

```
backend/    Node.js API layer (camera/event/storage services, SQLite, crypto)
worker/     Python detection worker (capture, YOLO, events, clips, previews)
frontend/   Next.js UI (dashboard, timeline, camera management)
data/       Runtime data — created on first launch, never leaves the machine
```

## Security model

- API and worker bind to `127.0.0.1` only.
- Camera passwords are encrypted at rest (AES-256-GCM); the key lives in
  `data/secret.key` (owner-only permissions) and plaintext credentials are
  only ever handed to the local worker process.
- Video frames, snapshots, and clips are stored on the local filesystem and
  served only through the local API.
