import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { submitFinding, assertPeriodWritable, assertPeriodOpenForSubmission } from "@/lib/findings";
import { notifyFindingSubmitted } from "@/lib/notifications";
import { withApiHandler } from "@/lib/api/handler";

const SUBMITTABLE_STATUSES = ["DRAFT", "RETURNED"];

async function handlePOST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.submit");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  // Ownership, not just org scope - same reasoning as [id]/route.ts's own
  // PATCH/DELETE checks: only the person who registered it can submit it.
  if (existing.createdBy !== auth.session.userId) {
    return NextResponse.json({ error: "You can only submit findings you registered yourself" }, { status: 403 });
  }

  if (!SUBMITTABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "Only draft or returned findings can be submitted" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError, code: "PERIOD_LOCKED" }, { status: 409 });

  const windowError = assertPeriodOpenForSubmission(db, existing.periodId);
  if (windowError) return NextResponse.json({ error: windowError }, { status: 409 });

  const updated = await updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    const registeredByBankScope = auth.session.orgScope === "BANK";
    submitFinding(current, f, auth.session.userId!, auth.session.name!, { registeredByBankScope });
    // Whoever must act next: district reviewers, the bank-wide approvers, or the branch.
    notifyFindingSubmitted(current, f, auth.session.name!);
    return f;
  });

  return NextResponse.json({ finding: updated });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
