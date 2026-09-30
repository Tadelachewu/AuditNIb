-- REVERSED: a reopened finding (closure reversed), handled like
-- SENT_TO_BRANCH_MANAGER by the workflow. Idempotent.
ALTER TYPE "FindingStatus" ADD VALUE IF NOT EXISTS 'REVERSED' AFTER 'SENT_TO_BRANCH_MANAGER';
