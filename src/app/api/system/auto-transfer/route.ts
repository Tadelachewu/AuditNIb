import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { runAutoTransferIfDue } from "@/lib/autoTransfer";
import { clientIp, isRateLimited, recordAttempt } from "@/lib/rateLimit";

const WRONG_SECRET_LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

/**
 * For a server cron (optional): runs the automatic transfer now, for exact
 * timing at period end. Without a cron it still runs lazily within minutes
 * (see runAutoTransferIfDue()). Protected by a shared secret, not a user
 * session: send header `x-auto-transfer-secret: $AUTO_TRANSFER_CRON_SECRET`
 * (no Origin header needed - src/proxy.ts exempts /api/system/*). Disabled
 * (404) when AUTO_TRANSFER_CRON_SECRET isn't set. 10 wrong secrets in 15
 * minutes from one address block it for 15 minutes (429).
 */
function secretMatches(given: string | null): boolean {
  const expected = process.env.AUTO_TRANSFER_CRON_SECRET?.trim();
  if (!expected || expected.length < 16 || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handlePOST(request: Request) {
  if (!process.env.AUTO_TRANSFER_CRON_SECRET?.trim()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = `auto-transfer-secret:${clientIp(request)}`;
  const limited = await isRateLimited(key, WRONG_SECRET_LIMIT);
  if (limited.limited) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  if (!secretMatches(request.headers.get("x-auto-transfer-secret"))) {
    await recordAttempt(key, WRONG_SECRET_LIMIT);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await runAutoTransferIfDue({ force: true });
  return NextResponse.json(result);
}

export const POST = withApiHandler(handlePOST);
