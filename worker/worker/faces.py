"""Face identity: detect faces, embed them, and assign stable person IDs.

Pipeline: YuNet finds faces, SFace turns each into a 128-d embedding, and the
embedding is matched (cosine similarity) against the persons registry owned by
the backend. An unrecognized face creates a new person ("Person N") with a
face thumbnail the user can later rename or mark as safe in the UI.

Both models are small ONNX files from the OpenCV model zoo that run on CPU
alongside YOLO. They are downloaded once into the worker directory.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from dataclasses import dataclass

import cv2
import numpy as np

from . import backend_client, config

log = logging.getLogger(__name__)

_MODELS = {
    "face_detection_yunet_2023mar.onnx":
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx":
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_recognition_sface/face_recognition_sface_2021dec.onnx",
}

# Standard SFace cosine-similarity threshold for a confident "same person".
MATCH_THRESHOLD = 0.363
# Blur/angle tolerance: similarities in [PROBABLE, MATCH) still count as the
# same person — blur lowers similarity, and mis-matching slightly is far less
# harmful than minting a duplicate identity for the same face.
PROBABLE_THRESHOLD = 0.28
# A new identity is only created when the face is clearly NOT anyone known.
NEW_PERSON_MAX_SIMILARITY = 0.22
# Only enroll new identities from confident, reasonably sized, SHARP faces.
MIN_NEW_FACE_SCORE = 0.8
MIN_NEW_FACE_WIDTH = 48
MIN_SHARPNESS = 60.0            # Laplacian variance of the aligned face crop
# Grow each person's embedding gallery from confidently matched sharp faces
# that look different enough from what we already stored (new angle/lighting).
LEARN_MAX_SIMILARITY = 0.70
MAX_EMBEDDINGS_PER_PERSON = 10
# Width faces are detected at (full frames are downscaled first).
DETECT_WIDTH = 1280
# How often to re-pull the persons registry from the backend.
CACHE_TTL_SECONDS = 15.0


@dataclass
class _KnownPerson:
    person_id: str
    embeddings: list[np.ndarray]


def _sharpness(aligned_face: np.ndarray) -> float:
    """Laplacian variance — a simple, reliable blur measure (higher = sharper)."""
    gray = cv2.cvtColor(aligned_face, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


class FaceIdentifier:
    """Shared across all camera pipelines; inference is serialized by a lock."""

    def __init__(self, faces_dir: str, site_id: str):
        self._faces_dir = faces_dir
        self._site_id = site_id
        self._lock = threading.Lock()
        self._detector = None
        self._recognizer = None
        self._retry_after = 0.0
        self._persons: list[_KnownPerson] = []
        self._cache_at = 0.0

    # -- model bootstrap ------------------------------------------------------

    def _ensure_models(self) -> bool:
        if self._recognizer is not None:
            return True
        # Downloads can flake; retry with a cooldown instead of giving up.
        if time.monotonic() < self._retry_after:
            return False
        try:
            model_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            paths = {}
            for filename, url in _MODELS.items():
                path = os.path.join(model_dir, filename)
                if not os.path.exists(path):
                    log.info("Downloading face model %s ...", filename)
                    import requests
                    res = requests.get(url, timeout=300)
                    res.raise_for_status()
                    # Write to a temp file then rename, so a cut-off download
                    # never leaves a corrupt model behind.
                    tmp = f"{path}.part"
                    with open(tmp, "wb") as f:
                        f.write(res.content)
                    os.replace(tmp, path)
                paths[filename] = path
            self._detector = cv2.FaceDetectorYN.create(
                paths["face_detection_yunet_2023mar.onnx"], "", (320, 320),
                score_threshold=0.7,
            )
            self._recognizer = cv2.FaceRecognizerSF.create(
                paths["face_recognition_sface_2021dec.onnx"], "",
            )
            log.info("Face identity models ready")
            return True
        except Exception:
            log.exception("Face model setup failed; retrying in 60s")
            self._detector = None
            self._recognizer = None
            self._retry_after = time.monotonic() + 60.0
            return False

    # -- persons cache --------------------------------------------------------

    def _refresh_cache(self) -> None:
        now = time.monotonic()
        if now - self._cache_at < CACHE_TTL_SECONDS:
            return
        persons = backend_client.fetch_persons(self._site_id)
        if persons is not None:
            self._persons = [
                _KnownPerson(
                    person_id=p["id"],
                    embeddings=[np.asarray(e, dtype=np.float32).reshape(1, -1)
                                for e in p.get("embeddings", []) if e],
                )
                for p in persons
            ]
            self._cache_at = now

    # -- identification -------------------------------------------------------

    def identify(self, frame: np.ndarray) -> list[str]:
        """Return the person IDs of every face recognizable in this frame.

        Unrecognized faces are enrolled as new persons (when the face is clear
        enough) so the user can label them later.
        """
        with self._lock:
            if not self._ensure_models():
                return []
            try:
                return self._identify_locked(frame)
            except Exception:
                log.exception("Face identification failed on this frame")
                return []

    def _identify_locked(self, frame: np.ndarray) -> list[str]:
        self._refresh_cache()

        scale = 1.0
        small = frame
        if frame.shape[1] > DETECT_WIDTH:
            scale = DETECT_WIDTH / frame.shape[1]
            small = cv2.resize(frame, (DETECT_WIDTH, int(frame.shape[0] * scale)))

        self._detector.setInputSize((small.shape[1], small.shape[0]))
        _, faces = self._detector.detect(small)
        if faces is None:
            return []

        person_ids: list[str] = []
        for face in faces:
            aligned = self._recognizer.alignCrop(small, face)
            embedding = self._recognizer.feature(aligned)
            sharp = _sharpness(aligned)
            person, best_sim = self._best_match(embedding)

            # Confident match: also grow this person's embedding gallery from
            # sharp faces that look different enough (new angle/lighting), so
            # future blurry frames still land above the threshold.
            if person is not None and best_sim >= MATCH_THRESHOLD:
                person_ids.append(person.person_id)
                if (sharp >= MIN_SHARPNESS and best_sim < LEARN_MAX_SIMILARITY
                        and len(person.embeddings) < MAX_EMBEDDINGS_PER_PERSON):
                    self._learn(person, embedding, frame, face, scale, sharp)
                continue

            # Probable match (blurry/angled face): count the sighting for the
            # closest known person instead of inventing a duplicate identity.
            if person is not None and best_sim >= PROBABLE_THRESHOLD:
                person_ids.append(person.person_id)
                continue

            # Genuinely unknown. Only mint a new identity from a confident,
            # large, SHARP face that is dissimilar to everyone we know —
            # otherwise wait for a better frame.
            score = float(face[-1])
            width = float(face[2])
            if (score < MIN_NEW_FACE_SCORE or width < MIN_NEW_FACE_WIDTH
                    or sharp < MIN_SHARPNESS
                    or best_sim >= NEW_PERSON_MAX_SIMILARITY):
                continue

            new_id = self._enroll(frame, face, scale, embedding, sharp)
            if new_id:
                person_ids.append(new_id)
        return person_ids

    def _best_match(self, embedding: np.ndarray) -> tuple[_KnownPerson | None, float]:
        """Closest known person and the best cosine similarity to them."""
        best_person, best_sim = None, -1.0
        for person in self._persons:
            for known in person.embeddings:
                sim = float(self._recognizer.match(
                    embedding, known, cv2.FaceRecognizerSF_FR_COSINE
                ))
                if sim > best_sim:
                    best_person, best_sim = person, sim
        return best_person, best_sim

    def _learn(self, person: _KnownPerson, embedding: np.ndarray,
               frame: np.ndarray, face: np.ndarray, scale: float,
               sharpness: float) -> None:
        """Add a new embedding + face photo to a known person
        (local cache + backend)."""
        person.embeddings.append(embedding)
        face_path = self._save_face_crop(frame, face, scale)
        backend_client.add_person_embedding(
            self._site_id, person.person_id, embedding.flatten().tolist(),
            face_path, sharpness
        )
        log.info("Learned new face angle for person %s (%d embeddings)",
                 person.person_id, len(person.embeddings))

    def _enroll(self, frame: np.ndarray, face: np.ndarray, scale: float,
                embedding: np.ndarray, sharpness: float) -> str | None:
        face_path = self._save_face_crop(frame, face, scale)
        person = backend_client.create_person(
            site_id=self._site_id, embedding=embedding.flatten().tolist(),
            face_path=face_path,
            sharpness=sharpness,
        )
        if person is None:
            return None
        # Add to the local cache immediately so the same face in the next
        # frame does not create a duplicate identity.
        self._persons.append(_KnownPerson(person_id=person["id"],
                                          embeddings=[embedding]))
        log.info("Enrolled new person %s (%s)", person.get("name"), person["id"])
        return person["id"]

    def _save_face_crop(self, frame: np.ndarray, face: np.ndarray,
                        scale: float) -> str | None:
        """Save the face photo from the ORIGINAL full-resolution frame.

        `face` is in downscaled-detection coordinates; dividing by `scale`
        maps it back to the full frame, so crops keep every pixel the camera
        captured instead of a blurry half-resolution copy.
        """
        try:
            os.makedirs(self._faces_dir, exist_ok=True)
            inv = 1.0 / scale
            x, y, w, h = (int(v * inv) for v in face[:4])
            # Pad the crop so the thumbnail shows the whole head.
            pad_x, pad_y = int(w * 0.3), int(h * 0.4)
            x1, y1 = max(x - pad_x, 0), max(y - pad_y, 0)
            x2 = min(x + w + pad_x, frame.shape[1])
            y2 = min(y + h + pad_y, frame.shape[0])
            crop = frame[y1:y2, x1:x2]
            if crop.size == 0:
                return None
            filename = f"{uuid.uuid4().hex}.jpg"
            cv2.imwrite(os.path.join(self._faces_dir, filename), crop,
                        [cv2.IMWRITE_JPEG_QUALITY, 95])
            return f"faces/{filename}"
        except Exception:
            log.exception("Failed to save face crop")
            return None
