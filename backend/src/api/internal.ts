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
import { personService } from "../services/personService.js";
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

const suggestedLocationSchema = z.object({
  location: z.string().min(1).max(60),
});

/**
 * Worker offers an auto-detected location label (e.g. "Kitchen").
 * Applied only when the user has not set a location themselves.
 */
internalRouter.post("/cameras/:id/suggested-location", (req, res) => {
  const parsed = suggestedLocationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const camera = cameraService.get(req.params.id);
  if (!camera) {
    res.status(404).json({ error: "Camera not found" });
    return;
  }
  if (camera.location.trim() !== "") {
    res.json({ applied: false }); // user's own label wins
    return;
  }
  cameraService.update(camera.id, camera.siteId, { location: parsed.data.location });
  console.log(`[location] auto-set "${parsed.data.location}" for camera ${camera.name}`);
  res.json({ applied: true });
});

// -- person identity (face recognition) --------------------------------------

/** Persons registry with face embeddings, for the worker's matcher. */
internalRouter.get("/persons", (req, res) => {
  const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
  if (!siteId) {
    res.status(400).json({ error: "siteId is required" });
    return;
  }
  res.json({ persons: personService.listWithEmbeddings(siteId) });
});

const createPersonSchema = z.object({
  siteId: z.string().min(1),
  embedding: z.array(z.number()).min(8),
  facePath: z.string().nullish(),
  sharpness: z.number().optional(),
});

/** Worker enrolls a new (unlabeled) person for an unrecognized face. */
internalRouter.post("/persons", (req, res) => {
  const parsed = createPersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.status(201).json(
    personService.create(parsed.data.siteId, {
      embedding: parsed.data.embedding,
      facePath: parsed.data.facePath,
      sharpness: parsed.data.sharpness,
    }),
  );
});

const addEmbeddingSchema = z.object({
  siteId: z.string().min(1),
  embedding: z.array(z.number()).min(8),
  facePath: z.string().nullish(),
  sharpness: z.number().optional(),
});

/**
 * Worker adds another face embedding (and its photo) to a known person.
 * A richer gallery makes matching robust to blur and pose changes.
 */
internalRouter.post("/persons/:id/embeddings", (req, res) => {
  const parsed = addEmbeddingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!personService.get(req.params.id, parsed.data.siteId)) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json({
    added: personService.addEmbedding(
      req.params.id,
      parsed.data.embedding,
      parsed.data.facePath,
      parsed.data.sharpness ?? 0,
    ),
  });
});

const eventPersonsSchema = z.object({
  personIds: z.array(z.string()).min(1),
});

/** Worker links recognized persons to an open event (counts as a visit). */
internalRouter.post("/events/:id/persons", (req, res) => {
  const parsed = eventPersonsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!eventService.get(req.params.id)) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  personService.addEventPersons(req.params.id, parsed.data.personIds);
  res.json({ ok: true });
});
