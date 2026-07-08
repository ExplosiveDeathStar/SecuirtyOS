/**
 * Local credential encryption.
 *
 * Camera passwords are encrypted at rest with AES-256-GCM. The key is
 * generated on first launch and stored in `data/secret.key` with owner-only
 * permissions. Nothing ever leaves the machine.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

/** Load the local encryption key, generating it on first use. */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const keyPath = config.secretKeyPath;
  if (fs.existsSync(keyPath)) {
    cachedKey = Buffer.from(fs.readFileSync(keyPath, "utf8").trim(), "hex");
  } else {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
    cachedKey = key;
  }
  return cachedKey;
}

/** Encrypt a secret. Returns `iv:authTag:ciphertext` (hex). Empty in, empty out. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}

/** Decrypt a secret previously produced by {@link encryptSecret}. */
export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed encrypted payload");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}
