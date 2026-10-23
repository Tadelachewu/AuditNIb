import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { redis, logRedisFailure as logFailure } from "@/lib/redisClient";
import { withApiHandler } from "@/lib/api/handler";
import { canSendCommunications } from "@/lib/communications/rules";

// The New message form's unsent draft, one per user - the same safety net as
// Register Finding's (src/app/api/findings/draft-autosave): a refresh, a closed
// tab or a lost connection doesn't lose what was typed. Redis with a sliding
// 24h expiry (the same lifetime as an unsent attachment). Fails open: a
// failed autosave never interrupts writing the message.

const TTL_SECONDS = 24 * 60 * 60;
const MAX_BYTES = 300_000;
const draftKey = (userId: string) => `communication-draft-autosave:${userId}`;
const logRedisFailure = (op: string, err: unknown) => logFailure(op, err, "Communication draft Redis operation failed");

async function caller() {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  if (!canSendCommunications(auth.session)) return { ok: false as const, response: NextResponse.json({ error: "Not allowed" }, { status: 403 }) };
  return { ok: true as const, userId: auth.session.userId! };
}

async function handleGET() {
  const c = await caller();
  if (!c.ok) return c.response;
  try {
    const raw = await redis.get(draftKey(c.userId));
    return NextResponse.json({ draft: raw ? JSON.parse(raw) : null });
  } catch (err) {
    logRedisFailure("GET", err);
    return NextResponse.json({ draft: null });
  }
}

async function handlePATCH(request: Request) {
  const c = await caller();
  if (!c.ok) return c.response;
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Draft too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  try {
    await redis.set(draftKey(c.userId), JSON.stringify(body), "EX", TTL_SECONDS);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logRedisFailure("PATCH", err);
    return NextResponse.json({ ok: false });
  }
}

/** After sending, or Discard. */
async function handleDELETE() {
  const c = await caller();
  if (!c.ok) return c.response;
  try {
    await redis.del(draftKey(c.userId));
  } catch (err) {
    logRedisFailure("DELETE", err);
  }
  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const PATCH = withApiHandler(handlePATCH);
export const DELETE = withApiHandler(handleDELETE);
