import { redis } from "@/lib/redisClient";

// Redis-backed login/password-change abuse protection - replaces an
// earlier in-memory (per-process Map) version, which reset on every
// restart and would have tracked counts independently (and therefore
// incorrectly) on each instance of a multi-instance deployment. Every
// counter here is a real Redis key with its own TTL, shared across
// however many Node processes are actually running.
//
// Every call is wrapped in try/catch and fails OPEN (lets the request
// through as if it weren't rate-limited/locked) if Redis errors or times
// out - a rate limiter outage must degrade the app's brute-force
// protection, not become a second way to take login down entirely. This
// mirrors the same fail-open choice made for the HIBP breach check in
// passwordValidation.ts, for the same reason.
//
// Two independent mechanisms, both used together by the login and
// change-password routes (security/ChatBot_VA_Report_Analysis.md's VA-017
// class - "Weak Authentication Rate Limiting Controls"):
//   - Rate limit: a short sliding window (isRateLimited/recordAttempt) -
//     the first line of defense, cheap to reset once the window rolls over.
//   - Lockout: a harder, longer block once a caller has clearly crossed
//     from "a few mistyped passwords" into "guessing" (checkLockout/
//     recordFailureForLockout) - checked BEFORE the rate limit on every
//     request, so an already-locked-out caller gets an immediate 429
//     without spending any of their rate-limit budget re-triggering it.

function logRedisFailure(op: string, err: unknown): void {
  console.error(`[rateLimit] Redis ${op} failed - failing open`, err);
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

// Read-only check - does not consume an attempt. Call before doing the
// actual work (e.g. a password comparison) so an already-blocked caller
// can't extend their own lockout by continuing to retry.
export async function isRateLimited(key: string, opts: RateLimitOptions): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const redisKey = `ratelimit:${key}`;
  try {
    const [count, ttlMs] = await Promise.all([redis.get(redisKey), redis.pttl(redisKey)]);
    const n = count ? Number(count) : 0;
    if (n >= opts.max && ttlMs > 0) {
      return { limited: true, retryAfterSeconds: Math.ceil(ttlMs / 1000) };
    }
    return { limited: false, retryAfterSeconds: 0 };
  } catch (err) {
    logRedisFailure("isRateLimited", err);
    return { limited: false, retryAfterSeconds: 0 };
  }
}

// Consumes one attempt against `key` - call only for the specific event
// being throttled (e.g. a failed login), not every request, so successful
// requests don't count against the caller's own limit.
export async function recordAttempt(key: string, opts: RateLimitOptions): Promise<void> {
  const redisKey = `ratelimit:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.pexpire(redisKey, opts.windowMs);
    }
  } catch (err) {
    logRedisFailure("recordAttempt", err);
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  try {
    await redis.del(`ratelimit:${key}`);
  } catch (err) {
    logRedisFailure("clearRateLimit", err);
  }
}

export interface LockoutOptions {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

// Read-only check - does not consume anything.
export async function checkLockout(key: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  try {
    const ttlMs = await redis.pttl(`lockout:${key}:locked`);
    if (ttlMs > 0) {
      return { locked: true, retryAfterSeconds: Math.ceil(ttlMs / 1000) };
    }
    return { locked: false, retryAfterSeconds: 0 };
  } catch (err) {
    logRedisFailure("checkLockout", err);
    return { locked: false, retryAfterSeconds: 0 };
  }
}

// Records one failure against `key` and locks it out once `maxFailures` is
// reached within `windowMs`. Returns the failure count just recorded (used
// to drive the exponential backoff delay) and whether this failure just
// triggered (or extended) a lockout.
export async function recordFailureForLockout(
  key: string,
  opts: LockoutOptions
): Promise<{ failures: number; locked: boolean; retryAfterSeconds: number }> {
  const failuresKey = `lockout:${key}:failures`;
  const lockedKey = `lockout:${key}:locked`;
  try {
    const failures = await redis.incr(failuresKey);
    if (failures === 1) {
      await redis.pexpire(failuresKey, opts.windowMs);
    }
    if (failures >= opts.maxFailures) {
      await redis.set(lockedKey, "1", "PX", opts.lockoutMs);
      return { failures, locked: true, retryAfterSeconds: Math.ceil(opts.lockoutMs / 1000) };
    }
    return { failures, locked: false, retryAfterSeconds: 0 };
  } catch (err) {
    logRedisFailure("recordFailureForLockout", err);
    return { failures: 0, locked: false, retryAfterSeconds: 0 };
  }
}

export async function clearLockout(key: string): Promise<void> {
  try {
    await redis.del(`lockout:${key}:failures`, `lockout:${key}:locked`);
  } catch (err) {
    logRedisFailure("clearLockout", err);
  }
}

// 1s, 2s, 4s, 8s, capped - slows down a scripted brute-force loop in real
// time, on top of (not instead of) the hard rate limit/lockout above.
export function computeBackoffMs(failureCount: number): number {
  return Math.min(1000 * 2 ** Math.max(0, failureCount - 1), 8000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort client IP. `x-forwarded-for` is only trusted when
// TRUST_PROXY=true - that header is entirely client-controllable on a
// direct connection, so honoring it unconditionally would let an attacker
// put a different value on every request and never accumulate against any
// single per-IP bucket (security/additional chat bot.docx's VA-017
// remediation note: "Added TRUST_PROXY configuration" for exactly this
// reason). Set TRUST_PROXY=true only when this app is actually deployed
// behind a reverse proxy/tunnel that itself sets (and cannot be made to
// forward an attacker-supplied) x-forwarded-for - e.g. the Cloudflare
// Tunnel setup in EXPOSE_TO_INTERNET.md. Without it, every direct request
// collapses onto one shared bucket, which still protects any single
// account/IP pairing correctly, just without distinguishing LAN clients
// from each other.
export function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return realIp;
  }
  return "direct";
}
