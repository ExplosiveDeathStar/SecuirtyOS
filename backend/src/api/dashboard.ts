/**
 * Dashboard route — one call aggregates everything the dashboard needs:
 * cameras + health, detection stats, recent and active events.
 */
import { Router } from "express";
import { cameraService } from "../services/cameraService.js";
import { eventService } from "../services/eventService.js";
import { notificationService } from "../services/notificationService.js";
import { workerClient } from "../services/workerClient.js";
import type { CameraHealth } from "../types.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  const siteId = req.user!.siteId;
  const cameras = cameraService.list(siteId);
  const [health, workerAlive] = await Promise.all([workerClient.health(), workerClient.isAlive()]);

  const fallback = (enabled: boolean): CameraHealth => ({
    status: !enabled ? "disabled" : workerAlive ? "connecting" : "unknown",
    fps: 0,
    lastFrameAt: null,
    activeEvent: false,
    error: workerAlive ? null : "Detection worker offline",
  });

  res.json({
    workerAlive,
    stats: eventService.stats(siteId),
    cameras: cameras.map((camera) => ({
      ...camera,
      health: health[camera.id] ?? fallback(camera.enabled),
    })),
    activeEvents: eventService.list({ siteId, status: "active", limit: 20 }),
    recentEvents: eventService.list({ siteId, status: "completed", limit: 10 }),
  });
});

/** Send a test desktop notification so users can verify the channel works. */
dashboardRouter.post("/test-notification", async (_req, res) => {
  await notificationService.send({
    title: "SecurityOS — Test notification",
    body: "Notifications are working. You'll be alerted when something is detected.",
  });
  res.json({ ok: true });
});
