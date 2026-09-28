/**
 * Finds stored files that no database record points to any more ("orphans")
 * - e.g. left behind by a crash mid-upload, or files from before deletes
 * also removed their file. See docs/files.md.
 *
 *   npm run storage:cleanup            # report only (changes nothing)
 *   npm run storage:cleanup -- --delete  # also delete the orphans
 *
 * Also reports records whose file is missing from storage.
 */
import "dotenv/config";
import { readDb } from "../src/lib/db";
import { STORAGE_ROOT, listStoredFiles, deleteStoredFile, type StorageArea } from "../src/lib/fileStorage";

async function main() {
  const doDelete = process.argv.includes("--delete");
  const db = await readDb();

  const referenced: Record<StorageArea, Set<string>> = {
    evidence: new Set(db.evidence.map((e) => e.storagePath)),
    imports: new Set(db.importBatches.map((b) => b.storedFile).filter((f): f is string => Boolean(f))),
  };

  console.log(`Storage folder: ${STORAGE_ROOT}${doDelete ? "  (DELETE mode)" : "  (report only - add --delete to remove orphans)"}`);
  let orphans = 0;
  for (const area of ["evidence", "imports"] as StorageArea[]) {
    const onDisk = listStoredFiles(area);
    const orphaned = onDisk.filter((n) => !referenced[area].has(n));
    const missing = [...referenced[area]].filter((n) => !onDisk.includes(n));
    console.log(`\n[${area}] ${onDisk.length} file(s) on disk, ${referenced[area].size} referenced`);
    for (const n of orphaned) {
      console.log(`  orphan: ${n}${doDelete ? (deleteStoredFile(area, n) ? "  -> deleted" : "  -> could not delete") : ""}`);
    }
    for (const n of missing) console.log(`  missing (record without file): ${n}`);
    orphans += orphaned.length;
  }
  console.log(`\n${orphans} orphan(s) ${doDelete ? "processed" : "found"}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
