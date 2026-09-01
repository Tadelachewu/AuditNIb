import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
});

// Deliberately narrow: username, role, org unit, and department all carry
// real system consequences (login identity, permissions, singleton-role
// availability, audit attribution) and stay admin-only via
// /api/admin/users/[id]. Display name is the one field with no such
// consequence, so it's the one a user can change about themself.
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const db = readDb();
  const existing = db.users.find((u) => u.id === auth.session.userId);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updated = updateDb((current) => {
    const u = current.users.find((x) => x.id === existing.id)!;
    const before = u.name;
    u.name = parsed.data.name;
    u.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: u.name,
      action: "UPDATE",
      entityType: "User",
      entityId: u.id,
      oldValue: { name: before },
      newValue: { name: u.name },
      reason: "Self-service profile update",
    });
    return u;
  });

  const session = await getSession();
  session.name = updated.name;
  await session.save();

  return NextResponse.json({ user: toSafeUser(updated) });
}
