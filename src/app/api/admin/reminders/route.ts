import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";
import { getReminderStatus, runRemindersIfDue } from "@/lib/reminders";

/**
 * Settings -> Rectification Reminders (docs/rectification-reminders.md).
 *
 * GET  -> ReminderStatus: installed, today's run done or not, the next run,
 *         how many findings are overdue now, the last runs (Settings > View).
 * POST -> "Run now": reminds every overdue finding at once, whatever the
 *         time or weekday (Settings > Edit). A finding reminded within the
 *         threshold is still skipped, so it can't be used to spam.
 */
async function handleGET() {
  const auth = await requirePermission("settings.view");
  if (!auth.ok) return auth.response;
  return NextResponse.json(await getReminderStatus());
}

async function handlePOST() {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;

  const result = await runRemindersIfDue({ trigger: "manual" });
  if (result.skipped === "not-installed") {
    return NextResponse.json({ error: "Scheduled reminders aren't installed on this database yet - apply the migration first (see docs/rectification-reminders.md)." }, { status: 409 });
  }
  if (result.skipped === "disabled") {
    return NextResponse.json({ error: "Rectification reminders are switched off - switch them on and save first." }, { status: 409 });
  }
  if (result.skipped === "busy") return NextResponse.json({ error: "A reminder run is in progress - try again in a moment." }, { status: 409 });
  if (!result.ran || !result.run) return NextResponse.json({ error: "The reminders couldn't be sent. Please try again." }, { status: 500 });

  const run = result.run;
  await updateDb((current) => {
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "REMINDERS_RUN_NOW",
      entityType: "ReminderRun",
      entityId: run.id,
      newValue: { findings: run.remindedFindings, users: run.notifiedUsers, references: run.findingReferences },
    });
  });
  return NextResponse.json({ run, status: await getReminderStatus() });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
