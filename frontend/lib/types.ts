/**
 * API types shared across the UI (mirrors backend/src/types.ts).
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

export interface Camera {
  id: string;
  siteId: string;
  name: string;
  location: string;
  rtspUrl: string;
  username: string;
  hasPassword: boolean;
  enabled: boolean;
  sensitivity: CameraSensitivity;
  createdAt: string;
  updatedAt: string;
}

export interface CameraHealth {
  status: "online" | "offline" | "connecting" | "disabled" | "unknown";
  fps: number;
  lastFrameAt: string | null;
  activeEvent: boolean;
  error: string | null;
}

export interface CameraWithHealth extends Camera {
  health: CameraHealth;
}

export interface Person {
  id: string;
  name: string;
  safe: boolean;
  labeled: boolean;
  faceUrl: string | null;
  /** All captured face photos (thumbnail is picked from these). */
  faceUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  visitsLast7d: number;
  visitsToday: number;
}

export interface EventPerson {
  id: string;
  name: string;
  safe: boolean;
  labeled: boolean;
  faceUrl: string | null;
  visitCount: number;
  visitsLast7d: number;
}

export interface SecurityEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  cameraLocation: string;
  type: string;
  status: "active" | "completed";
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  confidence: number;
  snapshotUrl: string | null;
  clipUrl: string | null;
  metadata: Record<string, unknown>;
  persons: EventPerson[];
}

export interface DashboardData {
  workerAlive: boolean;
  stats: { today: number; activeNow: number; total: number };
  cameras: CameraWithHealth[];
  activeEvents: SecurityEvent[];
  recentEvents: SecurityEvent[];
}

export interface TestResult {
  ok: boolean;
  message: string;
  width?: number;
  height?: number;
}
