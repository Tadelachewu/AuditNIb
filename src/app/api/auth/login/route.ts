import { NextResponse } from "next/server";
import { z } from "zod";
import { readDb, updateDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  const { username, password } = parsed.data;

  const db = readDb();
  const user = db.users.find((u) => u.username.toLowerCase() === username.toLowerCase());

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }
  if (user.status !== "ACTIVE") {
    return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
  }

  const role = db.roles.find((r) => r.code === user.role);
  if (!role || role.status !== "ACTIVE") {
    return NextResponse.json({ error: "Your role has been deactivated. Contact an administrator." }, { status: 403 });
  }

  const loginTime = new Date().toISOString();
  updateDb((current) => {
    const u = current.users.find((x) => x.id === user.id);
    if (u) u.lastLoginAt = loginTime;
    appendAuditLog(current, {
      userId: user.id,
      userName: user.name,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });
  });

  const session = await getSession();
  session.isLoggedIn = true;
  session.userId = user.id;
  session.username = user.username;
  session.name = user.name;
  session.role = user.role;
  session.roleName = role.name;
  session.orgScope = role.orgScope;
  // Resolved from whatever's actually stored on the role, same as any
  // other role - ADMIN's permissions can be narrowed (see PATCH
  // .../api/admin/roles/[id]), so forcing every permission here would make
  // that narrowing silently ineffective. One consequence: adding a new
  // page/action to the registry no longer auto-grants it to ADMIN - an
  // existing Administrator (who still holds roles.manage, always
  // guaranteed) needs to check the new box the same as for any role.
  session.permissions = role.permissions;
  session.districtId = user.districtId ?? null;
  session.branchId = user.branchId ?? null;
  await session.save();

  return NextResponse.json({ user: toSafeUser({ ...user, lastLoginAt: loginTime }) });
}
