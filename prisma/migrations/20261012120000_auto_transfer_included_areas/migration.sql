-- Automatic transfer: the ticked operation areas are now the ones that ARE
-- transferred (included), not the ones left behind (excluded).
--
-- Existing settings keep their behaviour: every operation area known today
-- (the configured list plus any value used on a finding) that was NOT excluded
-- becomes included. With no settings row yet (everything was transferred), one
-- is created with every known area included.

ALTER TABLE "auto_transfer_config" ADD COLUMN "included_operation_areas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

INSERT INTO "auto_transfer_config" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

WITH known AS (
  SELECT DISTINCT ON (lower(regexp_replace(btrim(a), '\s+', ' ', 'g'))) btrim(a) AS area,
         lower(regexp_replace(btrim(a), '\s+', ' ', 'g')) AS norm
  FROM (
    SELECT unnest("operation_areas") AS a FROM "settings"
    UNION ALL
    SELECT "operation_area" FROM "findings"
  ) every_area
  WHERE a IS NOT NULL AND btrim(a) <> ''
  ORDER BY lower(regexp_replace(btrim(a), '\s+', ' ', 'g')), btrim(a)
)
UPDATE "auto_transfer_config" c
SET "included_operation_areas" = COALESCE(
  (
    SELECT array_agg(k.area ORDER BY k.area)
    FROM known k
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(c."excluded_operation_areas") AS x
      WHERE lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) = k.norm
    )
  ),
  ARRAY[]::TEXT[]
);

ALTER TABLE "auto_transfer_config" DROP COLUMN "excluded_operation_areas";
