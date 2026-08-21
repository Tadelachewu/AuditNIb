import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { resolveOrgAssignment } from "@/lib/org";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";
import { ROLES } from "@/types";

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  districtId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  const existing = db.users.find((u) => u.id === id);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const nextRole = input.role ?? existing.role;
  const wantsOrgChange = input.role !== undefined || input.districtId !== undefined || input.branchId !== undefined;

  let districtId = existing.districtId ?? null;
  let branchId = existing.branchId ?? null;

  if (wantsOrgChange) {
    const assignment = resolveOrgAssignment(
      db,
      {
        role: nextRole,
        districtId: input.districtId !== undefined ? input.districtId : existing.districtId,
        branchId: input.branchId !== undefined ? input.branchId : existing.branchId,
      },
      existing.id
    );
    if (assignment.error) return NextResponse.json({ error: assignment.error }, { status: 409 });
    districtId = assignment.districtId;
    branchId = assignment.branchId;
  }

  const before = { name: existing.name, role: existing.role, status: existing.status, districtId: existing.districtId, branchId: existing.branchId };

  const updated = updateDb((current) => {
    const u = current.users.find((x) => x.id === id)!;
    if (input.name !== undefined) u.name = input.name;
    if (input.status !== undefined) u.status = input.status;
    if (input.password) u.passwordHash = hashPassword(input.password);
    u.role = nextRole;
    u.districtId = districtId;
    u.branchId = branchId;
    u.updatedAt = new Date().toISOString();

    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "User",
      entityId: u.id,
      oldValue: before,
      newValue: { name: u.name, role: u.role, status: u.status, districtId: u.districtId, branchId: u.branchId },
    });

    return u;
  });

  return NextResponse.json({ user: toSafeUser(updated) });
}
