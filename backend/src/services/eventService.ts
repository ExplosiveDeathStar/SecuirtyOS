/**
 * Event Service — owns the detection event timeline.
 *
 * The worker opens an event when a detection begins and closes it when the
 * subject leaves. Events are generic (`type` + JSON `metadata`) so future
 * detectors (vehicle, face, package, ...) reuse this service unchanged.
 */
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import type { EventStatus, EventType, SecurityEvent } from "../types.js";

interface EventRow {
  id: string;
  camera_id: string;
  camera_name: string;
  camera_location: string;
  type: EventType;
  status: EventStatus;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  confidence: number;
  snapshot_path: string | null;
  clip_path: string | null;
  metadata: string;
}

const SELECT = `
  SELECT e.*, c.name AS camera_name, c.location AS camera_location
  FROM events e JOIN cameras c ON c.id = e.camera_id
`;

function toEvent(row: EventRow): SecurityEvent {
  return {
    id: row.id,
    cameraId: row.camera_id,
    cameraName: row.camera_name,
    cameraLocation: row.camera_location,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationS: row.duration_s,
    confidence: row.confidence,
    snapshotUrl: row.snapshot_path ? `/media/${row.snapshot_path}` : null,
    clipUrl: row.clip_path ? `/media/${row.clip_path}` : null,
    metadata: JSON.parse(row.metadata || "{}"),
  };
}

export interface EventQuery {
  cameraId?: string;
  type?: string;
  status?: EventStatus;
  /** ISO date bounds on started_at. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const eventService = {
  list(query: EventQuery = {}): SecurityEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (query.cameraId) { clauses.push("e.camera_id = ?"); params.push(query.cameraId); }
    if (query.type) { clauses.push("e.type = ?"); params.push(query.type); }
    if (query.status) { clauses.push("e.status = ?"); params.push(query.status); }
    if (query.from) { clauses.push("e.started_at >= ?"); params.push(query.from); }
    if (query.to) { clauses.push("e.started_at <= ?"); params.push(query.to); }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = getDb()
      .prepare(`${SELECT} ${where} ORDER BY e.started_at DESC LIMIT ? OFFSET ?`)
      .all(...params, query.limit ?? 100, query.offset ?? 0) as EventRow[];
    return rows.map(toEvent);
  },

  get(id: string): SecurityEvent | null {
    const row = getDb().prepare(`${SELECT} WHERE e.id = ?`).get(id) as EventRow | undefined;
    return row ? toEvent(row) : null;
  },

  /** Open a new active event (called by the worker when a detection starts). */
  open(input: {
    cameraId: string;
    type: EventType;
    startedAt: string;
    confidence: number;
    snapshotPath?: string;
  }): SecurityEvent {
    const id = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO events (id, camera_id, type, status, started_at, confidence, snapshot_path)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(id, input.cameraId, input.type, input.startedAt, input.confidence, input.snapshotPath ?? null);
    return this.get(id)!;
  },

  /** Update an in-flight event (better snapshot, rising confidence). */
  update(
    id: string,
    input: { confidence?: number; snapshotPath?: string },
  ): SecurityEvent | null {
    const existing = this.get(id);
    if (!existing) return null;
    getDb()
      .prepare(`UPDATE events SET confidence = ?, snapshot_path = COALESCE(?, snapshot_path) WHERE id = ?`)
      .run(input.confidence ?? existing.confidence, input.snapshotPath ?? null, id);
    return this.get(id);
  },

  /** Close an event: record end time, duration, final confidence and clip. */
  close(
    id: string,
    input: { endedAt: string; durationS: number; confidence: number; clipPath?: string },
  ): SecurityEvent | null {
    const result = getDb()
      .prepare(
        `UPDATE events SET status = 'completed', ended_at = ?, duration_s = ?, confidence = ?, clip_path = ?
         WHERE id = ?`,
      )
      .run(input.endedAt, input.durationS, input.confidence, input.clipPath ?? null, id);
    return result.changes > 0 ? this.get(id) : null;
  },

  /**
   * Mark stale 'active' events as completed. Called at startup so events are
   * not stranded if the worker died mid-event.
   */
  closeStaleActive(): number {
    const now = new Date().toISOString();
    return getDb()
      .prepare(`UPDATE events SET status = 'completed', ended_at = COALESCE(ended_at, ?) WHERE status = 'active'`)
      .run(now).changes;
  },

  /** Aggregate stats for the dashboard. */
  stats(): { today: number; activeNow: number; total: number } {
    const db = getDb();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = (db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE started_at >= ?`)
      .get(startOfDay.toISOString()) as { n: number }).n;
    const activeNow = (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE status = 'active'`).get() as { n: number }).n;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n;
    return { today, activeNow, total };
  },
};
