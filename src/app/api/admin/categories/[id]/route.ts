import { NextResponse } from "next/server";
import { z } from "zod";
import { requireToggleOrEditPermission, requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  scored: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const auth = await requireToggleOrEditPermission("categories", parsed.data, "active");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const existing = db.categories.find((c) => c.id === id);
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  const before = { name: existing.name, scored: existing.scored, active: existing.active };

  const updated = updateDb((current) => {
    const c = current.categories.find((x) => x.id === id)!;
    if (parsed.data.name !== undefined) c.name = parsed.data.name;
    if (parsed.data.scored !== undefined) c.scored = parsed.data.scored;
    if (parsed.data.active !== undefined) c.active = parsed.data.active;
    c.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "ClassifiedCategory",
      entityId: c.id,
      oldValue: before,
      newValue: { name: c.name, scored: c.scored, active: c.active },
    });
    return c;
  });

  return NextResponse.json({ category: updated });
}

// See the Districts DELETE handler for the general reasoning. Blocked with
// 409 if any scoring rule (any version, active or not) still references
// this category.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("categories.delete");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  const existing = db.categories.find((c) => c.id === id);
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });

  const ruleCount = db.scoringRules.filter((r) => r.categories.includes(id)).length;
  if (ruleCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${ruleCount} scoring rule version(s) reference this category.` },
      { status: 409 }
    );
  }

  updateDb((current) => {
    current.categories = current.categories.filter((c) => c.id !== id);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "DELETE",
      entityType: "ClassifiedCategory",
      entityId: id,
      oldValue: existing,
    });
  });

  return NextResponse.json({ ok: true });
}
