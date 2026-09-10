// Prisma-native seed for a brand-new install: no data/db.json required.
// Wired into prisma.config.ts's `migrations.seed`, so `npx prisma migrate
// dev` (on a schema with no migrations yet) and `npx prisma db seed` both
// run this automatically - Prisma 7 no longer runs a seed step
// automatically after every migrate dev the way v6 did, so this only ever
// fires when explicitly invoked (see that field's own doc comment).
//
// Kept separate from migrate-from-json.ts on purpose: that script's job is
// to carry over a specific installation's already-accumulated real data
// (findings, transitions, audit history, ...) and only ever runs once, by
// hand, during this app's own Postgres cutover. This script's job is to
// give ANY fresh Postgres database (a new environment, a CI test database,
// a teammate's first `npm install`) the same admin/roles/org-structure
// starting point the JSON-file version used to create on first run - no
// findings, no history, just enough to log in and start using the app.
//
// Refuses to run against a database that already has data (see the guard
// below) rather than risk a duplicate-key crash mid-insert on a database
// that was already seeded or migrated from JSON.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { insertDatabaseIntoPostgres } from "./insertDatabase";
import { buildSeedDatabase } from "./seedData";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    console.log(`Database already has ${existingUserCount} user(s) - skipping seed (this script only ever runs against an empty database).`);
    return;
  }

  console.log("Seeding a fresh database...");
  const db = buildSeedDatabase();
  await insertDatabaseIntoPostgres(prisma, db);
  console.log("\nSeed complete. Log in as admin / Admin@123 (change it immediately in a real deployment).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
