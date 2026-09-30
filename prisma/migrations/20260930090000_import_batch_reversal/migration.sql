-- Import reversal (Import History -> Reverse): who reversed a batch, when
-- and why. The batch row itself is kept. Idempotent, like the other recent migrations.
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP(3);
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "reversed_by" TEXT;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "reversed_by_name" TEXT;
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "reverse_reason" TEXT;
