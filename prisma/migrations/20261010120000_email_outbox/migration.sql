-- Email queue (docs/email-queue.md): outbox rows written with the
-- notification that caused them, delivered by the worker with retries.

CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTIFICATION',
    "notification_id" TEXT,
    "notification_type" TEXT,
    "recipient_user_id" TEXT,
    "to_address" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "smtp_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_outbox_dedupe_key_key" ON "email_outbox"("dedupe_key");
CREATE INDEX "email_outbox_status_next_attempt_at_priority_idx" ON "email_outbox"("status", "next_attempt_at", "priority");
CREATE INDEX "email_outbox_notification_id_idx" ON "email_outbox"("notification_id");
CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox"("created_at");

CREATE TABLE "email_queue_state" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_reason" TEXT,
    "paused_at" TIMESTAMP(3),
    "paused_by" TEXT,
    "last_run_at" TIMESTAMP(3),
    "last_run_by" TEXT,

    CONSTRAINT "email_queue_state_pkey" PRIMARY KEY ("id")
);

INSERT INTO "email_queue_state" ("id") VALUES ('singleton');
