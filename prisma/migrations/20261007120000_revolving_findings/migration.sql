-- Revolving findings (docs/revolving-findings.md): adjustments of a finding's
-- outstanding cases / amount, the frozen original figures, and the
-- operation-area list that allows them.

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "registered_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "registered_case_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "finding_adjustments" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "added_cases" INTEGER NOT NULL DEFAULT 0,
    "amount_change" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "new_case_amounts" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "case_amount_changes" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "requester_scope" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "applied" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "revolving_operation_areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "adjustment_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finding_adjustments_finding_id_idx" ON "finding_adjustments"("finding_id");

-- CreateIndex
CREATE INDEX "finding_adjustments_status_idx" ON "finding_adjustments"("status");

-- AddForeignKey
ALTER TABLE "finding_adjustments" ADD CONSTRAINT "finding_adjustments_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: every existing finding's original figures = its figures today.
UPDATE "findings" SET "registered_case_count" = "case_count", "registered_amount" = "amount";

-- Data: the settings row (no revolving operation areas yet).
INSERT INTO "adjustment_config" ("id") VALUES ('singleton');
