import Redis from "ioredis";
import { logger } from "@/lib/logger";

// Backs login/password-change rate limiting and lockout (src/lib/rateLimit.ts)
// and draft autosave with a real shared store instead of an in-memory Map -
// state survives restarts and is correct across more than one server
// instance. Any Redis-protocol-compatible server works (Memurai on Windows,
// a managed Redis in production, etc.).
//
// Redis is never allowed to become the outage: when it's down every caller
// fails open (sign-in still works, without rate limiting) and FAST - commands
// are rejected immediately instead of waiting for a timeout - and the outage
// is logged once as a warning, not as an error on every request.
//
// Same dev-mode globalThis singleton pattern as src/lib/prismaClient.ts -
// without it, every hot-reload would open a new connection on top of the
// last one.
const url = process.env.REDIS_URL;
if (!url) {
  throw new Error("REDIS_URL env var must be set (e.g. redis://localhost:6379). See .env.example.");
}

// Bumped when the client's options/listeners change, so a dev server's
// hot reload swaps an older client (kept on globalThis) for the new one.
const CLIENT_VERSION = 2;
const globalForRedis = globalThis as unknown as { redis?: Redis; redisVersion?: number };

let unavailableSince: number | null = null;

/** A readable cause - a refused connection arrives as an AggregateError with an empty message. */
function describe(err: unknown): string {
  const e = err as { message?: string; code?: string; errors?: { message?: string }[] };
  const inner = e.errors?.map((x) => x.message).filter(Boolean).join("; ");
  return [e.code, e.message || inner].filter(Boolean).join(": ") || "connection failed";
}

function createClient(): Redis {
  const client = new Redis(url!, {
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
    // While disconnected, reject commands at once (callers fail open)
    // instead of queueing them until a timeout - so a Redis outage never
    // slows sign-in down.
    enableOfflineQueue: false,
    // Keep trying to reconnect, backing off to one attempt every 30 s.
    retryStrategy: (times) => Math.min(times * 1000, 30_000),
  });
  // Without an 'error' listener ioredis prints "Unhandled error event" on
  // every failed reconnect. One warning per outage is enough.
  client.on("error", (err) => {
    if (unavailableSince !== null) return;
    unavailableSince = Date.now();
    logger.warn(
      { event: "redis.unavailable", reason: describe(err) },
      "Redis is unavailable - rate limiting and draft autosave are off until it's back (requests continue)"
    );
  });
  client.on("ready", () => {
    if (unavailableSince === null) return;
    logger.info({ event: "redis.recovered", downForMs: Date.now() - unavailableSince }, "Redis is available again");
    unavailableSince = null;
  });
  return client;
}

if (globalForRedis.redis && globalForRedis.redisVersion !== CLIENT_VERSION) {
  globalForRedis.redis.disconnect();
  globalForRedis.redis = undefined;
}

export const redis = globalForRedis.redis ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
  globalForRedis.redisVersion = CLIENT_VERSION;
}

/**
 * Log a failed Redis operation. While Redis is known to be down (the outage
 * was already reported once) this stays quiet; any other failure - Redis up
 * but the command failed - is logged as an error.
 */
export function logRedisFailure(op: string, err: unknown, message: string): void {
  if (unavailableSince !== null || redis.status !== "ready") return;
  logger.error({ err, event: "redis.failed", op }, message);
}
