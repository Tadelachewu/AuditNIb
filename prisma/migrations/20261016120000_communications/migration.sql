-- Communications (docs/communications.md): messages between users (not
-- administrators), to all users or selected users, with optional PDF /
-- Word / Excel attachments; each recipient is notified and emailed.

CREATE TABLE "communications" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "sender_id" TEXT NOT NULL,
    "sender_name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "to_all" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "withdrawn_at" TIMESTAMP(3),

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_recipients" (
    "id" TEXT NOT NULL,
    "communication_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "communication_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_attachments" (
    "id" TEXT NOT NULL,
    "communication_id" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "communications_thread_id_idx" ON "communications"("thread_id");
CREATE INDEX "communications_sender_id_created_at_idx" ON "communications"("sender_id", "created_at");
CREATE UNIQUE INDEX "communication_recipients_communication_id_user_id_key" ON "communication_recipients"("communication_id", "user_id");
CREATE INDEX "communication_recipients_user_id_removed_at_idx" ON "communication_recipients"("user_id", "removed_at");
CREATE INDEX "communication_attachments_communication_id_idx" ON "communication_attachments"("communication_id");
CREATE INDEX "communication_attachments_uploaded_by_communication_id_idx" ON "communication_attachments"("uploaded_by", "communication_id");

ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing role except the Administrator can read and send messages
-- (Administrators are excluded from Communications entirely). Roles can be
-- narrowed later in Roles & Permissions.
UPDATE "roles"
SET "permissions" = array_cat("permissions", ARRAY['communications.view', 'communications.send']::TEXT[])
WHERE "code" <> 'ADMIN' AND NOT ('communications.view' = ANY("permissions"));
