import { NextResponse } from "next/server";
import { z } from "zod";
import { zReason } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transferFinding } from "@/lib/findings";
import { notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import { withApiHandler } from "@/lib/api/handler";

// Every non-terminal status is transferable - only CLOSED is excluded.
// See findings.ts's AUTO_TRANSFERABLE_STATUSES for the full reasoning
// (kept in lockstep with this array by hand, not by import) and
// transferFinding()'s own doc comment for why this doesn't touch the
// source period's lock.
const TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "REVERSED", "PARTIALLY_RECTIFIED", "RECTIFIED", "RECTIFICATION_RETURNED", "TRANSFERRED"];

const transferSchema = z.object({
  toPeriodId: z.string().min(1),
  reason: zReason(),
});

// icfms.txt / master.txt §8: "Transfer outstanding cases to the next
// reporting period" - District Controller's action (see db.ts's
// districtControllerPermissions). Deliberately skips assertPeriodWritable()
// on the *source* period: transfer is the intended path once a period
// locks with the finding still outstanding.
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.transfer");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = transferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!TRANSFERABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This finding has no outstanding balance to transfer" }, { status: 409 });
  }

  if (input.toPeriodId === existing.periodId) {
    return NextResponse.json({ error: "Destination period must differ from the current period" }, { status: 400 });
  }
  const destination = db.reportingPeriods.find((p) => p.id === input.toPeriodId);
  if (!destination) return NextResponse.json({ error: "Destination period not found" }, { status: 404 });
  // Manual transfer works in both directions: any other period, earlier or
  // later, open or locked (a locked period only blocks submission). Period figures stay correct for return trips because
  // findingResidencyInPeriod() credits each stay separately and sums them.
  // Automatic transfer on lock stays forward-only (autoTransferOnLock()).

  const updated = await updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    const { backToOriginal } = transferFinding(current, f, {
      toPeriodId: input.toPeriodId,
      reason: input.reason,
      userId: auth.session.userId!,
      userName: auth.session.name!,
    });

    // Back in its original period, the branch has it to rectify again - tell them too.
    const recipients = new Set([
      f.createdBy,
      ...usersWithFindingsPermission(current, "transfer", { districtId: f.districtId }),
      ...(backToOriginal ? usersWithFindingsPermission(current, "rectify", { branchId: f.branchId }) : []),
    ]);
    notifyUsers(current, [...recipients], {
      type: "TRANSFERRED",
      title: backToOriginal ? `${f.reference} moved back to its original period ${destination.code}` : `${f.reference} transferred to ${destination.code}`,
      message: backToOriginal
        ? `${auth.session.name} moved it back to ${destination.code}, the period it was reported in - status: ${f.status === "PARTIALLY_RECTIFIED" ? "Partially Rectified" : "Sent to Branch Manager"}: ${input.reason}`
        : `${auth.session.name} moved the outstanding balance to ${destination.code}: ${input.reason}`,
      entityType: "Finding",
      entityId: f.id,
    });

    return f;
  });

  return NextResponse.json({ finding: updated });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
