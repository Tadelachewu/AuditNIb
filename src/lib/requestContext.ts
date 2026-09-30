import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context (request ID, user) available anywhere on the server
 * during that request - so a log line written deep inside a library
 * (mail.ts, import.ts, ...) still carries the request ID without it being
 * threaded through every function signature. Set by withApiHandler().
 */
export interface RequestContext {
  requestId: string;
  method?: string;
  path?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Attach the signed-in user once known (guard.ts), so later logs include it. */
export function setRequestUser(userId: string | undefined): void {
  const ctx = storage.getStore();
  if (ctx && userId) ctx.userId = userId;
}

export { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/requestId";
