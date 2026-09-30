// Test-only configuration: dummy values so modules that read configuration
// at import time can load. Nothing here connects to a real database/Redis.
process.env.IRON_SESSION_PASSWORD ??= "test-only-session-password-at-least-32-chars";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
process.env.REDIS_URL ??= "redis://127.0.0.1:1";
process.env.LOG_LEVEL ??= "silent";
