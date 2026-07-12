/**
 * Worker Client — the backend's only channel to the Python detection worker.
 *
 * The worker is a separate local process (localhost HTTP). This client is
 * deliberately thin: notify config changes, ask for health, test connections,
 * and proxy live-preview streams.
 */
import { config } from "../config.js";
import type { CameraHealth } from "../types.js";

const TIMEOUT_MS = 15_000;

async function workerFetch(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(`${config.workerUrl}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export const workerClient = {
  /** Tell the worker the camera registry changed; it reconciles its streams. */
  async notifyCamerasChanged(): Promise<void> {
    try {
      await workerFetch("/reload", { method: "POST" });
    } catch {
      // Worker may not be running yet; it pulls fresh config on startup anyway.
    }
  },

  /** Per-camera runtime health. Returns {} when the worker is unreachable. */
  async health(): Promise<Record<string, CameraHealth>> {
    try {
      const res = await workerFetch("/health");
      if (!res.ok) return {};
      const body = (await res.json()) as { cameras?: Record<string, CameraHealth> };
      return body.cameras ?? {};
    } catch {
      return {};
    }
  },

  /** Whether the worker process is reachable at all. */
  async isAlive(): Promise<boolean> {
    try {
      const res = await workerFetch("/health");
      return res.ok;
    } catch {
      return false;
    }
  },

  /** Ask the worker to open the stream once and report what it sees. */
  async testConnection(input: {
    rtspUrl: string;
    username?: string;
    password?: string;
  }): Promise<{ ok: boolean; message: string; width?: number; height?: number }> {
    try {
      const res = await workerFetch("/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rtsp_url: input.rtspUrl,
          username: input.username ?? "",
          password: input.password ?? "",
        }),
      });
      return (await res.json()) as { ok: boolean; message: string; width?: number; height?: number };
    } catch {
      return { ok: false, message: "Detection worker is not running — start it to test connections." };
    }
  },

  /** Ask the worker to guess a camera's location from what it sees. */
  async suggestLocation(cameraId: string): Promise<{ location: string | null; message: string }> {
    try {
      const res = await workerFetch(`/suggest-location/${cameraId}`);
      return (await res.json()) as { location: string | null; message: string };
    } catch {
      return { location: null, message: "Detection worker is not running" };
    }
  },

  /** URL of the worker's MJPEG preview for a camera (proxied by the API layer). */
  previewUrl(cameraId: string): string {
    return `${config.workerUrl}/preview/${cameraId}`;
  },
};
