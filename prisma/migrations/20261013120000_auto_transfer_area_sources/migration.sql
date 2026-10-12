-- Automatic transfer: each operation area now says WHICH SOURCES of findings
-- (Internal Control, Internal Audit, ...) are transferred automatically.
--
-- Existing settings keep their behaviour: every area that was ticked gets
-- every source that exists today.

ALTER TABLE "auto_transfer_config" ADD COLUMN "included_area_sources" JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE "auto_transfer_config" c
SET "included_area_sources" = COALESCE(
  (
    SELECT jsonb_agg(
             jsonb_build_object(
               'operationArea', a,
               'sourceIds', (SELECT COALESCE(jsonb_agg(s."id" ORDER BY s."code"), '[]'::jsonb) FROM "sources" s)
             )
             ORDER BY a
           )
    FROM unnest(c."included_operation_areas") AS a
  ),
  '[]'::jsonb
);

ALTER TABLE "auto_transfer_config" DROP COLUMN "included_operation_areas";
