import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding } from "@/lib/findings";
import { notifyFindingsPermissionHolders } from "@/lib/notifications";
import { withApiHandler } from "@/lib/api/handler";
import { ConflictError } from "@/lib/errors";
import { planResubmit, recordedSinceReturn, type ResubmitChoice } from "@/lib/rectificationResubmit";

// The resubmitted part goes back to District for verification (its earlier
// verification is cleared, except what's closed), then HO - the normal flow.
// What to resubmit: nothing sent = all of it (as before); itemized findings
// pick the cases, others give the number of cases and the amount. What isn't
// resubmitted goes back to outstanding (src/lib/rectificationResubmit.ts).
const bodySchema = z
  .union([
    z.object({ keepCaseIds: z.array(z.string().min(1)).max(10_000) }),
    z.object({ keepCases: z.number().int().min(0), keepAmount: z.number().min(0) }),
    z.object({}).strict(),
  ])
  .optional();

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
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const text = await request.text();
  const parsed = bodySchema.safeParse(text.trim() ? JSON.parse(text) : undefined);
  if (!parsed.success) return NextResponse.json({ error: "Choose what to resubmit" }, { status: 400 });
  const body = parsed.data;
  const choice: ResubmitChoice =
    body && "keepCaseIds" in body ? { kind: "cases", keepCaseIds: body.keepCaseIds } : body && "keepCases" in body ? { kind: "totals", keepCases: body.keepCases, keepAmount: body.keepAmount } : { kind: "all" };
  const first = planResubmit(existing, db.findingCases.filter((c) => c.findingId === id), choice, recordedSinceReturn(id, db.findingTransitions, db.rectifications, db.findingCases));
  if (!first.ok) return NextResponse.json({ error: first.problem }, { status: 400 });

  const updated = await updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    // Re-checked on the data being changed (another user may have acted meanwhile).
    if (f.status !== "RECTIFICATION_RETURNED") throw new ConflictError("This finding isn't awaiting resubmission any more - reload the page");
    const r = planResubmit(f, current.findingCases.filter((c) => c.findingId === id), choice, recordedSinceReturn(id, current.findingTransitions, current.rectifications, current.findingCases));
    if (!r.ok) throw new ConflictError(r.problem);
    const { plan } = r;
    const releasedCases = f.rectifiedCases - plan.rectifiedCases;
    const releasedAmount = Math.round((f.rectifiedAmount - plan.rectifiedAmount) * 100) / 100;
    // The part not resubmitted goes back to outstanding.
    f.rectifiedCases = plan.rectifiedCases;
    f.rectifiedAmount = plan.rectifiedAmount;
    f.districtVerifiedCases = plan.districtVerifiedCases;
    f.districtVerifiedAmount = plan.districtVerifiedAmount;
    // Resubmitted: nothing is "returned" any more.
    f.returnedCases = 0;
    f.returnedAmount = 0;
    for (const c of current.findingCases) if (c.findingId === id) c.returned = false;
    for (const c of current.findingCases) {
      if (!plan.releaseCaseIds.includes(c.id)) continue;
      c.status = "OUTSTANDING";
      c.rectificationId = undefined;
      c.rectifiedAt = undefined;
      c.rectifiedBy = undefined;
      c.rectifiedByName = undefined;
    }
    transitionFinding(current, f, {
      toStatus: plan.status,
      action: "RESUBMIT_RECTIFICATION",
      reason: releasedCases > 0 || releasedAmount > 0 ? `Resubmitted ${plan.rectifiedCases} case(s) / ${plan.rectifiedAmount}; ${releasedCases} case(s) / ${releasedAmount} back to outstanding` : undefined,
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
