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
    site_id: str
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
    faces_dir: str


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
            site_id=c["siteId"],
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
        faces_dir=body["storage"]["facesDir"],
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


def report_location_suggestion(camera_id: str, location: str) -> None:
    """Offer an auto-detected location label; backend applies it only if the
    user has not set one themselves."""
    try:
        requests.post(
            f"{config.BACKEND_URL}/internal/cameras/{camera_id}/suggested-location",
            json={"location": location},
            timeout=_TIMEOUT,
        )
    except requests.RequestException:
        log.warning("Failed to report location suggestion for camera %s", camera_id)


# -- person identity ----------------------------------------------------------

def fetch_persons(site_id: str) -> list[dict] | None:
    """Pull the persons registry (ids + face embeddings) for matching."""
    try:
        res = requests.get(
            f"{config.BACKEND_URL}/internal/persons",
            params={"siteId": site_id},
            timeout=_TIMEOUT,
        )
        res.raise_for_status()
        return res.json()["persons"]
    except requests.RequestException:
        log.warning("Failed to fetch persons registry")
        return None


def create_person(site_id: str, embedding: list[float], face_path: str | None,
                  sharpness: float = 0.0) -> dict | None:
    """Enroll a new (unlabeled) person. Returns the created person record."""
    try:
        res = requests.post(
            f"{config.BACKEND_URL}/internal/persons",
            json={"siteId": site_id, "embedding": embedding, "facePath": face_path,
                  "sharpness": sharpness},
            timeout=_TIMEOUT,
        )
        res.raise_for_status()
        return res.json()
    except requests.RequestException:
        log.exception("Failed to create person")
        return None


def add_person_embedding(site_id: str, person_id: str, embedding: list[float],
                         face_path: str | None = None,
                         sharpness: float = 0.0) -> None:
    """Persist an extra face embedding (and its photo) for a known person."""
    try:
        requests.post(
            f"{config.BACKEND_URL}/internal/persons/{person_id}/embeddings",
            json={"siteId": site_id, "embedding": embedding, "facePath": face_path,
                  "sharpness": sharpness},
            timeout=_TIMEOUT,
        )
    except requests.RequestException:
        log.warning("Failed to add embedding for person %s", person_id)


def add_event_persons(event_id: str, person_ids: list[str]) -> None:
    """Link identified persons to an open event (also counts a visit)."""
    try:
        requests.post(
            f"{config.BACKEND_URL}/internal/events/{event_id}/persons",
            json={"personIds": person_ids},
            timeout=_TIMEOUT,
        )
    except requests.RequestException:
        log.exception("Failed to attach persons to event %s", event_id)
