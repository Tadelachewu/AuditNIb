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
        // Sign out on the SERVER too: every cookie issued for this sign-in -
        // including a copy someone may have taken - stops working at once,
        // not just the one in this browser (docs/session-security.md).
        const u = current.users.find((x) => x.id === user.id);
        if (u && (u.sessionVersion ?? 1) === (session.sessionVersion ?? 1)) u.sessionVersion = (u.sessionVersion ?? 1) + 1;
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
