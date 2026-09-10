-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OrgScope" AS ENUM ('BANK', 'DISTRICT', 'BRANCH');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'DISTRICT_REVIEW', 'DISTRICT_APPROVED', 'HO_REVIEW', 'HO_APPROVED', 'PENDING_BANK_APPROVAL', 'SENT_TO_BRANCH_MANAGER', 'PARTIALLY_RECTIFIED', 'RECTIFIED', 'TRANSFERRED', 'RECTIFICATION_RETURNED', 'REJECTED', 'RETURNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FindingCaseStatus" AS ENUM ('OUTSTANDING', 'RECTIFIED');

-- CreateEnum
CREATE TYPE "TransferMethod" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "ScoringAdjustmentTargetType" AS ENUM ('DISTRICT', 'BRANCH');

-- CreateEnum
CREATE TYPE "ImportOutcome" AS ENUM ('imported', 'duplicate', 'error');

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "org_scope" "OrgScope" NOT NULL,
    "branch_singleton" BOOLEAN NOT NULL,
    "is_system" BOOLEAN NOT NULL,
    "permissions" TEXT[],
    "status" "Status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" "Status" NOT NULL,
    "district_id" TEXT,
    "branch_id" TEXT,
    "department_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "Status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district_id" TEXT NOT NULL,
    "status" "Status" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "org_scope" "OrgScope" NOT NULL,
    "district_id" TEXT,
    "branch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classified_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scored" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classified_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uncovered_reasons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uncovered_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_rules" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "ever_activated" BOOLEAN NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "categories" TEXT[],
    "sources" TEXT[],
    "basis" TEXT NOT NULL,
    "formula_type" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_adjustments" (
    "id" TEXT NOT NULL,
    "target_type" "ScoringAdjustmentTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "district_id" TEXT,
    "branch_id" TEXT,
    "value" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "adjusted_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting_periods" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "submission_starts_at" TIMESTAMP(3) NOT NULL,
    "submission_ends_at" TIMESTAMP(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL,
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "lock_reason" TEXT,
    "drafts_allowed_while_locked" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reporting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "district_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "finding_date" TEXT NOT NULL,
    "operation_area" TEXT NOT NULL,
    "irregularity_type" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "case_count" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT,
    "root_cause" TEXT,
    "evidence_note" TEXT,
    "status" "FindingStatus" NOT NULL,
    "rectified_cases" INTEGER NOT NULL,
    "rectified_amount" DOUBLE PRECISION NOT NULL,
    "closed_cases" INTEGER NOT NULL,
    "closed_amount" DOUBLE PRECISION NOT NULL,
    "district_verified_cases" INTEGER NOT NULL,
    "district_verified_amount" DOUBLE PRECISION NOT NULL,
    "external_reference" TEXT,
    "import_batch_id" TEXT,
    "last_reminder_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_transitions" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rectifications" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "rectified_cases" INTEGER NOT NULL,
    "rectified_amount" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "submitted_by" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "case_ids" TEXT[],

    CONSTRAINT "rectifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_cases" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "status" "FindingCaseStatus" NOT NULL,
    "rectification_id" TEXT,
    "rectified_at" TIMESTAMP(3),
    "rectified_by" TEXT,
    "rectified_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_transfers" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "from_period_id" TEXT NOT NULL,
    "to_period_id" TEXT NOT NULL,
    "cases_transferred" INTEGER NOT NULL,
    "amount_transferred" DOUBLE PRECISION NOT NULL,
    "original_case_count" INTEGER NOT NULL,
    "original_amount" DOUBLE PRECISION NOT NULL,
    "case_age_at_transfer_days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "method" "TransferMethod" NOT NULL,

    CONSTRAINT "finding_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_closures" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "closed_cases" INTEGER NOT NULL,
    "closed_amount" DOUBLE PRECISION NOT NULL,
    "submitted_by" TEXT NOT NULL,
    "submitted_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finding_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "imported_by" TEXT NOT NULL,
    "imported_by_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "duplicate_count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "rows" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "comment_id" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "uploaded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_coverage_notes" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reason_id" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_by_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_coverage_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "currencies" TEXT[],
    "risk_levels" TEXT[],
    "operation_areas" TEXT[],
    "priority_levels" TEXT[],
    "irregularity_types" TEXT[],
    "notification" JSONB NOT NULL,
    "auto_transfer_on_lock" BOOLEAN NOT NULL,
    "ranking_visibility" JSONB NOT NULL,
    "performance_thresholds" JSONB NOT NULL,
    "ho_approval" JSONB NOT NULL,
    "rectification_reminders" JSONB NOT NULL,
    "similar_finding_fields" TEXT[],
    "required_finding_fields" JSONB NOT NULL,
    "allow_other_value_fields" JSONB NOT NULL,
    "permission_registry_synced_keys" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "districts_code_key" ON "districts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sources_code_key" ON "sources"("code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "classified_categories_code_key" ON "classified_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "uncovered_reasons_code_key" ON "uncovered_reasons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reporting_periods_code_key" ON "reporting_periods"("code");

-- CreateIndex
CREATE UNIQUE INDEX "findings_reference_key" ON "findings"("reference");

-- CreateIndex
CREATE INDEX "findings_period_id_idx" ON "findings"("period_id");

-- CreateIndex
CREATE INDEX "findings_branch_id_idx" ON "findings"("branch_id");

-- CreateIndex
CREATE INDEX "findings_district_id_idx" ON "findings"("district_id");

-- CreateIndex
CREATE INDEX "findings_status_idx" ON "findings"("status");

-- CreateIndex
CREATE INDEX "findings_category_id_idx" ON "findings"("category_id");

-- CreateIndex
CREATE INDEX "finding_transitions_finding_id_idx" ON "finding_transitions"("finding_id");

-- CreateIndex
CREATE INDEX "rectifications_finding_id_idx" ON "rectifications"("finding_id");

-- CreateIndex
CREATE INDEX "finding_cases_finding_id_idx" ON "finding_cases"("finding_id");

-- CreateIndex
CREATE INDEX "finding_transfers_finding_id_idx" ON "finding_transfers"("finding_id");

-- CreateIndex
CREATE INDEX "finding_closures_finding_id_idx" ON "finding_closures"("finding_id");

-- CreateIndex
CREATE INDEX "evidence_finding_id_idx" ON "evidence"("finding_id");

-- CreateIndex
CREATE INDEX "comments_finding_id_idx" ON "comments"("finding_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_idx" ON "notifications"("recipient_user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_coverage_notes_branch_id_period_id_key" ON "branch_coverage_notes"("branch_id", "period_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_adjustments" ADD CONSTRAINT "scoring_adjustments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_adjustments" ADD CONSTRAINT "scoring_adjustments_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_adjustments" ADD CONSTRAINT "scoring_adjustments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_category_fkey" FOREIGN KEY ("category_id") REFERENCES "classified_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_transitions" ADD CONSTRAINT "finding_transitions_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rectifications" ADD CONSTRAINT "rectifications_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_cases" ADD CONSTRAINT "finding_cases_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_transfers" ADD CONSTRAINT "finding_transfers_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_closures" ADD CONSTRAINT "finding_closures_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_coverage_notes" ADD CONSTRAINT "branch_coverage_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_coverage_notes" ADD CONSTRAINT "branch_coverage_notes_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "reporting_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_coverage_notes" ADD CONSTRAINT "branch_coverage_notes_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "uncovered_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
