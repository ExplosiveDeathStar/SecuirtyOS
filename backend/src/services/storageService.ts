/**
 * Storage Service — owns the local media directories.
 *
 * Snapshots and clips are written by the worker into `data/media/` and served
 * by this backend under `/media/*`. This service guarantees the directory
 * layout exists and resolves media paths safely (no path traversal).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { getDb } from "../db/index.js";

export const storageService = {
  /** Create the data/media directory tree if missing. */
  ensureDirectories(): void {
    for (const dir of [config.dataDir, config.mediaDir, config.snapshotsDir, config.clipsDir, config.facesDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  },

  /**
   * Resolve a relative media path (e.g. "snapshots/abc.jpg") to an absolute
   * path inside the media dir. Returns null for anything that escapes it.
   */
  resolveMediaPath(relativePath: string): string | null {
    const resolved = path.resolve(config.mediaDir, relativePath);
    if (!resolved.startsWith(config.mediaDir + path.sep)) return null;
    return fs.existsSync(resolved) ? resolved : null;
  },

  /** Ensure paid users can only fetch media belonging to their own site. */
  canAccessMedia(siteId: string, relativePath: string): boolean {
    const row = getDb()
      .prepare(
        `SELECT 1
         FROM events e JOIN cameras c ON c.id = e.camera_id
         WHERE c.site_id = ? AND (e.snapshot_path = ? OR e.clip_path = ?)
         UNION ALL
         SELECT 1
         FROM persons p
         WHERE p.site_id = ?
           AND (
             p.face_path = ?
             OR EXISTS (SELECT 1 FROM json_each(p.face_paths) WHERE value = ?)
           )
         LIMIT 1`,
      )
      .get(siteId, relativePath, relativePath, siteId, relativePath, relativePath);
    return row !== undefined;
  },

  /** Directory paths shared with the worker via the internal API. */
  mediaConfig(): { mediaDir: string; snapshotsDir: string; clipsDir: string; facesDir: string } {
    return {
      mediaDir: config.mediaDir,
      snapshotsDir: config.snapshotsDir,
      clipsDir: config.clipsDir,
      facesDir: config.facesDir,
    };
  },
};
