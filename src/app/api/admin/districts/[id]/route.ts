import { NextResponse } from "next/server";
import { z } from "zod";
import { requireToggleOrEditPermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const auth = await requireToggleOrEditPermission("districts", parsed.data);
  if (!auth.ok) return auth.response;

  const db = readDb();
  const existing = db.districts.find((d) => d.id === id);
  if (!existing) return NextResponse.json({ error: "District not found" }, { status: 404 });
  const before = { name: existing.name, status: existing.status };

  const updated = updateDb((current) => {
    const d = current.districts.find((x) => x.id === id)!;
    if (parsed.data.name !== undefined) d.name = parsed.data.name;
    if (parsed.data.status !== undefined) d.status = parsed.data.status;
    d.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "District",
      entityId: d.id,
      oldValue: before,
      newValue: { name: d.name, status: d.status },
    });
    return d;
  });

  return NextResponse.json({ district: updated });
}
