import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { appendAuditLog } from "@/lib/audit";

const schema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

// The one self-service action every user has regardless of role or
// permissions - changing your own password requires no permission key,
// just proof you know the current one. This is what clears
// mustChangePassword (see User.mustChangePassword's doc comment), whether
// that flag came from initial account creation or an admin's reset.
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const db = readDb();
  const existing = db.users.find((u) => u.id === auth.session.userId);
  if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (!verifyPassword(currentPassword, existing.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }

  updateDb((current) => {
    const u = current.users.find((x) => x.id === existing.id)!;
    u.passwordHash = hashPassword(newPassword);
    u.mustChangePassword = false;
    u.updatedAt = new Date().toISOString();
    // Never log password material itself - just that the event happened.
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CHANGE_PASSWORD",
      entityType: "User",
      entityId: u.id,
    });
  });

  // The session's own copy of mustChangePassword (src/proxy.ts's redirect
  // gate) has to be updated in-place here - it was resolved at login time
  // and won't otherwise change until the next login.
  const session = await getSession();
  session.mustChangePassword = false;
  await session.save();

  return NextResponse.json({ ok: true });
}
