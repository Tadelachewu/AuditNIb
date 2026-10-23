-- A returned rectification now goes straight back to outstanding: the branch
-- simply records it again with Record Rectification (no separate resubmit).
-- Findings returned before this change: release their returned part the same way.

-- Itemized: the returned cases become outstanding again.
UPDATE "finding_cases"
SET "status" = 'OUTSTANDING',
    "returned" = false,
    "rectification_id" = NULL,
    "rectified_at" = NULL,
    "rectified_by" = NULL,
    "rectified_by_name" = NULL
WHERE "returned" = true;

-- Totals: the returned part is no longer counted as rectified.
UPDATE "findings"
SET "rectified_cases" = GREATEST("rectified_cases" - "returned_cases", "closed_cases"),
    "rectified_amount" = GREATEST("rectified_amount" - "returned_amount", "closed_amount"),
    "returned_cases" = 0,
    "returned_amount" = 0
WHERE "returned_cases" > 0 OR "returned_amount" > 0;
