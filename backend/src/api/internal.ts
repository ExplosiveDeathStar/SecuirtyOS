/**
 * Internal routes — consumed ONLY by the local Python detection worker.
 *
 * The whole API is bound to 127.0.0.1, and these routes are the single place
 * where decrypted camera credentials are handed over (to build RTSP URLs).
 * They are never used by the frontend.
 */
import { Router } from "express";
import { z } from "zod";
import { cameraService } from "../services/cameraService.js";
import { eventService } from "../services/eventService.js";
import { notificationService } from "../services/notificationService.js";
import { storageService } from "../services/storageService.js";
import type { EventType } from "../types.js";

export const internalRouter = Router();

/** Full camera list with decrypted credentials + media directory layout. */
internalRouter.get("/cameras", (_req, res) => {
  res.json({
    cameras: cameraService.listWithSecrets(),
    storage: storageService.mediaConfig(),
  });
});

const openSchema = z.object({
  cameraId: z.string(),
  type: z.string().default("person"),
  startedAt: z.string(),
  confidence: z.number(),
  snapshotPath: z.string().optional(),
});

/** Worker reports a detection started. Returns the event id. */
internalRouter.post("/events/open", (req, res) => {
  const parsed = openSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!cameraService.get(parsed.data.cameraId)) {
    res.status(404).json({ error: "Unknown camera" });
    return;
  }
  const event = eventService.open({ ...parsed.data, type: parsed.data.type as EventType });
  void notificationService.notifyEventOpened(event); // fire-and-forget; never block the worker
  res.status(201).json(event);
});

const updateSchema = z.object({
  confidence: z.number().optional(),
  snapshotPath: z.string().optional(),
});

/** Worker refreshes an in-flight event (higher confidence, better snapshot). */
internalRouter.post("/events/:id/update", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const event = eventService.update(req.params.id, parsed.data);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
});

const closeSchema = z.object({
  endedAt: z.string(),
  durationS: z.number(),
  confidence: z.number(),
  clipPath: z.string().optional(),
});

/** Worker reports the detection ended. */
internalRouter.post("/events/:id/close", (req, res) => {
  const parsed = closeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const event = eventService.close(req.params.id, parsed.data);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
});
