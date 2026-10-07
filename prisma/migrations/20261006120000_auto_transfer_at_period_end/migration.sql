-- AlterTable
ALTER TABLE "settings" DROP COLUMN "auto_transfer_on_lock";

-- CreateTable
CREATE TABLE "auto_transfer_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "excluded_operation_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "delay_hours" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "auto_transfer_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_transfer_runs" (
    "period_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "to_period_id" TEXT,
    "moved_count" INTEGER NOT NULL DEFAULT 0,
    "kept_count" INTEGER NOT NULL DEFAULT 0,
    "moved_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kept_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ran_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auto_transfer_runs_pkey" PRIMARY KEY ("period_id")
);

-- Data (added by hand - Prisma only generates schema): the settings row, and
-- periods that had already ended at install are marked handled, so installing
-- never suddenly moves old findings.
INSERT INTO "auto_transfer_config" ("id") VALUES ('singleton');

INSERT INTO "auto_transfer_runs" ("period_id", "status", "ran_at")
SELECT "id", 'SKIPPED_AT_RELEASE', CURRENT_TIMESTAMP
FROM "reporting_periods"
WHERE GREATEST("ends_at", "submission_ends_at") <= CURRENT_TIMESTAMP;
