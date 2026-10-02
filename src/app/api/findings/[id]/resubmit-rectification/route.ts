import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding } from "@/lib/findings";
import { notifyFindingsPermissionHolders } from "@/lib/notifications";
import type { FindingStatus } from "@/types";
import { withApiHandler } from "@/lib/api/handler";

// The explicit "I've addressed it" step out of RECTIFICATION_RETURNED,
// for when the correction didn't involve recording more
// rectifiedCases/rectifiedAmount (e.g. it was an evidence or note issue) -
// recording new rectification while returned already moves the status
// forward on its own (see RECTIFIABLE_STATUSES in rectify/route.ts); this
// covers the case where there's nothing numeric left to add. Re-derives
// RECTIFIED vs PARTIALLY_RECTIFIED from the finding's existing (unchanged)
// totals, same computation the rectify route itself uses. The
// nothingRectifiedYet branch below (-> SENT_TO_BRANCH_MANAGER) is a
// defensive fallback, not a reachable case today - return-rectification/
// route.ts's RETURNABLE_STATUSES no longer accepts a finding with zero
// ever rectified, so RECTIFICATION_RETURNED can no longer be reached with
// nothing on record - but landing here with zero would be a lie
// (PARTIALLY_RECTIFIED implies something was rectified) if that ever
// changes, so this stays a safe default rather than assuming it can't.
async function handlePOST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.rectify");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "RECTIFICATION_RETURNED") {
    return NextResponse.json({ error: "This finding isn't awaiting resubmission" }, { status: 409 });
  }

  // A locked period only blocks submission - not this action.

  const updated = await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
