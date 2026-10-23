-- Returned rectifications (src/lib/rectificationResubmit.ts): the part of a
-- finding returned for correction and not resubmitted yet - still counted as
-- rectified, out of the workflow until the manager resubmits it.

ALTER TABLE "findings" ADD COLUMN "returned_cases" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "findings" ADD COLUMN "returned_amount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "finding_cases" ADD COLUMN "returned" BOOLEAN NOT NULL DEFAULT false;

-- Findings returned before this change: everything not closed is the
-- returned part, verified again after resubmission.
UPDATE "findings"
SET "returned_cases" = GREATEST("rectified_cases" - "closed_cases", 0),
    "returned_amount" = GREATEST("rectified_amount" - "closed_amount", 0),
    "district_verified_cases" = "closed_cases",
    "district_verified_amount" = "closed_amount"
WHERE "status" = 'RECTIFICATION_RETURNED';

-- Itemized ones: mark the rectified cases after the closed ones (closures
-- count cases in rectification order), and take the amount from them.
UPDATE "finding_cases" fc
SET "returned" = true
FROM (
  SELECT c."id", c."finding_id",
         ROW_NUMBER() OVER (PARTITION BY c."finding_id" ORDER BY c."rectified_at", c."seq") AS rn,
         f."closed_cases"
  FROM "finding_cases" c
  JOIN "findings" f ON f."id" = c."finding_id"
  WHERE f."status" = 'RECTIFICATION_RETURNED' AND c."status" = 'RECTIFIED'
) x
WHERE fc."id" = x."id" AND x.rn > x."closed_cases";

UPDATE "findings" f
SET "returned_cases" = s.n, "returned_amount" = s.total
FROM (SELECT "finding_id", COUNT(*) AS n, SUM("amount") AS total FROM "finding_cases" WHERE "returned" = true GROUP BY "finding_id") s
WHERE f."id" = s."finding_id";
