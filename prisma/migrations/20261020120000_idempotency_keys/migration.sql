-- Idempotency-Key (docs/data-integrity.md): one row per (user, method, path,
-- key) - a repeated request gets the stored reply instead of running again.
-- Rows are kept 24 hours.

CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "response_status" INTEGER,
    "response_body" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");
