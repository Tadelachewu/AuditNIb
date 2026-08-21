import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requireRole } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { resolveOrgAssignment } from "@/lib/org";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";
import { ROLES } from "@/types";

export async function GET() {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return auth.response;

  const db = readDb();
  return NextResponse.json({ users: db.users.map(toSafeUser) });
}

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, dashes and underscores"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES),
  districtId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const input = parsed.data;

  const db = readDb();
  if (db.users.some((u) => u.username.toLowerCase() === input.username.toLowerCase())) {
    return NextResponse.json({ error: "That username is already taken" }, { status: 409 });
  }

  const assignment = resolveOrgAssignment(db, { role: input.role, districtId: input.districtId, branchId: input.branchId });
  if (assignment.error) {
    return NextResponse.json({ error: assignment.error }, { status: 409 });
  }

  const now = new Date().toISOString();
  const user = {
    id: uuid(),
    name: input.name,
    username: input.username,
    passwordHash: hashPassword(input.password),
    role: input.role,
    status: "ACTIVE" as const,
    districtId: assignment.districtId,
    branchId: assignment.branchId,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  updateDb((current) => {
    current.users.push(user);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      newValue: { name: user.name, username: user.username, role: user.role },
    });
  });

  return NextResponse.json({ user: toSafeUser(user) }, { status: 201 });
}
