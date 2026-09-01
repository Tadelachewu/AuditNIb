import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, assertPeriodWritable } from "@/lib/findings";
import { notifyFindingsPermissionHolders, notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";
import type { FindingStatus, RectificationEntry, FindingCase } from "@/types";

// TRANSFERRED is included because a finding that's had its outstanding
// balance carried into a new (open) period by the Transfer Engine
// (src/app/api/findings/[id]/transfer/route.ts) must still be rectifiable
// there - transfer moves the finding forward, it doesn't pause its
// workflow. RECTIFICATION_RETURNED is included so a Branch Manager who
// got sent back for correction (return-rectification/route.ts) can
// address it by recording more rectification directly - the usual
// fullyRectified computation below naturally moves it back to
// PARTIALLY_RECTIFIED/RECTIFIED, out of the returned state.
const RECTIFIABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED", "RECTIFICATION_RETURNED"];

// rectifiedCases/rectifiedAmount are used for a plain (non-itemized)
// finding; caseIds is used instead for one whose cases are itemized
// (FindingCase rows exist) - see the branch below. Exactly one of the two
// input shapes applies to any given finding, decided by whether it has
// any FindingCase rows at all, not by which fields the caller happens to
// send.
const rectifySchema = z.object({
  rectifiedCases: z.number().int().min(0).optional(),
  rectifiedAmount: z.number().min(0).optional(),
  caseIds: z.array(z.string()).optional(),
  note: z.string().optional(),
});

// Branch Manager's "Record corrective actions... Enter rectified case
// counts" (icfms.txt), also usable by the Branch Internal Controller
// ("Verify rectifications"). Cases and amount are validated independently
// against what's still outstanding - plan doc §3.5's own acceptance
// example (3 cases/45,000 -> 1 case/10,000 rectified, 2 cases/35,000
// outstanding) is exactly this rule.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.rectify");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = rectifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!RECTIFIABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This finding isn't awaiting rectification" }, { status: 409 });
  }

  // Once a period locks, a still-outstanding finding needs the Transfer
  // Engine (.../transfer) to carry its balance into a new period before it
  // can be rectified further - this is the intended BRD behavior (§13),
  // not a bug: locking is what forces that path.
  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  // A finding with FindingCase rows (Document_3 §12/§34's itemization)
  // must be rectified by picking specific still-outstanding cases, not by
  // typing a count/amount that merely happens to add up - that's what
  // actually makes "only Case 2" a stored fact. A non-itemized finding
  // keeps the original plain-number flow untouched.
  const existingCases = db.findingCases.filter((fc) => fc.findingId === id);
  let rectifiedCases: number;
  let rectifiedAmount: number;
  let selectedCaseIds: string[] | undefined;

  if (existingCases.length > 0) {
    if (!input.caseIds || input.caseIds.length === 0) {
      return NextResponse.json({ error: "This finding's cases are itemized - select which case(s) to rectify" }, { status: 400 });
    }
    const byId = new Map(existingCases.map((fc) => [fc.id, fc]));
    const selected = input.caseIds.map((caseId) => byId.get(caseId));
    if (selected.some((fc) => !fc)) {
      return NextResponse.json({ error: "One or more selected cases don't belong to this finding" }, { status: 400 });
    }
    const notOutstanding = (selected as FindingCase[]).filter((fc) => fc.status !== "OUTSTANDING");
    if (notOutstanding.length > 0) {
      return NextResponse.json(
        { error: `Case(s) ${notOutstanding.map((fc) => fc.seq).join(", ")} are already rectified` },
        { status: 409 }
      );
    }
    rectifiedCases = selected.length;
    rectifiedAmount = (selected as FindingCase[]).reduce((sum, fc) => sum + fc.amount, 0);
    selectedCaseIds = input.caseIds;
  } else {
    if (input.rectifiedCases === undefined || input.rectifiedAmount === undefined) {
      return NextResponse.json({ error: "Enter a rectified case count and amount" }, { status: 400 });
    }
    if (input.rectifiedCases === 0 && input.rectifiedAmount === 0) {
      return NextResponse.json({ error: "Enter at least a rectified case count or amount" }, { status: 400 });
    }
    rectifiedCases = input.rectifiedCases;
    rectifiedAmount = input.rectifiedAmount;
  }

  const outstandingCases = existing.caseCount - existing.rectifiedCases;
  const outstandingAmount = existing.amount - existing.rectifiedAmount;
  if (rectifiedCases > outstandingCases) {
    return NextResponse.json(
      { error: `Rectified cases (${rectifiedCases}) cannot exceed the outstanding ${outstandingCases}` },
      { status: 400 }
    );
  }
  if (rectifiedAmount > outstandingAmount) {
    return NextResponse.json(
      { error: `Rectified amount (${rectifiedAmount}) cannot exceed the outstanding ${outstandingAmount}` },
      { status: 400 }
    );
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    const now = new Date().toISOString();

    const entry: RectificationEntry = {
      id: uuid(),
      findingId: f.id,
      periodId: f.periodId,
      rectifiedCases,
      rectifiedAmount,
      note: input.note,
      submittedBy: auth.session.userId!,
      submittedByName: auth.session.name!,
      createdAt: now,
      caseIds: selectedCaseIds,
    };
    current.rectifications.push(entry);

    if (selectedCaseIds) {
      for (const fc of current.findingCases) {
        if (selectedCaseIds.includes(fc.id)) {
          fc.status = "RECTIFIED";
          fc.rectificationId = entry.id;
          fc.rectifiedAt = now;
          fc.rectifiedBy = auth.session.userId!;
          fc.rectifiedByName = auth.session.name!;
        }
      }
    }

    f.rectifiedCases += rectifiedCases;
    f.rectifiedAmount += rectifiedAmount;

    const fullyRectified = f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount;
    const toStatus: FindingStatus = fullyRectified ? "RECTIFIED" : "PARTIALLY_RECTIFIED";
    transitionFinding(current, f, { toStatus, action: "RECTIFY", userId: auth.session.userId!, userName: auth.session.name! });

    // Every rectification entry - partial or full - notifies the other
    // findings.rectify holder(s) at this same branch (Branch Manager and
    // Branch Internal Controller both hold it - icfms.txt: the Controller's
    // job includes "verify rectifications"), excluding whoever just
    // recorded it, so the other party always has something to acknowledge
    // (see notifications/[id]/read for "mark as seen").
    const branchRecipients = usersWithFindingsPermission(current, "rectify", { branchId: f.branchId }).filter(
      (userId) => userId !== auth.session.userId
    );
    if (branchRecipients.length > 0) {
      notifyUsers(current, branchRecipients, {
        type: "RECTIFIED",
        title: `${f.reference} rectification recorded`,
        message: `${auth.session.name} recorded ${rectifiedCases} case(s) / ${f.currency} ${rectifiedAmount.toLocaleString()} rectified.${
          fullyRectified ? " Fully rectified." : ""
        }`,
        entityType: "Finding",
        entityId: f.id,
      });
    }

    // master.txt §12: notify on "rectification" - the District Controller
    // is the one with something to act on next (verify or return for
    // correction), whether this entry finished the job or was only
    // partial - not just once fully rectified, since a partial entry still
    // has verifiable progress waiting.
    notifyFindingsPermissionHolders(current, ["verify-rectification", "return-rectification"], { districtId: f.districtId }, {
      type: "RECTIFIED",
      title: fullyRectified ? `${f.reference} fully rectified` : `${f.reference} partially rectified`,
      message: fullyRectified
        ? `${auth.session.name} recorded the final rectification. Ready for district verification.`
        : `${auth.session.name} recorded ${rectifiedCases} case(s) / ${f.currency} ${rectifiedAmount.toLocaleString()} rectified. Ready for district verification.`,
      entityType: "Finding",
      entityId: f.id,
    });

    return f;
  });

  return NextResponse.json({ finding: updated });
}
