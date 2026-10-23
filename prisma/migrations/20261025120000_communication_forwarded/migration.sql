-- Communications Forward (docs/communications.md): the message a new message
-- forwards, so both sides see it labelled "Forwarded". Existing messages: none.
ALTER TABLE "communications" ADD COLUMN "forwarded_from_id" TEXT;
