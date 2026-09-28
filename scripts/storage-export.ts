/**
 * Exports every stored file, decrypted, under its original name - see
 * docs/files.md. Stored files are encrypted, so copying the storage folder
 * directly only gives unreadable blobs; use this instead.
 *
 *   npm run storage:export -- <output folder>
 *
 * Layout:
 *   <out>/evidence/<finding reference>/<id>_<original name>
 *   <out>/imports/<date>_<id>_<original name>
 *
 * Needs FILE_ENCRYPTION_KEY and database access (.env). Treat the output
 * folder as sensitive: its files are no longer encrypted.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { readDb } from "../src/lib/db";
import { readStoredFile } from "../src/lib/fileStorage";

const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim() || "file";

async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: npm run storage:export -- <output folder>");
    process.exit(1);
  }
  const db = await readDb();
  const refOf = new Map(db.findings.map((f) => [f.id, f.reference]));
  let written = 0;
  let missing = 0;

  for (const e of db.evidence) {
    const buf = readStoredFile("evidence", e.storagePath);
    if (!buf) {
      console.log(`  missing: ${e.fileName} (${e.storagePath})`);
      missing++;
      continue;
    }
    const dir = path.join(out, "evidence", safe(refOf.get(e.findingId) ?? e.findingId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${e.id.slice(0, 8)}_${safe(e.fileName)}`), buf);
    written++;
  }

  for (const b of db.importBatches) {
    if (!b.storedFile) continue;
    const buf = readStoredFile("imports", b.storedFile);
    if (!buf) {
      console.log(`  missing: import ${b.fileName} (${b.storedFile})`);
      missing++;
      continue;
    }
    const dir = path.join(out, "imports");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${b.createdAt.slice(0, 10)}_${b.id.slice(0, 8)}_${safe(b.fileName)}`), buf);
    written++;
  }

  console.log(`Exported ${written} file(s) to ${path.resolve(out)}${missing ? ` - ${missing} missing from storage` : ""}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
