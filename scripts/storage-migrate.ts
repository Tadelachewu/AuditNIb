/**
 * One-time (safe to re-run) move of stored files into the dedicated,
 * encrypted storage folder - see docs/files.md.
 *
 *   npm run storage:migrate
 *
 * 1. Every file in the old location (data/uploads/) is encrypted and moved
 *    to <STORAGE_DIR>/evidence/, then the old copy is removed.
 * 2. Any file already in <STORAGE_DIR>/evidence or /imports that is still
 *    plain (written before encryption existed) is encrypted in place.
 *
 * Needs FILE_ENCRYPTION_KEY set (.env). Already-encrypted files are left
 * untouched, so running it twice is harmless.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  LEGACY_EVIDENCE_DIR,
  STORAGE_ROOT,
  areaDir,
  isEncrypted,
  encrypt,
  listStoredFiles,
  writeStoredFile,
  type StorageArea,
} from "../src/lib/fileStorage";

let moved = 0;
let encryptedInPlace = 0;
let skipped = 0;

console.log(`Storage folder: ${STORAGE_ROOT}`);

// 1. legacy data/uploads -> storage/evidence (encrypted)
if (fs.existsSync(LEGACY_EVIDENCE_DIR)) {
  for (const name of fs.readdirSync(LEGACY_EVIDENCE_DIR)) {
    const from = path.join(LEGACY_EVIDENCE_DIR, name);
    if (!fs.statSync(from).isFile()) continue;
    const target = path.join(areaDir("evidence"), name);
    if (fs.existsSync(target)) {
      skipped++;
      continue;
    }
    const buf = fs.readFileSync(from);
    try {
      if (isEncrypted(buf)) {
        fs.mkdirSync(areaDir("evidence"), { recursive: true, mode: 0o700 });
        fs.writeFileSync(target, buf, { mode: 0o600 });
      } else {
        writeStoredFile("evidence", name, buf);
      }
    } catch (err) {
      console.error(`  ! could not move ${name}:`, (err as Error).message);
      continue;
    }
    fs.unlinkSync(from);
    moved++;
  }
}

// 2. anything still plain inside the storage folder -> encrypted in place
for (const area of ["evidence", "imports"] as StorageArea[]) {
  for (const name of listStoredFiles(area)) {
    const p = path.join(areaDir(area), name);
    const buf = fs.readFileSync(p);
    if (isEncrypted(buf)) continue;
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, encrypt(buf), { mode: 0o600 });
    fs.renameSync(tmp, p);
    encryptedInPlace++;
  }
}

console.log(`Moved from data/uploads: ${moved}`);
console.log(`Encrypted in place:      ${encryptedInPlace}`);
if (skipped) console.log(`Skipped (already moved): ${skipped}`);
console.log("Done.");
