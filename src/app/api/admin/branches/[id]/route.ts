import { NextResponse } from "next/server";
import { z } from "zod";
import { requireToggleOrEditPermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  districtId: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const auth = await requireToggleOrEditPermission("branches", parsed.data);
  if (!auth.ok) return auth.response;

  const db = readDb();
  const existing = db.branches.find((b) => b.id === id);
  if (!existing) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  if (parsed.data.districtId && !db.districts.some((d) => d.id === parsed.data.districtId)) {
    return NextResponse.json({ error: "Selected district does not exist" }, { status: 400 });
  }
  const before = { name: existing.name, districtId: existing.districtId, status: existing.status };

  const updated = updateDb((current) => {
    const b = current.branches.find((x) => x.id === id)!;
    if (parsed.data.name !== undefined) b.name = parsed.data.name;
    if (parsed.data.districtId !== undefined) b.districtId = parsed.data.districtId;
    if (parsed.data.status !== undefined) b.status = parsed.data.status;
    b.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "Branch",
      entityId: b.id,
      oldValue: before,
      newValue: { name: b.name, districtId: b.districtId, status: b.status },
    });
    return b;
  });

  return NextResponse.json({ branch: updated });
}
