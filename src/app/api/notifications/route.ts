import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { checkRectificationReminders, REMINDER_SCAN_COOLDOWN_MS } from "@/lib/notifications";

// A notification is always scoped to its own recipientUserId, checked
// directly here rather than gated through the page-permission system -
// every logged-in user has notifications, regardless of role.
//
// This is also the lazy trigger point for the time-based Rectification
// Reminder (see checkRectificationReminders()'s own doc comment) - it's
// already polled every 30s by every logged-in user, so it's the cheapest
// place to piggyback a "is a scan due" check without new infrastructure.
// A plain readDb() first avoids paying for updateDb()'s write on every
// poll when a scan isn't due yet.
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const peek = readDb();
  const settings = peek.settings.rectificationReminders;
  const scanDue =
    settings.enabled &&
    (!settings.lastCheckedAt || Date.now() - new Date(settings.lastCheckedAt).getTime() >= REMINDER_SCAN_COOLDOWN_MS);

  const db = scanDue
    ? updateDb((current) => {
        checkRectificationReminders(current);
        return current;
      })
    : peek;

  // Every notification ever sent to this user, unbounded, polled every
  // 30s by every logged-in user - capped to the most recent 100 the same
  // way the audit log caps its own unbounded history, since a bell
  // dropdown needs a server-side bound, not full Prev/Next pagination UI.
  const mine = db.notifications
    .filter((n) => n.recipientUserId === auth.session.userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100);

  return NextResponse.json({ notifications: mine });
}
