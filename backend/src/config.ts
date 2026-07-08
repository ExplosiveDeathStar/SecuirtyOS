/**
 * Central configuration for the SecurityOS backend.
 *
 * Everything runs locally. All paths resolve under a single `data/` directory
 * at the repository root so the database, media, and secrets live side by side
 * and never leave the machine.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (backend/src -> backend -> repo). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const config = {
  /** Port the HTTP API listens on. Bound to localhost only. */
  port: Number(process.env.SECURITYOS_PORT ?? 4000),
  /** Host binding. Localhost only by design — credentials and video stay local. */
  host: process.env.SECURITYOS_HOST ?? "127.0.0.1",

  /** Base URL of the Python detection worker. */
  workerUrl: process.env.SECURITYOS_WORKER_URL ?? "http://127.0.0.1:8001",

  /** Local data directory (database, media, encryption key). */
  dataDir: process.env.SECURITYOS_DATA_DIR ?? path.join(REPO_ROOT, "data"),

  get dbPath() {
    return path.join(this.dataDir, "securityos.db");
  },
  get mediaDir() {
    return path.join(this.dataDir, "media");
  },
  get snapshotsDir() {
    return path.join(this.mediaDir, "snapshots");
  },
  get clipsDir() {
    return path.join(this.mediaDir, "clips");
  },
  get secretKeyPath() {
    return path.join(this.dataDir, "secret.key");
  },
};
