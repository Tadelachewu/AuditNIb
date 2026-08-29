import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, assertPeriodWritable } from "@/lib/findings";
import { usersWithFindingsPermission, notifyUsers } from "@/lib/notifications";

const RETURNABLE_STATUSES = ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"];

const returnSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
});

// The District/HO Controller's verification step can go two ways, not
// just "close it": if the recorded rectification itself has a problem
// (wrong amount, insufficient evidence, wrong case), they send it back to
// the Branch Manager instead - gated by the same `findings.close`
// authority as closing itself, since this is the other half of the same
// "verify" duty. Blocks close/partial-close/transfer until the Branch
// Manager addresses it (rectify again, or the explicit
// resubmit-rectification action) and it's re-verified - see
// RECTIFICATION_RETURNED in src/types/index.ts.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.close");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = returnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { reason } = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!RETURNABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This finding has no recorded rectification awaiting verification" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    transitionFinding(current, f, {
      toStatus: "RECTIFICATION_RETURNED",
      action: "RETURN_RECTIFICATION",
      userId: auth.session.userId!,
      userName: auth.session.name!,
      reason,
    });

    const branchRecipients = usersWithFindingsPermission(current, "rectify", { branchId: f.branchId });
    if (branchRecipients.length > 0) {
      notifyUsers(current, branchRecipients, {
        type: "RECTIFICATION_RETURNED",
        title: `${f.reference} sent back for correction`,
        message: `${auth.session.name}: ${reason}`,
        entityType: "Finding",
        entityId: f.id,
      });
    }

    return f;
  });

  return NextResponse.json({ finding: updated });
}
