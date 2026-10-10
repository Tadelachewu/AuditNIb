import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";
import { cancelEmail, deliverDue, getEmailQueueStatus, pauseEmailQueue, resumeEmailQueue, retryFailedEmails } from "@/lib/emailQueue";

/**
 * Settings -> Email Queue (docs/email-queue.md).
 *
 * GET  -> EmailQueueStatus: counts, oldest waiting, last worker run, pause
 *         state and the failed emails (Settings > View).
 * POST -> { action: "pause" | "resume" | "run" | "retry-all" }
 *         { action: "retry" | "cancel", id }            (Settings > Edit)
 */
async function handleGET() {
  const auth = await requirePermission("settings.view");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getEmailQueueStatus());
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pause", "resume", "run", "retry-all"]) }),
  z.object({ action: z.enum(["retry", "cancel"]), id: z.string().min(1).max(100) }),
]);

async function handlePOST(request: Request) {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const body = parsed.data;
  const by = auth.session.name ?? "administrator";

  const before = await getEmailQueueStatus();
  if (!before.installed) {
    return NextResponse.json({ error: "The email queue isn't installed on this database yet - apply its migration first (see docs/email-queue.md)." }, { status: 409 });
  }

  let affected = 0;
  if ("id" in body) affected = body.action === "retry" ? await retryFailedEmails(body.id) : await cancelEmail(body.id);
  else if (body.action === "pause") await pauseEmailQueue(by);
  else if (body.action === "resume") await resumeEmailQueue(by);
  else if (body.action === "run") {
    const run = await deliverDue({ by: "admin" });
    affected = run.sent + (run.handedOff ?? 0);
  }
  else affected = await retryFailedEmails("all");

  if (body.action !== "run") {
    await updateDb((current) => {
      appendAuditLog(current, {
        userId: auth.session.userId!,
        userName: by,
        action: `EMAIL_QUEUE_${body.action.toUpperCase().replace("-", "_")}`,
        entityType: "EmailQueue",
        entityId: "id" in body ? body.id : "singleton",
        newValue: { affected },
      });
    });
  }
  return NextResponse.json({ affected, status: await getEmailQueueStatus() });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
