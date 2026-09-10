// One-time backfill: assigns sequence/previousHash/hash to every existing
// audit_logs row that predates the hash-chain feature (see
// src/lib/audit.ts's own doc comment for what the chain is and why).
// Orders the existing rows by `timestamp` (the only ordering signal they
// have) via buildAuditLogChainFromScratch(), then writes the result back.
//
// Run once, after the `audit-log-hash-chain` migration has added the three
// columns as nullable:
//   npx tsx prisma/backfill-audit-hash-chain.ts
// Safe to re-run - it always recomputes the whole chain from `timestamp`
// order and overwrites, rather than assuming any partial prior run.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildAuditLogChainFromScratch } from "../src/lib/audit";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const rows = await prisma.auditLogEntry.findMany();
  console.log(`Backfilling hash chain for ${rows.length} existing audit log entries...`);

  const chained = buildAuditLogChainFromScratch(
    rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      oldValue: r.oldValue ?? undefined,
      newValue: r.newValue ?? undefined,
      reason: r.reason ?? undefined,
      timestamp: r.timestamp.toISOString(),
    }))
  );

  // Two passes to avoid transiently colliding with `sequence`'s UNIQUE
  // constraint: row A's target sequence can equal row B's *current* one
  // while B hasn't been updated yet (re-running this script after the
  // hashing logic changes, as happened once already, reassigns the same
  // final values but not necessarily in an order where each row's own
  // current value is free the instant it's needed). Shifting every row
  // to a negative, guaranteed-free range first sidesteps that entirely.
  for (const entry of chained) {
    await prisma.auditLogEntry.update({
      where: { id: entry.id },
      data: { sequence: -entry.sequence },
    });
  }
  for (const entry of chained) {
    await prisma.auditLogEntry.update({
      where: { id: entry.id },
      data: { sequence: entry.sequence, previousHash: entry.previousHash, hash: entry.hash },
    });
  }

  console.log(`Backfilled ${chained.length} entries. Highest sequence: ${chained.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
