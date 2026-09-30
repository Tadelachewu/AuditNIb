import { getRequestContext } from "@/lib/requestContext";

/**
 * Server-side error monitoring (Sentry). Enabled only when SENTRY_DSN is
 * set (see src/instrumentation.ts); otherwise every call is a no-op and
 * errors are still in the structured logs. Only UNEXPECTED errors are
 * reported - expected ones (validation, auth, business rules) are not
 * incidents. Data sent is limited to the error, its request ID and the
 * user ID (no request bodies, headers, cookies or IP - see beforeSend in
 * src/lib/sentryOptions.ts).
 */
export async function captureServerException(err: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    if (!Sentry.getClient()) return;
    const ctx = getRequestContext();
    Sentry.withScope((scope) => {
      if (ctx?.requestId) scope.setTag("requestId", ctx.requestId);
      if (ctx?.path) scope.setTag("path", ctx.path);
      if (ctx?.userId) scope.setUser({ id: ctx.userId });
      scope.setExtras(extra);
      Sentry.captureException(err);
    });
  } catch {
    // Monitoring must never break the request.
  }
}
