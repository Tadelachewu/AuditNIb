/**
 * Shared Sentry settings (server + browser). Privacy first: no default PII
 * (IP, cookies, request bodies/headers), and every event is scrubbed of
 * credential-looking values before it leaves the process.
 */
type AnyEvent = { request?: { cookies?: unknown; headers?: Record<string, string>; data?: unknown; query_string?: unknown }; user?: { id?: string | number } & Record<string, unknown>; extra?: Record<string, unknown>; breadcrumbs?: { data?: Record<string, unknown> }[] };

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|session|encryption/i;

export function scrubEvent<T extends AnyEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const k of Object.keys(event.request.headers)) if (SENSITIVE.test(k)) event.request.headers[k] = "[REDACTED]";
    }
  }
  if (event.user) event.user = event.user.id !== undefined ? { id: event.user.id } : {};
  for (const obj of [event.extra, ...(event.breadcrumbs ?? []).map((b) => b.data)]) {
    if (!obj) continue;
    for (const k of Object.keys(obj)) if (SENSITIVE.test(k)) obj[k] = "[REDACTED]";
  }
  return event;
}

export function sentryBaseOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.APP_ENV || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b: { category?: string }) => (b.category === "console" ? null : b),
  };
}
