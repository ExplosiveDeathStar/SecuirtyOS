/**
 * SecurityOS backend entry point.
 *
 * Layers:
 *   API (express routes) -> Services (camera/event/storage/worker) -> SQLite + filesystem
 *
 * Bound to 127.0.0.1 only: credentials, events, and video never leave the machine.
 */
import cors from "cors";
import express from "express";
import { authRouter, requireAuth, requirePaidAccess } from "./api/auth.js";
import { billingRouter, billingWebhookRouter } from "./api/billing.js";
import { camerasRouter } from "./api/cameras.js";
import { dashboardRouter } from "./api/dashboard.js";
import { eventsRouter } from "./api/events.js";
import { internalRouter } from "./api/internal.js";
import { personsRouter } from "./api/persons.js";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { eventService } from "./services/eventService.js";
import { storageService } from "./services/storageService.js";

function main(): void {
  storageService.ensureDirectories();
  getDb();

  // Clean up events stranded by an unclean worker shutdown.
  const stale = eventService.closeStaleActive();
  if (stale > 0) console.log(`[startup] closed ${stale} stale active event(s)`);

  const app = express();
  app.use(cors({ origin: true }));
  app.use("/api/billing", billingWebhookRouter);
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "securityos-backend" }));
  app.use("/api/auth", authRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/cameras", requireAuth, requirePaidAccess, camerasRouter);
  app.use("/api/events", requireAuth, requirePaidAccess, eventsRouter);
  app.use("/api/persons", requireAuth, requirePaidAccess, personsRouter);
  app.use("/api/dashboard", requireAuth, requirePaidAccess, dashboardRouter);
  app.use("/internal", internalRouter);

  // Serve snapshots and clips from the local media directory.
  app.get(/^\/media\/(.+)$/, requireAuth, requirePaidAccess, (req, res) => {
    const relativePath = (req.params as Record<string, string>)[0] ?? "";
    const resolved = storageService.resolveMediaPath(relativePath);
    if (!resolved || !storageService.canAccessMedia(req.user!.siteId, relativePath)) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    res.sendFile(resolved);
  });

  app.listen(config.port, config.host, () => {
    console.log(`SecurityOS backend listening on http://${config.host}:${config.port}`);
    console.log(`Data directory: ${config.dataDir}`);
  });
}

main();
