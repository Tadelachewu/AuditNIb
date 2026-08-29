import path from "path";
import fs from "fs";

// master.txt §16: "secure attachment validation and access controls."
// Local disk under data/uploads/ - same "local now, swappable later"
// pattern as db.ts's data/db.json, git-ignored by the existing /data/ rule.
export const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_EVIDENCE_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/csv": "csv",
};

export function ensureUploadsDir(): void {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function isZip(buf: Buffer): boolean {
  // Local file header "PK\x03\x04", or an empty-archive end-of-central-
  // directory record "PK\x05\x06" - both are valid starts for a real
  // .docx/.xlsx, which are just zip containers.
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);
}

function looksLikeText(buf: Buffer): boolean {
  // CSV has no magic number, so this is a coarse "definitely not binary"
  // check instead: a NUL byte or other control character outside
  // tab/LF/CR in the first chunk means it isn't plain text, regardless of
  // what the upload claimed.
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  for (const byte of sample) {
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20) return false;
  }
  return true;
}

// The browser-supplied `file.type` on an upload is just the Content-Type
// header the client chose to send - trivially spoofable by anything that
// isn't going through the real browser file picker (e.g. a hand-built
// multipart request). Trusting it alone would let someone upload, say, an
// HTML file labeled "application/pdf" and have it stored (and re-served
// with that same claimed Content-Type - see the [evidenceId] download
// route) under an allow-listed extension. This checks the file's actual
// leading bytes against what the claimed type should look like, so the
// allow-list in ALLOWED_EVIDENCE_TYPES can't be bypassed by lying about
// the Content-Type (master.txt §16: "secure attachment validation").
const EVIDENCE_SIGNATURES: Record<string, (buf: Buffer) => boolean> = {
  "application/pdf": (buf) => buf.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (buf) => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (buf) => buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (buf) =>
    isZip(buf) && buf.includes(Buffer.from("xl/")),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (buf) =>
    isZip(buf) && buf.includes(Buffer.from("word/")),
  "text/csv": (buf) => looksLikeText(buf),
};

export function evidenceContentMatchesType(buf: Buffer, mimeType: string): boolean {
  const check = EVIDENCE_SIGNATURES[mimeType];
  return check ? check(buf) : false;
}

/** Server-generated filename only - never the user-supplied one, to rule out path traversal (master.txt §16). */
export function evidenceStoragePath(storedFileName: string): string {
  return path.join(UPLOADS_DIR, storedFileName);
}
