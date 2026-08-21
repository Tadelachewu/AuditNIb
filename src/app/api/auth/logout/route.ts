import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { appendAuditLog } from "@/lib/audit";

export async function POST() {
  const session = await getSession();

  if (session.isLoggedIn && session.userId) {
    const db = readDb();
    const user = db.users.find((u) => u.id === session.userId);
    if (user) {
      updateDb((current) => {
        appendAuditLog(current, {
          userId: user.id,
          userName: user.name,
          action: "LOGOUT",
          entityType: "User",
          entityId: user.id,
        });
      });
    }
  }

  session.destroy();
  return NextResponse.json({ ok: true });
}
