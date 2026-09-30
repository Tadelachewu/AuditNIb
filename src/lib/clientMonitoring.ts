/**
 * Browser-side error reporting for the error boundaries. Sends to Sentry
 * only when NEXT_PUBLIC_SENTRY_DSN is configured (the SDK is loaded lazily,
 * so it costs nothing otherwise). Server Component errors arrive here with
 * only a digest (Next hides their message in production); the server-side
 * record is already made by onRequestError (src/instrumentation.ts).
 */
export function reportClientError(error: Error & { digest?: string }, boundary: string): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  import("@sentry/nextjs")
    .then((Sentry) => {
      if (!Sentry.getClient()) return;
      Sentry.withScope((scope) => {
        scope.setTag("boundary", boundary);
        if (error.digest) scope.setTag("digest", error.digest);
        Sentry.captureException(error);
      });
    })
    .catch(() => {});
}
