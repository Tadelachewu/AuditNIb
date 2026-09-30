import { z } from "zod";

/**
 * Server configuration, validated once at startup (src/instrumentation.ts)
 * so a misconfigured server fails fast with a clear list of what's wrong,
 * instead of failing on the first request that happens to need a value.
 * Messages name the variable but NEVER print its value.
 */
const bool = z.enum(["true", "false"]).optional();
const optionalUrl = z.union([z.literal(""), z.url()]).optional();

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_ENV: z.string().optional(),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string"),
  REDIS_URL: z.string().regex(/^rediss?:\/\//, "must be a redis:// or rediss:// URL"),
  IRON_SESSION_PASSWORD: z.string().min(32, "must be at least 32 characters"),
  SESSION_COOKIE_SECURE: bool,
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().optional(),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().optional(),
  TRUST_PROXY: bool,
  FILE_ENCRYPTION_KEY: z
    .string()
    .regex(/^([0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=)$/, "must be 32 bytes (64 hex or 44 base64 characters)")
    .optional(),
  STORAGE_DIR: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  APP_BASE_URL: optionalUrl,
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HOST: z.string().optional(),
  LOG_LEVEL: z.union([z.literal(""), z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])]).optional(),
  SENTRY_DSN: optionalUrl,
  NEXT_PUBLIC_SENTRY_DSN: optionalUrl,
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.union([z.literal(""), z.coerce.number().min(0).max(1)]).optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

/** Returns human-readable problems ("DATABASE_URL: must be ..."), empty when valid. */
export function envProblems(source: Record<string, string | undefined> = process.env): string[] {
  const result = envSchema.safeParse(source);
  if (result.success) {
    const problems: string[] = [];
    if (result.data.NODE_ENV === "production" && !result.data.FILE_ENCRYPTION_KEY) {
      problems.push("FILE_ENCRYPTION_KEY: required in production (evidence and import files are encrypted with it)");
    }
    return problems;
  }
  return result.error.issues.map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`);
}
