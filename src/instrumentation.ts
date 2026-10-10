import type { Instrumentation } from "next";

/**
 * Server startup + server-error hooks (Next.js instrumentation).
 *
 * register():      validates configuration (src/lib/env.ts), starts Sentry
 *                  when SENTRY_DSN is set, and starts the email worker
 *                  (src/lib/emailQueue).
 * onRequestError:  every error Next.js captures while rendering a page /
 *                  Server Component / Route Handler is logged (structured,
 *                  with the request ID and the digest the error page shows)
 *                  and reported to monitoring. API routes also go through
 *                  withApiHandler, which answers them safely.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { envProblems } = await import("@/lib/env");
  const { logger } = await import("@/lib/logger");

  const problems = envProblems();
  if (problems.length > 0) {
    logger.fatal({ problems }, "Invalid server configuration - see .env.example");
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Invalid server configuration:\n  ${problems.join("\n  ")}`);
    }
  }

  if (process.env.SENTRY_DSN) {
    const Sentry = await import("@sentry/nextjs");
    const { sentryBaseOptions } = await import("@/lib/sentryOptions");
    Sentry.init(sentryBaseOptions(process.env.SENTRY_DSN));
    logger.info("Error monitoring (Sentry) enabled");
  }

  // Delivers queued notification emails (retries included) - docs/email-queue.md.
  const { startEmailWorker } = await import("@/lib/emailQueue/service");
  startEmailWorker();
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/lib/logger");
  const { captureServerException } = await import("@/lib/monitoring");
  const header = request.headers["x-request-id"];
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  logger.error(
    {
      err,
      requestId: Array.isArray(header) ? header[0] : header,
      method: request.method,
      path: request.path.split("?")[0],
      digest,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
    },
    "Unhandled server error"
  );
  await captureServerException(err, { digest, routePath: context.routePath, routeType: context.routeType });
};
