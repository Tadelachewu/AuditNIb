-- Scoring Adjustments removed (feature retired 2026-09-30). The rows that
-- existed were exported to prisma/backups/scoring_adjustments_2026-09-30.json
-- before this ran. Idempotent, like the other recent migrations.
DROP TABLE IF EXISTS "scoring_adjustments";
DROP TYPE IF EXISTS "ScoringAdjustmentTargetType";
-- Remove the retired permission keys from every role.
UPDATE "roles"
SET "permissions" = ARRAY(SELECT p FROM unnest("permissions") AS p WHERE p NOT LIKE 'scoring-adjustments.%')
WHERE EXISTS (SELECT 1 FROM unnest("permissions") AS p WHERE p LIKE 'scoring-adjustments.%');
