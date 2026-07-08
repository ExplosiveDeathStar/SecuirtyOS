/**
 * Camera Service — owns the camera registry.
 *
 * Responsibilities:
 *  - CRUD for cameras
 *  - encrypting credentials at rest (AES-256-GCM, local key)
 *  - providing decrypted credentials to the local detection worker only
 */
import crypto from "node:crypto";
import { getDb } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import type { Camera, CameraWithSecrets } from "../types.js";

interface CameraRow {
  id: string;
  name: string;
  location: string;
  rtsp_url: string;
  username: string;
  password_enc: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CameraInput {
  name: string;
  location?: string;
  rtspUrl: string;
  username?: string;
  password?: string;
  enabled?: boolean;
}

function toCamera(row: CameraRow): Camera {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    rtspUrl: row.rtsp_url,
    username: row.username,
    hasPassword: row.password_enc.length > 0,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const cameraService = {
  list(): Camera[] {
    const rows = getDb().prepare(`SELECT * FROM cameras ORDER BY created_at ASC`).all() as CameraRow[];
    return rows.map(toCamera);
  },

  get(id: string): Camera | null {
    const row = getDb().prepare(`SELECT * FROM cameras WHERE id = ?`).get(id) as CameraRow | undefined;
    return row ? toCamera(row) : null;
  },

  create(input: CameraInput): Camera {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO cameras (id, name, location, rtsp_url, username, password_enc, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.location ?? "",
        input.rtspUrl,
        input.username ?? "",
        encryptSecret(input.password ?? ""),
        input.enabled === false ? 0 : 1,
        now,
        now,
      );
    return this.get(id)!;
  },

  update(id: string, input: Partial<CameraInput>): Camera | null {
    const existing = getDb().prepare(`SELECT * FROM cameras WHERE id = ?`).get(id) as CameraRow | undefined;
    if (!existing) return null;
    getDb()
      .prepare(
        `UPDATE cameras SET name = ?, location = ?, rtsp_url = ?, username = ?, password_enc = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name ?? existing.name,
        input.location ?? existing.location,
        input.rtspUrl ?? existing.rtsp_url,
        input.username ?? existing.username,
        // `password === undefined` means "leave unchanged"; empty string clears it.
        input.password === undefined ? existing.password_enc : encryptSecret(input.password),
        input.enabled === undefined ? existing.enabled : input.enabled ? 1 : 0,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  },

  delete(id: string): boolean {
    return getDb().prepare(`DELETE FROM cameras WHERE id = ?`).run(id).changes > 0;
  },

  /**
   * Cameras with decrypted credentials. Only ever served to the local worker
   * over the internal (localhost-bound) API — never through the public routes.
   */
  listWithSecrets(): CameraWithSecrets[] {
    const rows = getDb().prepare(`SELECT * FROM cameras`).all() as CameraRow[];
    return rows.map((row) => ({ ...toCamera(row), password: decryptSecret(row.password_enc) }));
  },
};
