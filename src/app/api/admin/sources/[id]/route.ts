import { NextResponse } from "next/server";
import { z } from "zod";
import { requireToggleOrEditPermission, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const auth = await requireToggleOrEditPermission("sources", parsed.data, "active");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const existing = db.sources.find((s) => s.id === id);
  if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  const before = { name: existing.name, active: existing.active };

  const updated = updateDb((current) => {
    const s = current.sources.find((x) => x.id === id)!;
    if (parsed.data.name !== undefined) s.name = parsed.data.name;
    if (parsed.data.active !== undefined) s.active = parsed.data.active;
    s.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "Source",
      entityId: s.id,
      oldValue: before,
      newValue: { name: s.name, active: s.active },
    });
    return s;
  });

  return NextResponse.json({ source: updated });
}

// See the Districts DELETE handler for the general reasoning. Blocked with
// 409 if any scoring rule (any version, active or not) still references
// this source, since ScoringRule.sources is a plain id array with no
// referential-integrity checking of its own.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("sources.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.sources.find((s) => s.id === id);
  if (!existing) return NextResponse.json({ error: "Source not found" }, { status: 404 });

  const ruleCount = db.scoringRules.filter((r) => r.sources.includes(id)).length;
  if (ruleCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${ruleCount} scoring rule version(s) reference this source.` },
      { status: 409 }
    );
  }

  updateDb((current) => {
    current.sources = current.sources.filter((s) => s.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "Source",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
