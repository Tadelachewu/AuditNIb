import path from "path";
import fs from "fs";
import crypto from "crypto";

/**
 * The one place the app reads, writes and deletes stored files - evidence
 * and comment attachments, and the original spreadsheet behind every
 * import. See docs/files.md.
 *
 *   <STORAGE_DIR>/            default: ./storage (next to the app)
 *     evidence/<uuid>.<ext>   evidence + comment attachments
 *     imports/<uuid>.xlsx     original import spreadsheets
 *
 * STORAGE_DIR (env) can point anywhere - a dedicated disk/volume, or a
 * network share mounted on every app server when running more than one.
 * Only server-generated names (a UUID + a known extension) are ever
 * accepted, so no user input can reach a path.
 *
 * Every file is encrypted at rest with AES-256-GCM using FILE_ENCRYPTION_KEY
 * (env; 32 random bytes, base64 or hex). The key never sits next to the
 * files, so a copy of the storage folder (or its backup) alone is
 * unreadable. GCM's auth tag also detects any tampering with a file on
 * disk. Files written before encryption existed (plain bytes, no header -
 * including the old data/uploads/ location) are still read transparently.
 */

export type StorageArea = "evidence" | "imports";

export const STORAGE_ROOT = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.join(process.cwd(), "storage");

/** Where evidence lived before the dedicated storage folder (read-only fallback). */
export const LEGACY_EVIDENCE_DIR = path.join(process.cwd(), "data", "uploads");

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

// File layout: MAGIC | 12-byte IV | 16-byte auth tag | ciphertext
const MAGIC = Buffer.from("NIBENC1\0", "latin1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class FileStorageError extends Error {}

export function areaDir(area: StorageArea): string {
  return path.join(STORAGE_ROOT, area);
}

function storedPath(area: StorageArea, name: string): string {
  if (!STORED_NAME.test(name)) throw new FileStorageError(`Invalid stored file name: ${name}`);
  return path.join(areaDir(area), name);
}

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.FILE_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new FileStorageError(
      "File storage isn't configured: set FILE_ENCRYPTION_KEY (32 random bytes, base64) in the server's .env - see docs/files.md."
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new FileStorageError("FILE_ENCRYPTION_KEY must be 32 bytes (44 base64 characters or 64 hex characters).");
  }
  cachedKey = key;
  return key;
}

export function isEncrypted(buf: Buffer): boolean {
  return buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encrypt(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(stored: Buffer): Buffer {
  if (!isEncrypted(stored)) return stored; // legacy plain file
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = stored.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
  const body = stored.subarray(MAGIC.length + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new FileStorageError("Stored file failed its integrity check (wrong FILE_ENCRYPTION_KEY, or the file was altered).");
  }
}

/** Encrypts and writes a file; atomic (temp file + rename), owner-only permissions. */
export function writeStoredFile(area: StorageArea, name: string, plain: Buffer): void {
  const target = storedPath(area, name);
  fs.mkdirSync(areaDir(area), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, encrypt(plain), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/** Reads and decrypts a stored file, or null when it doesn't exist. */
export function readStoredFile(area: StorageArea, name: string): Buffer | null {
  const candidates = [storedPath(area, name)];
  if (area === "evidence") candidates.push(path.join(LEGACY_EVIDENCE_DIR, name));
  for (const p of candidates) {
    if (fs.existsSync(p)) return decrypt(fs.readFileSync(p));
  }
  return null;
}

/** Deletes a stored file (and any legacy copy); missing files are not an error. */
export function deleteStoredFile(area: StorageArea, name: string): boolean {
  let deleted = false;
  const candidates = [storedPath(area, name)];
  if (area === "evidence") candidates.push(path.join(LEGACY_EVIDENCE_DIR, name));
  for (const p of candidates) {
    try {
      fs.unlinkSync(p);
      deleted = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[fileStorage] could not delete ${p}`, err);
    }
  }
  return deleted;
}

/** Stored file names in an area (for the orphan cleanup script). */
export function listStoredFiles(area: StorageArea): string[] {
  try {
    return fs.readdirSync(areaDir(area)).filter((n) => STORED_NAME.test(n));
  } catch {
    return [];
  }
}

/** A new server-generated stored name - never derived from user input. */
export function newStoredName(extension: string): string {
  return `${crypto.randomUUID()}.${extension}`;
}

/**
 * Content-Disposition for downloading a stored file under its original
 * name: a plain-ASCII `filename` for old clients plus the RFC 5987
 * `filename*` (UTF-8) form every modern browser prefers - so names with
 * spaces or non-Latin characters (e.g. Amharic) download correctly
 * instead of as "%E1%88%B0...".
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
