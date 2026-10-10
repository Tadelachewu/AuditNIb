-- Rectification reminders on a schedule (docs/rectification-reminders.md):
-- one row per run; the scheduled run's id is its local date, so a day is
-- never run twice.

CREATE TABLE "reminder_runs" (
    "id" TEXT NOT NULL,
    "run_date" TEXT NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "reminded_findings" INTEGER NOT NULL DEFAULT 0,
    "notified_users" INTEGER NOT NULL DEFAULT 0,
    "finding_references" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "reminder_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reminder_runs_ran_at_idx" ON "reminder_runs"("ran_at");
