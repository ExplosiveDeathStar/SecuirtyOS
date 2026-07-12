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

  // 002 — person identity (face recognition) + camera sensitivity
  `
  CREATE TABLE IF NOT EXISTS persons (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    safe          INTEGER NOT NULL DEFAULT 0,   -- user marked as trusted
    labeled       INTEGER NOT NULL DEFAULT 0,   -- user gave them a real name
    embeddings    TEXT NOT NULL DEFAULT '[]',   -- JSON list of face embeddings
    face_path     TEXT,                          -- thumbnail in media/faces/
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_persons (
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, person_id)
  );

  CREATE INDEX IF NOT EXISTS idx_event_persons_person ON event_persons(person_id);

  ALTER TABLE cameras ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'medium';
  `,

  // 003 — face photo gallery per person (thumbnail is picked from these)
  `
  ALTER TABLE persons ADD COLUMN face_paths TEXT NOT NULL DEFAULT '[]';
  UPDATE persons
  SET face_paths = json_array(face_path)
  WHERE face_path IS NOT NULL AND face_paths = '[]';
  `,

  // 004 — auto-upgrade thumbnails to the sharpest captured photo
  `
  ALTER TABLE persons ADD COLUMN thumb_sharpness REAL NOT NULL DEFAULT 0;
  ALTER TABLE persons ADD COLUMN thumb_user_set INTEGER NOT NULL DEFAULT 0;
  `,

  // 005 — commercial auth: users, selected subscription plan, and sessions
  `
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    email          TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    plan           TEXT NOT NULL CHECK (plan IN ('monthly', 'yearly')),
    billing_status TEXT NOT NULL DEFAULT 'trialing',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `,

  // 006 — roles and Stripe subscription state
  `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer';
  ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
  ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
  ALTER TABLE users ADD COLUMN current_period_end TEXT;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_stripe_customer
    ON users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

  UPDATE users
  SET role = 'owner', billing_status = 'active'
  WHERE lower(email) = 'ryan@loancater.com';
  `,

  // 007 — tenant/site isolation for commercial multi-customer use
  `
  CREATE TABLE IF NOT EXISTS sites (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  INSERT OR IGNORE INTO sites (id, name, created_by, created_at)
  VALUES ('legacy-site', 'Ryan Home', NULL, datetime('now'));

  ALTER TABLE users ADD COLUMN site_id TEXT;
  ALTER TABLE cameras ADD COLUMN site_id TEXT;
  ALTER TABLE persons ADD COLUMN site_id TEXT;

  UPDATE users SET site_id = 'legacy-site' WHERE site_id IS NULL;
  UPDATE cameras SET site_id = 'legacy-site' WHERE site_id IS NULL;
  UPDATE persons SET site_id = 'legacy-site' WHERE site_id IS NULL;

  CREATE INDEX IF NOT EXISTS idx_users_site ON users(site_id);
  CREATE INDEX IF NOT EXISTS idx_cameras_site ON cameras(site_id);
  CREATE INDEX IF NOT EXISTS idx_persons_site ON persons(site_id);
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
