-- Step 1 of 2: add the hash-chain columns as nullable first - 445 existing
-- rows need real values before NOT NULL/UNIQUE can be enforced. Run
-- `npx tsx prisma/backfill-audit-hash-chain.ts` after this migration
-- applies, then the follow-up migration tightens these to NOT NULL/UNIQUE.
ALTER TABLE "audit_logs" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "audit_logs" ADD COLUMN "previous_hash" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "hash" TEXT;
