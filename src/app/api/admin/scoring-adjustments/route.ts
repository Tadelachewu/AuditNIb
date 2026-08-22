import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

export async function GET() {
  const auth = await requirePermission("scoring-adjustments.view");
  if (!auth.ok) return auth.response;
  const adjustments = [...readDb().scoringAdjustments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ scoringAdjustments: adjustments });
}

const createSchema = z.object({
  targetType: z.enum(["DISTRICT", "BRANCH"]),
  targetId: z.string().min(1, "Target is required"),
  periodId: z.string().min(1, "Reporting period is required"),
  value: z.number(),
  reason: z.string().min(5, "A reason of at least 5 characters is required"),
});

// A mandatory reason plus an immutable audit-log entry is the compensating
// control for this being a manual override of the computed score.
export async function POST(request: Request) {
  const auth = await requirePermission("scoring-adjustments.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  const targetExists =
    input.targetType === "DISTRICT"
      ? db.districts.some((d) => d.id === input.targetId)
      : db.branches.some((b) => b.id === input.targetId);
  if (!targetExists) return NextResponse.json({ error: "Selected target does not exist" }, { status: 400 });
  if (!db.reportingPeriods.some((p) => p.id === input.periodId)) {
    return NextResponse.json({ error: "Selected reporting period does not exist" }, { status: 400 });
  }

  const adjustment = { id: uuid(), ...input, adjustedBy: auth.session.userId!, createdAt: new Date().toISOString() };

  updateDb((current) => {
    current.scoringAdjustments.push(adjustment);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "ScoringAdjustment",
      entityId: adjustment.id,
      newValue: adjustment,
      reason: input.reason,
    });
  });

  return NextResponse.json({ scoringAdjustment: adjustment }, { status: 201 });
}
