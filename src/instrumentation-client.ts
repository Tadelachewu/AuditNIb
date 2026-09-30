// Browser-side monitoring bootstrap (Next.js runs this before the app
// hydrates). Sentry is only downloaded and started when
// NEXT_PUBLIC_SENTRY_DSN is set - otherwise nothing is loaded.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  Promise.all([import("@sentry/nextjs"), import("@/lib/sentryOptions")])
    .then(([Sentry, { sentryBaseOptions }]) => Sentry.init(sentryBaseOptions(dsn)))
    .catch(() => {});
}
