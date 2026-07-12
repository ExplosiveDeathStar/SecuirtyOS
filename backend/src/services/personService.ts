/**
 * Person Service — owns the persons registry (face identities).
 *
 * The worker enrolls persons when it sees a new face and links persons to
 * events as sightings. Users rename persons and mark them safe via the
 * public API. Frequency stats are purely objective sighting counts.
 */
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import type { EventPerson, Person } from "../types.js";

interface PersonRow {
  id: string;
  site_id: string;
  name: string;
  safe: number;
  labeled: number;
  embeddings: string;
  face_path: string | null;
  face_paths: string;
  thumb_sharpness: number;
  thumb_user_set: number;
  first_seen_at: string;
  last_seen_at: string;
}

// Keep enough embeddings per person to cover different angles, lighting,
// and blur levels — but not so many that matching gets slow.
const MAX_EMBEDDINGS_PER_PERSON = 10;
// Captured face photos kept per person (the thumbnail is picked from these).
const MAX_FACE_PHOTOS = 12;

function parsePaths(json: string): string[] {
  return (JSON.parse(json || "[]") as (string | null)[]).filter((p): p is string => !!p);
}

function sevenDaysAgo(): string {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

interface VisitStats {
  total: number;
  last7d: number;
  today: number;
}

function toPerson(row: PersonRow, visits: VisitStats): Person {
  return {
    id: row.id,
    name: row.name,
    safe: row.safe === 1,
    labeled: row.labeled === 1,
    faceUrl: row.face_path ? `/media/${row.face_path}` : null,
    faceUrls: parsePaths(row.face_paths).map((p) => `/media/${p}`),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    visitCount: visits.total,
    visitsLast7d: visits.last7d,
    visitsToday: visits.today,
  };
}

export const personService = {
  list(siteId: string): Person[] {
    const db = getDb();
    const rows = db
      .prepare(`SELECT * FROM persons WHERE site_id = ? ORDER BY last_seen_at DESC`)
      .all(siteId) as PersonRow[];
    const stats = this.visitStats(rows.map((r) => r.id));
    return rows.map((row) => toPerson(row, stats.get(row.id) ?? { total: 0, last7d: 0, today: 0 }));
  },

  get(id: string, siteId?: string): Person | null {
    const row = getDb()
      .prepare(`SELECT * FROM persons WHERE id = ?${siteId ? " AND site_id = ?" : ""}`)
      .get(...(siteId ? [id, siteId] : [id])) as PersonRow | undefined;
    if (!row) return null;
    return toPerson(row, this.visitStats([id]).get(id) ?? { total: 0, last7d: 0, today: 0 });
  },

  /** Enroll a new (unlabeled) person from the worker. */
  create(siteId: string, input: { embedding: number[]; facePath?: string | null; sharpness?: number }): Person {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM persons WHERE site_id = ?`).get(siteId) as { n: number }).n;
    db.prepare(
      `INSERT INTO persons (id, site_id, name, embeddings, face_path, face_paths, thumb_sharpness, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      siteId,
      `Person ${count + 1}`,
      JSON.stringify([input.embedding]),
      input.facePath ?? null,
      JSON.stringify(input.facePath ? [input.facePath] : []),
      input.sharpness ?? 0,
      now,
      now,
    );
    return this.get(id, siteId)!;
  },

  /**
   * User edits: rename, toggle safe, and/or pick a thumbnail from the photo
   * gallery. Renaming marks the person as labeled.
   */
  update(siteId: string, id: string, input: { name?: string; safe?: boolean; faceUrl?: string }): Person | null {
    const row = getDb()
      .prepare(`SELECT * FROM persons WHERE id = ? AND site_id = ?`)
      .get(id, siteId) as PersonRow | undefined;
    if (!row) return null;
    const rename = input.name !== undefined && input.name.trim() !== "" && input.name !== row.name;

    // Thumbnail choice must be one of the captured photos. A user-picked
    // photo sticks — auto-upgrades stop overriding it.
    let facePath = row.face_path;
    let thumbUserSet = row.thumb_user_set;
    if (input.faceUrl !== undefined) {
      const chosen = input.faceUrl.replace(/^\/media\//, "");
      if (parsePaths(row.face_paths).includes(chosen)) {
        facePath = chosen;
        thumbUserSet = 1;
      }
    }

    getDb()
      .prepare(
        `UPDATE persons SET name = ?, safe = ?, labeled = ?, face_path = ?, thumb_user_set = ? WHERE id = ?`,
      )
      .run(
        rename ? input.name!.trim() : row.name,
        input.safe === undefined ? row.safe : input.safe ? 1 : 0,
        rename ? 1 : row.labeled,
        facePath,
        thumbUserSet,
        id,
      );
    return this.get(id, siteId);
  },

  /**
   * Merge `sourceId` into `targetId` — for when the AI misidentified and
   * created a duplicate. The target keeps its label; it absorbs the source's
   * sightings, face embeddings, and photos. The source is deleted.
   */
  merge(siteId: string, targetId: string, sourceId: string): Person | null {
    if (targetId === sourceId) return this.get(targetId, siteId);
    const db = getDb();
    const target = db.prepare(`SELECT * FROM persons WHERE id = ? AND site_id = ?`).get(targetId, siteId) as PersonRow | undefined;
    const source = db.prepare(`SELECT * FROM persons WHERE id = ? AND site_id = ?`).get(sourceId, siteId) as PersonRow | undefined;
    if (!target || !source) return null;

    const embeddings = (JSON.parse(target.embeddings || "[]") as number[][])
      .concat(JSON.parse(source.embeddings || "[]") as number[][])
      .slice(0, MAX_EMBEDDINGS_PER_PERSON);
    const facePaths = [...new Set([...parsePaths(target.face_paths), ...parsePaths(source.face_paths)])]
      .slice(0, MAX_FACE_PHOTOS);

    // If only the source had a real name or a safe mark, carry those over.
    const name = target.labeled === 1 || source.labeled === 0 ? target.name : source.name;
    const labeled = target.labeled === 1 || source.labeled === 1 ? 1 : 0;
    const safe = target.safe === 1 || source.safe === 1 ? 1 : 0;

    const run = db.transaction(() => {
      db.prepare(
        `INSERT OR IGNORE INTO event_persons (event_id, person_id)
         SELECT event_id, ? FROM event_persons WHERE person_id = ?`,
      ).run(targetId, sourceId);
      db.prepare(
        `UPDATE persons
         SET name = ?, labeled = ?, safe = ?, embeddings = ?, face_paths = ?,
             face_path = COALESCE(face_path, ?),
             thumb_sharpness = CASE WHEN face_path IS NULL THEN ? ELSE thumb_sharpness END,
             thumb_user_set = MAX(thumb_user_set, ?),
             first_seen_at = MIN(first_seen_at, ?),
             last_seen_at = MAX(last_seen_at, ?)
         WHERE id = ?`,
      ).run(
        name,
        labeled,
        safe,
        JSON.stringify(embeddings),
        JSON.stringify(facePaths),
        source.face_path,
        source.thumb_sharpness,
        source.thumb_user_set,
        source.first_seen_at,
        source.last_seen_at,
        targetId,
      );
      db.prepare(`DELETE FROM persons WHERE id = ?`).run(sourceId);
    });
    run();
    return this.get(targetId, siteId);
  },

  delete(siteId: string, id: string): boolean {
    return getDb().prepare(`DELETE FROM persons WHERE id = ? AND site_id = ?`).run(id, siteId).changes > 0;
  },

  /** Registry with embeddings — internal API for the worker's face matcher. */
  listWithEmbeddings(siteId: string): { id: string; name: string; embeddings: number[][] }[] {
    const rows = getDb().prepare(`SELECT id, name, embeddings FROM persons WHERE site_id = ?`).all(siteId) as Pick<
      PersonRow,
      "id" | "name" | "embeddings"
    >[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      embeddings: JSON.parse(r.embeddings || "[]") as number[][],
    }));
  },

  /** Link sightings to an event and refresh last-seen timestamps. */
  addEventPersons(eventId: string, personIds: string[]): void {
    const db = getDb();
    const now = new Date().toISOString();
    const link = db.prepare(
      `INSERT OR IGNORE INTO event_persons (event_id, person_id)
       SELECT e.id, p.id
       FROM events e
       JOIN cameras c ON c.id = e.camera_id
       JOIN persons p ON p.id = ?
       WHERE e.id = ? AND p.site_id = c.site_id`,
    );
    const touch = db.prepare(`UPDATE persons SET last_seen_at = ? WHERE id = ?`);
    for (const personId of personIds) {
      const linked = link.run(personId, eventId);
      if (linked.changes > 0) touch.run(now, personId);
    }
  },

  /**
   * Worker adds another face embedding (and optionally the face photo it came
   * from) to a known person, improving future matching under blur and giving
   * the user more photos to pick a thumbnail from. When the new photo is
   * sharper than the current thumbnail (and the user hasn't hand-picked one),
   * it becomes the new thumbnail automatically.
   */
  addEmbedding(id: string, embedding: number[], facePath?: string | null, sharpness = 0): boolean {
    const row = getDb()
      .prepare(`SELECT embeddings, face_paths, face_path, thumb_sharpness, thumb_user_set FROM persons WHERE id = ?`)
      .get(id) as
      | Pick<PersonRow, "embeddings" | "face_paths" | "face_path" | "thumb_sharpness" | "thumb_user_set">
      | undefined;
    if (!row) return false;
    const embeddings = JSON.parse(row.embeddings || "[]") as number[][];
    if (embeddings.length >= MAX_EMBEDDINGS_PER_PERSON) return false;
    embeddings.push(embedding);

    const facePaths = parsePaths(row.face_paths);
    if (facePath && facePaths.length < MAX_FACE_PHOTOS && !facePaths.includes(facePath)) {
      facePaths.push(facePath);
    }

    const upgradeThumb =
      facePath !== null &&
      facePath !== undefined &&
      row.thumb_user_set !== 1 &&
      (row.face_path === null || sharpness > row.thumb_sharpness);

    getDb()
      .prepare(
        `UPDATE persons SET embeddings = ?, face_paths = ?, face_path = ?, thumb_sharpness = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify(embeddings),
        JSON.stringify(facePaths),
        upgradeThumb ? facePath : row.face_path,
        upgradeThumb ? sharpness : row.thumb_sharpness,
        id,
      );
    return true;
  },

  /** Persons linked to a set of events (for embedding into event payloads). */
  personsForEvents(eventIds: string[]): Map<string, EventPerson[]> {
    const result = new Map<string, EventPerson[]>();
    if (eventIds.length === 0) return result;
    const placeholders = eventIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT ep.event_id, p.id, p.name, p.safe, p.labeled, p.face_path
         FROM event_persons ep JOIN persons p ON p.id = ep.person_id
         WHERE ep.event_id IN (${placeholders})`,
      )
      .all(...eventIds) as {
      event_id: string;
      id: string;
      name: string;
      safe: number;
      labeled: number;
      face_path: string | null;
    }[];
    const stats = this.visitStats([...new Set(rows.map((r) => r.id))]);
    for (const row of rows) {
      const list = result.get(row.event_id) ?? [];
      const visits = stats.get(row.id);
      list.push({
        id: row.id,
        name: row.name,
        safe: row.safe === 1,
        labeled: row.labeled === 1,
        faceUrl: row.face_path ? `/media/${row.face_path}` : null,
        visitCount: visits?.total ?? 0,
        visitsLast7d: visits?.last7d ?? 0,
      });
      result.set(row.event_id, list);
    }
    return result;
  },

  /** Objective sighting counts (total / last 7 days / today) per person. */
  visitStats(personIds: string[]): Map<string, VisitStats> {
    const result = new Map<string, VisitStats>();
    if (personIds.length === 0) return result;
    const placeholders = personIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(
        `SELECT ep.person_id AS id,
                COUNT(*) AS total,
                SUM(CASE WHEN e.started_at >= ? THEN 1 ELSE 0 END) AS last7d,
                SUM(CASE WHEN e.started_at >= ? THEN 1 ELSE 0 END) AS today
         FROM event_persons ep JOIN events e ON e.id = ep.event_id
         WHERE ep.person_id IN (${placeholders})
         GROUP BY ep.person_id`,
      )
      .all(sevenDaysAgo(), startOfToday(), ...personIds) as {
      id: string;
      total: number;
      last7d: number | null;
      today: number | null;
    }[];
    for (const row of rows) {
      result.set(row.id, { total: row.total, last7d: row.last7d ?? 0, today: row.today ?? 0 });
    }
    return result;
  },
};
