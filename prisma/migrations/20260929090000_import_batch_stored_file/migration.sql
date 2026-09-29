-- Keep the original spreadsheet behind every import (encrypted, in the
-- storage folder's imports/ area). Idempotent, like the other recent migrations.
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "stored_file" TEXT;
