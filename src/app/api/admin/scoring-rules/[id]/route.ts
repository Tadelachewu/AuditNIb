import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  active: z.boolean(),
});

// Only "active" can change on an existing scoring rule - activating one
// version deactivates every other, since exactly one rule (or none) may be
// live at a time.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("scoring-rules.activate");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const db = readDb();
  const existing = db.scoringRules.find((r) => r.id === id);
  if (!existing) return NextResponse.json({ error: "Scoring rule not found" }, { status: 404 });

  const updated = updateDb((current) => {
    if (parsed.data.active) {
      current.scoringRules.forEach((r) => (r.active = r.id === id));
    } else {
      const r = current.scoringRules.find((x) => x.id === id)!;
      r.active = false;
    }
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: parsed.data.active ? "ACTIVATE" : "DEACTIVATE",
      entityType: "ScoringRule",
      entityId: id,
      oldValue: { active: existing.active },
      newValue: { active: parsed.data.active },
    });
    return current.scoringRules.find((x) => x.id === id)!;
  });

  return NextResponse.json({ scoringRule: updated });
}
