import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, assertPeriodWritable } from "@/lib/findings";
import { notifyFindingsPermissionHolders } from "@/lib/notifications";
import type { FindingStatus } from "@/types";

// The explicit "I've addressed it" step out of RECTIFICATION_RETURNED,
// for when the correction didn't involve recording more
// rectifiedCases/rectifiedAmount (e.g. it was an evidence or note issue) -
// recording new rectification while returned already moves the status
// forward on its own (see RECTIFIABLE_STATUSES in rectify/route.ts); this
// covers the case where there's nothing numeric left to add. Re-derives
// RECTIFIED vs PARTIALLY_RECTIFIED vs SENT_TO_BRANCH_MANAGER from the
// finding's existing (unchanged) totals, same computation the rectify
// route itself uses - plus the one case that route never has to handle:
// return-rectification/route.ts can now return a finding that was
// SENT_TO_BRANCH_MANAGER with *zero* ever rectified (approved, then sent
// back before the branch touched it at all). Landing that on
// PARTIALLY_RECTIFIED would be a lie - nothing has been rectified - so it
// goes back to SENT_TO_BRANCH_MANAGER instead, exactly where it was.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.rectify");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "RECTIFICATION_RETURNED") {
    return NextResponse.json({ error: "This finding isn't awaiting resubmission" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    const fullyRectified = f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount;
    const nothingRectifiedYet = f.rectifiedCases === 0 && f.rectifiedAmount === 0;
    const toStatus: FindingStatus = fullyRectified
      ? "RECTIFIED"
      : nothingRectifiedYet
        ? "SENT_TO_BRANCH_MANAGER"
        : "PARTIALLY_RECTIFIED";
    transitionFinding(current, f, {
      toStatus,
      action: "RESUBMIT_RECTIFICATION",
      userId: auth.session.userId!,
      userName: auth.session.name!,
    });

    notifyFindingsPermissionHolders(current, ["verify-rectification", "return-rectification"], { districtId: f.districtId }, {
      type: "RECTIFICATION_RESUBMITTED",
      title: `${f.reference} resubmitted for verification`,
      message: `${auth.session.name} addressed the return reason and resubmitted this finding.`,
      entityType: "Finding",
      entityId: f.id,
    });

    return f;
  });

  return NextResponse.json({ finding: updated });
}
