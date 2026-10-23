-- Communications Cc (docs/communications.md): a recipient who got a copy.
-- Existing recipients are To (false).
ALTER TABLE "communication_recipients" ADD COLUMN "is_cc" BOOLEAN NOT NULL DEFAULT false;
