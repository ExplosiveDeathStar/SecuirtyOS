/**
 * Public person routes: list identified people, rename them, mark them safe.
 */
import { Router } from "express";
import { z } from "zod";
import { eventService } from "../services/eventService.js";
import { personService } from "../services/personService.js";

export const personsRouter = Router();

personsRouter.get("/", (req, res) => {
  res.json(personService.list(req.user!.siteId));
});

personsRouter.get("/:id", (req, res) => {
  const person = personService.get(req.params.id, req.user!.siteId);
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json(person);
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  safe: z.boolean().optional(),
  /** Pick a thumbnail from the person's captured photos. */
  faceUrl: z.string().optional(),
});

/** Rename a person, toggle their safe status, and/or pick their photo. */
personsRouter.put("/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const person = personService.update(req.user!.siteId, req.params.id, parsed.data);
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json(person);
});

const mergeSchema = z.object({
  sourceId: z.string().min(1),
});

/**
 * Merge a duplicate identity into this person (`:id` is kept, `sourceId` is
 * absorbed and deleted). Use when the AI enrolled the same face twice.
 */
personsRouter.post("/:id/merge", (req, res) => {
  const parsed = mergeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const person = personService.merge(req.user!.siteId, req.params.id, parsed.data.sourceId);
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json(person);
});

/** Forget a person entirely (their event links are removed too). */
personsRouter.delete("/:id", (req, res) => {
  if (!personService.delete(req.user!.siteId, req.params.id)) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.status(204).end();
});
