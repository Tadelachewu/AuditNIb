import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding } from "@/lib/findings";
import { appendAuditLog } from "@/lib/audit";
import { notifyUsers } from "@/lib/notifications";
import type { FindingClosure } from "@/types";

// District/HO Controller's verification duty (plan doc §3.6; master.txt's
// Close row: "Case closes only when eligible remaining cases/amount are
// fully resolved or authorized closure applies"): closure is deliberately
// not self-service by the Branch Manager who recorded the rectification.
//
// Closing isn't gated to a single "fully RECTIFIED" moment - a controller
// can verify-and-close whatever's currently rectified-but-unclosed at any
// time (closedCases/closedAmount can never get ahead of
// rectifiedCases/rectifiedAmount, since that's exactly what bounds this
// call). The still-unrectified remainder stays open and keeps going
// through rectify/transfer as normal; the finding's status only reaches
// the terminal CLOSED once closing has caught all the way up to
// caseCount/amount - short of that, status keeps tracking rectify/transfer
// progress untouched, since a partial close doesn't change what's still
// owed.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.close");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status === "CLOSED") {
    return NextResponse.json({ error: "This finding is already closed" }, { status: 409 });
  }
  if (existing.status === "RECTIFICATION_RETURNED") {
    return NextResponse.json(
      { error: "This finding was sent back for correction and can't be closed until it's resubmitted" },
      { status: 409 }
    );
  }
  const closableCases = existing.rectifiedCases - existing.closedCases;
  const closableAmount = existing.rectifiedAmount - existing.closedAmount;
  if (closableCases <= 0 && closableAmount <= 0) {
    return NextResponse.json({ error: "Nothing rectified is awaiting closure yet" }, { status: 409 });
  }

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    const closure: FindingClosure = {
      id: uuid(),
      findingId: f.id,
      periodId: f.periodId,
      closedCases: closableCases,
      closedAmount: closableAmount,
      submittedBy: auth.session.userId!,
      submittedByName: auth.session.name!,
      createdAt: new Date().toISOString(),
    };
    current.findingClosures.push(closure);

    f.closedCases += closableCases;
    f.closedAmount += closableAmount;

    const fullyClosed = f.closedCases >= f.caseCount && f.closedAmount >= f.amount;
    if (fullyClosed) {
      transitionFinding(current, f, {
        toStatus: "CLOSED",
        action: "CLOSE",
        userId: auth.session.userId!,
        userName: auth.session.name!,
      });
    } else {
      f.updatedAt = closure.createdAt;
      appendAuditLog(current, {
        userId: auth.session.userId!,
        userName: auth.session.name!,
        action: "PARTIAL_CLOSE",
        entityType: "Finding",
        entityId: f.id,
        newValue: { closedCases: f.closedCases, closedAmount: f.closedAmount },
      });
    }

    if (f.createdBy !== auth.session.userId) {
      notifyUsers(current, [f.createdBy], {
        type: "CLOSED",
        title: fullyClosed ? `${f.reference} closed` : `${f.reference} partially closed`,
        message: fullyClosed
          ? `${auth.session.name} verified and closed this finding.`
          : `${auth.session.name} verified and closed ${closableCases} case(s) / ${f.currency} ${closableAmount.toLocaleString()}. The remaining unrectified balance stays open.`,
        entityType: "Finding",
        entityId: f.id,
      });
    }

    return f;
  });

  return NextResponse.json({ finding: updated });
}
