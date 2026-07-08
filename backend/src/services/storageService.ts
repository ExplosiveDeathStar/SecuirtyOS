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

export const storageService = {
  /** Create the data/media directory tree if missing. */
  ensureDirectories(): void {
    for (const dir of [config.dataDir, config.mediaDir, config.snapshotsDir, config.clipsDir]) {
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

  /** Directory paths shared with the worker via the internal API. */
  mediaConfig(): { mediaDir: string; snapshotsDir: string; clipsDir: string } {
    return {
      mediaDir: config.mediaDir,
      snapshotsDir: config.snapshotsDir,
      clipsDir: config.clipsDir,
    };
  },
};
