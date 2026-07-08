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
import { camerasRouter } from "./api/cameras.js";
import { dashboardRouter } from "./api/dashboard.js";
import { eventsRouter } from "./api/events.js";
import { internalRouter } from "./api/internal.js";
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
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "securityos-backend" }));
  app.use("/api/cameras", camerasRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/internal", internalRouter);

  // Serve snapshots and clips from the local media directory.
  app.get(/^\/media\/(.+)$/, (req, res) => {
    const resolved = storageService.resolveMediaPath((req.params as Record<string, string>)[0] ?? "");
    if (!resolved) {
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
