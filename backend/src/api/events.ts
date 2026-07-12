/**
 * Public event routes — the timeline API.
 */
import { Router } from "express";
import { eventService } from "../services/eventService.js";

export const eventsRouter = Router();

eventsRouter.get("/", (req, res) => {
  const { cameraId, personId, type, status, from, to, limit, offset } = req.query;
  res.json(
    eventService.list({
      siteId: req.user!.siteId,
      cameraId: typeof cameraId === "string" ? cameraId : undefined,
      personId: typeof personId === "string" ? personId : undefined,
      type: typeof type === "string" ? type : undefined,
      status: status === "active" || status === "completed" ? status : undefined,
      from: typeof from === "string" ? from : undefined,
      to: typeof to === "string" ? to : undefined,
      limit: limit ? Math.min(Number(limit), 500) : undefined,
      offset: offset ? Number(offset) : undefined,
    }),
  );
});

eventsRouter.get("/:id", (req, res) => {
  const event = eventService.get(req.params.id, req.user!.siteId);
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
});
