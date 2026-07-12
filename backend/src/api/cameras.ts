/**
 * Public camera routes: CRUD, connection testing, and live preview proxy.
 */
import { Router } from "express";
import { Readable } from "node:stream";
import { z } from "zod";
import { cameraService } from "../services/cameraService.js";
import { workerClient } from "../services/workerClient.js";

const cameraSchema = z.object({
  name: z.string().min(1, "Name is required"),
  location: z.string().optional(),
  rtspUrl: z.string().min(1, "RTSP URL is required"),
  username: z.string().optional(),
  password: z.string().optional(),
  enabled: z.boolean().optional(),
  sensitivity: z.enum(["low", "medium", "high"]).optional(),
});

export const camerasRouter = Router();

camerasRouter.get("/", (req, res) => {
  res.json(cameraService.list(req.user!.siteId));
});

camerasRouter.post("/", async (req, res) => {
  const parsed = cameraSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const camera = cameraService.create(req.user!.siteId, parsed.data);
  await workerClient.notifyCamerasChanged();
  res.status(201).json(camera);
});

camerasRouter.get("/:id", (req, res) => {
  const camera = cameraService.get(req.params.id, req.user!.siteId);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  res.json(camera);
});

camerasRouter.put("/:id", async (req, res) => {
  const parsed = cameraSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const camera = cameraService.update(req.params.id, req.user!.siteId, parsed.data);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  await workerClient.notifyCamerasChanged();
  res.json(camera);
});

camerasRouter.delete("/:id", async (req, res) => {
  const deleted = cameraService.delete(req.params.id, req.user!.siteId);
  if (!deleted) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  await workerClient.notifyCamerasChanged();
  res.status(204).end();
});

/**
 * Test a connection. Works for saved cameras (POST /:id/test) or ad-hoc
 * settings from the add-camera form (POST /test with body).
 */
camerasRouter.post("/test", async (req, res) => {
  const parsed = cameraSchema.pick({ rtspUrl: true, username: true, password: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "rtspUrl is required" });
    return;
  }
  res.json(await workerClient.testConnection(parsed.data));
});

camerasRouter.post("/:id/test", async (req, res) => {
  const camera = cameraService.listWithSecrets(req.user!.siteId).find((c) => c.id === req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  res.json(
    await workerClient.testConnection({
      rtspUrl: camera.rtspUrl,
      username: camera.username,
      password: camera.password,
    }),
  );
});

/** Ask the AI what room/area this camera appears to be watching. */
camerasRouter.post("/:id/suggest-location", async (req, res) => {
  if (!cameraService.get(req.params.id, req.user!.siteId)) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  res.json(await workerClient.suggestLocation(req.params.id));
});

/** Live preview: proxy the worker's MJPEG stream so the browser only ever talks to this API. */
camerasRouter.get("/:id/preview", async (req, res) => {
  try {
    // No timeout here: MJPEG is a long-lived stream. It ends when the browser disconnects.
    const upstream = await fetch(workerClient.previewUrl(req.params.id), { signal: abortOnClose(req) });
    if (!upstream.ok || !upstream.body) {
      res.status(502).json({ error: "Preview unavailable" });
      return;
    }
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "multipart/x-mixed-replace");
    res.setHeader("Cache-Control", "no-store");
    const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    // The abort on client disconnect surfaces as a stream error; end quietly.
    stream.on("error", () => res.end());
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).json({ error: "Detection worker is not running" });
  }
});

/** Abort upstream fetch when the browser disconnects, so worker streams don't leak. */
function abortOnClose(req: import("express").Request): AbortSignal {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  return controller.signal;
}
