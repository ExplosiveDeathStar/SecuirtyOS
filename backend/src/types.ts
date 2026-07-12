/**
 * Shared domain types for the SecurityOS backend.
 */

/**
 * How important a camera's location is. "high" = close to home
 * (front door, backyard); "low" = far/public (street view).
 */
export type CameraSensitivity = "low" | "medium" | "high";

export type SubscriptionPlan = "monthly" | "yearly";
export type UserRole = "owner" | "admin" | "customer";
export type BillingStatus = "incomplete" | "active" | "past_due" | "canceled";

export interface User {
  id: string;
  email: string;
  siteId: string;
  plan: SubscriptionPlan;
  role: UserRole;
  billingStatus: BillingStatus;
  currentPeriodEnd: string | null;
  createdAt: string;
}

/** A configured camera. `password` is never stored or returned in plaintext via the public API. */
export interface Camera {
  id: string;
  siteId: string;
  name: string;
  location: string;
  rtspUrl: string;
  username: string;
  /** Whether a password is set (plaintext never exposed publicly). */
  hasPassword: boolean;
  enabled: boolean;
  sensitivity: CameraSensitivity;
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

/** A person identified by face recognition, with objective sighting stats. */
export interface Person {
  id: string;
  name: string;
  safe: boolean;
  /** True once the user has renamed them (no longer "Person N"). */
  labeled: boolean;
  faceUrl: string | null;
  /** All captured face photos (the thumbnail is picked from these). */
  faceUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  visitsLast7d: number;
  visitsToday: number;
}

/** Minimal person info embedded in events, with sighting frequency. */
export interface EventPerson {
  id: string;
  name: string;
  safe: boolean;
  labeled: boolean;
  faceUrl: string | null;
  visitCount: number;
  visitsLast7d: number;
}

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
  /** Persons recognized during this event (person events only). */
  persons: EventPerson[];
}

/** Per-camera runtime health, as reported by the detection worker. */
export interface CameraHealth {
  status: "online" | "offline" | "connecting" | "disabled" | "unknown";
  fps: number;
  lastFrameAt: string | null;
  activeEvent: boolean;
  error: string | null;
}
