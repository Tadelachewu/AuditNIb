-- Automatic transfer: record what started each sweep - "scheduler"
-- (POST /api/system/auto-transfer) or "in-app" (the check made while people
-- use the app). Existing rows stay NULL (not tracked).
ALTER TABLE "auto_transfer_runs" ADD COLUMN "triggered_by" TEXT;
