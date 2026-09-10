import Redis from "ioredis";

// Backs login/password-change rate limiting and lockout (src/lib/rateLimit.ts)
// with a real shared store instead of an in-memory Map - state now survives
// restarts and is correct across more than one server instance, unlike the
// in-memory version it replaces. Any Redis-protocol-compatible server works
// (Memurai on Windows, a managed Redis in production, etc.).
//
// Same dev-mode globalThis singleton pattern as src/lib/prismaClient.ts -
// without it, every hot-reload would open a new connection on top of the
// last one.
const url = process.env.REDIS_URL;
if (!url) {
  throw new Error("REDIS_URL env var must be set (e.g. redis://localhost:6379). See .env.example.");
}

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis =
  globalForRedis.redis ??
  new Redis(url, {
    // Never let a slow/unreachable Redis hang a login request indefinitely -
    // the rate limiter matters, but it must not itself become the outage.
    // rateLimit.ts also wraps every call in try/catch and fails open (lets
    // the request through) if Redis itself errors or times out.
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 1,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
