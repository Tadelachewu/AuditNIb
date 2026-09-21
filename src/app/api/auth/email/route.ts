import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { toSafeUser } from "@/lib/sanitize";

const schema = z.object({
  // Email is mandatory (see User.email in src/types/index.ts + DB NOT NULL
  // constraint). min(1) + email() so the user-facing error on a blank
  // field is "Enter a valid email address" rather than a generic "Required".
  email: z.string().min(1, "Enter a valid email address").email("Enter a valid email address").trim(),
});

// Unlike display name (admin-only - see ProfileClient.tsx's own doc
// comment for why: it's shown in audit-log attribution), email carries no
// such audit-identity weight, so it's the one identity field a user can
// change about themself, same self-service tier as their own password
// (see /api/auth/change-password).
export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { email } = parsed.data;

  const db = await readDb();
  const existing = db.users.find((u) => u.id === auth.session.userId);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (db.users.some((u) => u.id !== existing.id && u.email?.toLowerCase() === email.toLowerCase())) {
    return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
  }

  const updated = await updateDb((current) => {
    const u = current.users.find((x) => x.id === existing.id)!;
    const before = u.email;
    u.email = email;
    u.updatedAt = new Date().toISOString();
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "User",
      entityId: u.id,
      oldValue: { email: before },
      newValue: { email: u.email },
      reason: "Self-service profile update",
    });
    return u;
  });

  return NextResponse.json({ user: toSafeUser(updated) });
}
