/**
 * API types shared across the UI (mirrors backend/src/types.ts).
 */

export interface Camera {
  id: string;
  name: string;
  location: string;
  rtspUrl: string;
  username: string;
  hasPassword: boolean;
  enabled: boolean;
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
