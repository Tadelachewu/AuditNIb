import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  reason: z.string().min(5, "A reason of at least 5 characters is required"),
});

// Activate/deactivate only - value/reason/target/period are permanent once
// recorded (see PHASE1.md/PHASE3.md). Deactivating stops this adjustment
// from overriding computePerformance() (src/lib/findings.ts) without
// erasing the record; re-activating resumes the override. A reason is
// mandatory here too, same as the adjustment's own creation and reporting-
// period lock/unlock - this changes what score a dashboard shows, same
// class of action.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("scoring-adjustments.toggle-status");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { status, reason } = parsed.data;

  const db = await readDb();
  const existing = db.scoringAdjustments.find((a) => a.id === id);
  if (!existing) return NextResponse.json({ error: "Scoring adjustment not found" }, { status: 404 });
  if (existing.status === status) {
    return NextResponse.json({ error: `Already ${status === "ACTIVE" ? "active" : "inactive"}` }, { status: 409 });
  }

  const updated = await updateDb((current) => {
    const a = current.scoringAdjustments.find((x) => x.id === id)!;
    const before = a.status;
    a.status = status;
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "ScoringAdjustment",
      entityId: a.id,
      oldValue: { status: before },
      newValue: { status: a.status },
      reason,
    });
    return a;
  });

  return NextResponse.json({ scoringAdjustment: updated });
}
