-- Communications: formatted messages (rich text editor, docs/communications.md).
-- body keeps the plain text (search, previews, plain-text email); body_html holds
-- the sanitised HTML. Existing messages stay plain text (body_html null).

ALTER TABLE "communications" ADD COLUMN "body_html" TEXT;
