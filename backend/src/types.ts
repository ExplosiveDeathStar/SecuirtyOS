/**
 * Shared domain types for the SecurityOS backend.
 */

/** A configured camera. `password` is never stored or returned in plaintext via the public API. */
export interface Camera {
  id: string;
  name: string;
  location: string;
  rtspUrl: string;
  username: string;
  /** Whether a password is set (plaintext never exposed publicly). */
  hasPassword: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Camera record including decrypted credentials — internal (worker) use only. */
export interface CameraWithSecrets extends Camera {
  password: string;
}

/** Event types emitted today plus reserved values for future modules. */
export type EventType =
  | "person"
  | "animal"
  | "vehicle"
  | "face"
  | "license_plate"
  | "package"
  | "loitering";

export type EventStatus = "active" | "completed";

/** A detection event on the timeline. */
export interface SecurityEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  cameraLocation: string;
  type: EventType;
  status: EventStatus;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  confidence: number;
  snapshotUrl: string | null;
  clipUrl: string | null;
  metadata: Record<string, unknown>;
}

/** Per-camera runtime health, as reported by the detection worker. */
export interface CameraHealth {
  status: "online" | "offline" | "connecting" | "disabled" | "unknown";
  fps: number;
  lastFrameAt: string | null;
  activeEvent: boolean;
  error: string | null;
}
