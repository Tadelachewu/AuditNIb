import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { redis } from "@/lib/redisClient";

// One in-progress, not-yet-saved NEW finding registration per user - a
// power failure, an accidental tab close, or a refresh mid-form shouldn't
// lose everything typed so far. Deliberately NOT for editing an existing
// finding (that already has its own persisted DB row) - only for the
// registration form before the first real Draft save/Submit exists at
// all. Redis, not the DB: this is disposable, per-browser-session scratch
// state, not a record anyone needs to query/report on, and it should
// vanish on its own (see the 24h TTL below) rather than accumulate
// forever the way a DB table would.
function draftKey(userId: string): string {
  return `finding-draft-autosave:${userId}`;
}

const TTL_SECONDS = 24 * 60 * 60;

function logRedisFailure(op: string, err: unknown): void {
  console.error(`[draft-autosave] Redis ${op} failed`, err);
}

// Fails open/silent in every direction - this is a convenience feature,
// never allowed to block or error out the actual registration flow if
// Redis is down (same "fails open" convention as src/lib/rateLimit.ts).
export async function GET() {
  const auth = await requirePermission("findings.create");
  if (!auth.ok) return auth.response;

  try {
    const raw = await redis.get(draftKey(auth.session.userId!));
    return NextResponse.json({ draft: raw ? JSON.parse(raw) : null });
  } catch (err) {
    logRedisFailure("GET", err);
    return NextResponse.json({ draft: null });
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("findings.create");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    // A sliding 24h expiry, refreshed on every keystroke-triggered save -
    // stays alive as long as they're actively filling it in (or refresh/
    // lose power partway through), but a draft they walked away from and
    // never returned to still ages out on its own instead of lingering
    // indefinitely.
    await redis.set(draftKey(auth.session.userId!), JSON.stringify(body), "EX", TTL_SECONDS);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logRedisFailure("PUT", err);
    // A failed autosave must never surface as an error to someone who is
    // just typing into a form - the worst case is the safety net itself
    // isn't there, not that their actual work is interrupted.
    return NextResponse.json({ ok: false });
  }
}

// Called once the form's real Draft save/Submit actually succeeds (see
// NewFindingForm.tsx) - the autosave copy's only job was to survive until
// that point, so it's cleared immediately rather than left to expire on
// its own 24h later.
export async function DELETE() {
  const auth = await requirePermission("findings.create");
  if (!auth.ok) return auth.response;

  try {
    await redis.del(draftKey(auth.session.userId!));
  } catch (err) {
    logRedisFailure("DELETE", err);
  }
  return NextResponse.json({ ok: true });
}
