-- Appearance is no longer configurable: the app uses one fixed look
-- (Verdana, compact text, high-contrast secondary text, page-coloured
-- header/sidebar) defined in src/app/globals.css. Idempotent.
ALTER TABLE "settings" DROP COLUMN IF EXISTS "typography";
