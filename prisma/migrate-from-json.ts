// One-time ETL: reads the existing data/db.json (the JSON-file "database"
// this app used since Phase 1) and inserts every row into Postgres via
// Prisma, preserving every id byte-for-byte so no Finding reference, audit
// log entry, or foreign-key relationship changes across the cutover.
//
// Run once, against an EMPTY (freshly migrated, `prisma migrate dev`
// already applied) database:
//   npx tsx prisma/migrate-from-json.ts
//
// Safe to re-run against an empty database if it fails partway (it does
// not delete anything first) - if you need to retry after a partial run,
// run prisma/clear-partial-etl.ts first.
//
// This is a one-time bridge for an install that already has real data in
// data/db.json (a pre-Postgres deployment of this app). A brand-new install
// with no such file should use `npx prisma db seed` instead (prisma/seed.ts)
// - see that file's own doc comment for why the two are kept separate.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { insertDatabaseIntoPostgres } from "./insertDatabase";
import type { Database } from "../src/types";

// Run via tsx, outside Next.js, so nothing auto-loads .env for us or wires
// up the driver adapter the way src/lib/prismaClient.ts does for the app -
// both are done explicitly here instead.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const dbPath = path.join(process.cwd(), "data", "db.json");
  const raw = fs.readFileSync(dbPath, "utf-8");
  const db = JSON.parse(raw) as Database;

  console.log("Migrating from", dbPath);
  await insertDatabaseIntoPostgres(prisma, db);
  console.log("\nMigration complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
