import { NextResponse } from "next/server";
import { readDb, updateDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";

async function handlePOST() {
  const session = await getSession();

  if (session.isLoggedIn && session.userId) {
    const db = await readDb();
    const user = db.users.find((u) => u.id === session.userId);
    if (user) {
      await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
