/**
 * SQLite database bootstrap and migrations.
 *
 * SQLite keeps Phase 1 simple and fully local. The schema is written so that
 * future modules (vehicle detection, face recognition, LPR, ...) plug in by
 * adding new `events.type` values and satellite tables — no rewrites needed.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import { config } from "../config.js";

let db: Database.Database | null = null;

const MIGRATIONS: string[] = [
  // 001 — initial schema
  `
  CREATE TABLE IF NOT EXISTS cameras (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    location     TEXT NOT NULL DEFAULT '',
    rtsp_url     TEXT NOT NULL,
    username     TEXT NOT NULL DEFAULT '',
    password_enc TEXT NOT NULL DEFAULT '',
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id            TEXT PRIMARY KEY,
    camera_id     TEXT NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    type          TEXT NOT NULL DEFAULT 'person',
    status        TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'completed'
    started_at    TEXT NOT NULL,
    ended_at      TEXT,
    duration_s    REAL,
    confidence    REAL NOT NULL DEFAULT 0,
    snapshot_path TEXT,
    clip_path     TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}'        -- JSON bag for future modules
  );

  CREATE INDEX IF NOT EXISTS idx_events_started_at ON events(started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_camera ON events(camera_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
  `,
];

/** Open (and migrate) the database. Safe to call repeatedly. */
export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare(`SELECT id FROM _migrations`).all() as { id: number }[]).map((r) => r.id),
  );
  MIGRATIONS.forEach((sql, i) => {
    const id = i + 1;
    if (applied.has(id)) return;
    db!.exec(sql);
    db!.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`).run(id, new Date().toISOString());
  });

  return db;
}
