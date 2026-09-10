-- Step 2 of 2: now that prisma/backfill-audit-hash-chain.ts has populated
-- every existing row, tighten the hash-chain columns to what
-- prisma/schema.prisma actually declares (NOT NULL, sequence UNIQUE).
ALTER TABLE "audit_logs" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "previous_hash" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "hash" SET NOT NULL;
CREATE UNIQUE INDEX "audit_logs_sequence_key" ON "audit_logs"("sequence");
