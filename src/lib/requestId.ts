/**
 * Request / correlation ID helpers - dependency-free so src/proxy.ts can use
 * them as well as the API handler. The proxy assigns the ID; everything
 * downstream (Route Handlers, logs, error bodies, the X-Request-Id response
 * header) reuses it.
 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * A caller-supplied ID is only reused when it is a plain token (UUID or
 * similar); anything else - over-long values, spaces, newlines that could
 * forge log lines - is replaced with a fresh crypto.randomUUID().
 */
export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
}
