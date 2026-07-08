"""HTTP client for the backend's internal (localhost-only) API.

This is the worker's single integration point with the rest of the system:
fetch camera config, open/update/close events.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import requests

from . import config

log = logging.getLogger(__name__)

_TIMEOUT = 10


@dataclass
class CameraConfig:
    """A camera as configured by the user (credentials already decrypted)."""

    id: str
    name: str
    location: str
    rtsp_url: str
    username: str
    password: str
    enabled: bool


@dataclass
class StorageConfig:
    """Where the backend expects media to be written."""

    media_dir: str
    snapshots_dir: str
    clips_dir: str


@dataclass
class BackendState:
    cameras: list[CameraConfig] = field(default_factory=list)
    storage: StorageConfig | None = None


def fetch_state() -> BackendState:
    """Pull the camera registry and storage layout from the backend."""
    res = requests.get(f"{config.BACKEND_URL}/internal/cameras", timeout=_TIMEOUT)
    res.raise_for_status()
    body = res.json()
    cameras = [
        CameraConfig(
            id=c["id"],
            name=c["name"],
            location=c.get("location", ""),
            rtsp_url=c["rtspUrl"],
            username=c.get("username", ""),
            password=c.get("password", ""),
            enabled=bool(c.get("enabled", True)),
        )
        for c in body["cameras"]
    ]
    storage = StorageConfig(
        media_dir=body["storage"]["mediaDir"],
        snapshots_dir=body["storage"]["snapshotsDir"],
        clips_dir=body["storage"]["clipsDir"],
    )
    return BackendState(cameras=cameras, storage=storage)


def open_event(camera_id: str, event_type: str, started_at: str, confidence: float,
               snapshot_path: str | None) -> str | None:
    """Report a new detection event. Returns the backend event id."""
    try:
        res = requests.post(
            f"{config.BACKEND_URL}/internal/events/open",
            json={
                "cameraId": camera_id,
                "type": event_type,
                "startedAt": started_at,
                "confidence": confidence,
                "snapshotPath": snapshot_path,
            },
            timeout=_TIMEOUT,
        )
        res.raise_for_status()
        return res.json()["id"]
    except requests.RequestException:
        log.exception("Failed to open event for camera %s", camera_id)
        return None


def update_event(event_id: str, confidence: float | None = None,
                 snapshot_path: str | None = None) -> None:
    """Refresh an in-flight event (rising confidence / better snapshot)."""
    payload: dict[str, Any] = {}
    if confidence is not None:
        payload["confidence"] = confidence
    if snapshot_path is not None:
        payload["snapshotPath"] = snapshot_path
    if not payload:
        return
    try:
        requests.post(f"{config.BACKEND_URL}/internal/events/{event_id}/update",
                      json=payload, timeout=_TIMEOUT)
    except requests.RequestException:
        log.exception("Failed to update event %s", event_id)


def close_event(event_id: str, ended_at: str, duration_s: float, confidence: float,
                clip_path: str | None) -> None:
    """Report that a detection event has ended."""
    try:
        requests.post(
            f"{config.BACKEND_URL}/internal/events/{event_id}/close",
            json={
                "endedAt": ended_at,
                "durationS": duration_s,
                "confidence": confidence,
                "clipPath": clip_path,
            },
            timeout=_TIMEOUT,
        )
    except requests.RequestException:
        log.exception("Failed to close event %s", event_id)
