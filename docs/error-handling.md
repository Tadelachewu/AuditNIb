# Error Handling, Logging and Monitoring

How NIB Control360 handles failures, from the browser to the database, and what each layer is responsible for.

```
User → UI (error.tsx / global-error.tsx / not-found.tsx, inline form errors, notify)
     → API client (src/lib/api-client.ts: ApiError with code, details, requestId)
     → proxy (src/proxy.ts: request ID, body-size & cross-origin rejection)
     → Route Handler wrapped in withApiHandler (src/lib/api/handler.ts)
         → authenticate + authorize (src/lib/guard.ts)
         → validate (Zod) → business logic → database / SMTP / file storage
         → throw ApplicationError (expected) or anything else (unexpected)
     → central mapping (src/lib/errors/normalize.ts)
     → structured log (Pino) + monitoring (Sentry, unexpected only)
     → safe response { success:false, error:{code,message,details}, requestId }
```

---

## 1. Expected vs unexpected

| | Expected | Unexpected |
|---|---|---|
| Examples | validation, not signed in, no permission, not found, conflict, business rule, rate limit | a bug, database down, disk failure, library exception |
| Thrown as | an `ApplicationError` subclass (or a legacy `{ error }` response) | anything else |
| Client sees | the error's own safe message and code | a generic message + request ID; never the exception text |
| Logged at | `info` (the access line is `warn`) | `error`, with stack (server only) |
| Monitoring | no | yes (Sentry, when configured) |

## 2. Error hierarchy (`src/lib/errors/index.ts`)

```
ApplicationError (code, status, details, headers, expected)
├── ValidationError        422  VALIDATION_ERROR (details.fieldErrors)
├── BadRequestError        400  BAD_REQUEST (malformed body)
├── AuthenticationError    401  AUTHENTICATION_FAILED | SESSION_EXPIRED
├── AuthorizationError     403  AUTHORIZATION_DENIED | CROSS_ORIGIN_REJECTED
├── NotFoundError          404  RESOURCE_NOT_FOUND
├── ConflictError          409  CONFLICT
├── RateLimitError         429  RATE_LIMIT_EXCEEDED (+ Retry-After)
├── BusinessRuleError      409  a specific business code (below)
├── ExternalServiceError   502/503/504  BAD_GATEWAY | EXTERNAL_SERVICE_UNAVAILABLE | UPSTREAM_TIMEOUT | FILE_STORAGE_UNAVAILABLE | EMAIL_DELIVERY_FAILED
├── DatabaseError          503  DATABASE_ERROR
└── InternalServerError    500  INTERNAL_SERVER_ERROR | FILE_INTEGRITY_FAILED
```

## 3. Error-code catalog

Codes are stable: never rename one, because clients depend on them.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400/422 | Input failed validation (legacy handlers keep 400; new code uses 422) |
| `BAD_REQUEST` | 400 | Malformed request (e.g. invalid JSON) |
| `AUTHENTICATION_FAILED` | 401 | Not signed in / session invalid |
| `SESSION_EXPIRED` | 401 | Session timed out |
| `AUTHORIZATION_DENIED` | 403 | Missing permission or outside org scope |
| `CROSS_ORIGIN_REJECTED` | 403 | State-changing API call from another origin |
| `RESOURCE_NOT_FOUND` | 404 | Record doesn't exist |
| `CONFLICT` | 409 | Duplicate / conflicting state |
| `PAYLOAD_TOO_LARGE` | 413 | Body over the limit |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many attempts (Retry-After header) |
| `BUSINESS_RULE_VIOLATION` | 409 | Generic rule failure |
| `FINDING_NOT_READY_FOR_CLOSURE` | 409 | Nothing verified to close / sent back for correction |
| `PERIOD_LOCKED` | 409 | Reporting period locked |
| `LOCKOUT_PREVENTED` | 409 | Change would leave nobody able to undo it |
| `IMPORT_FILE_INVALID` | 422 | Import file has errors (`details.rows`) |
| `IMPORT_DUPLICATES_FOUND` | 409 | Final import check: duplicates need a decision (`details.duplicates`) |
| `IMPORT_NOTHING_TO_IMPORT` | 409 | Every row already exists |
| `IMPORT_NOT_REVERSIBLE` | 409 | Import in the wrong state for that action |
| `EMAIL_DELIVERY_FAILED` | 502 | SMTP send failed |
| `BAD_GATEWAY` | 502 | Upstream returned something invalid |
| `EXTERNAL_SERVICE_UNAVAILABLE` | 503 | Dependency unreachable |
| `FILE_STORAGE_UNAVAILABLE` | 503 | Storage not configured / unavailable |
| `DATABASE_ERROR` | 503 | Database unreachable |
| `UPSTREAM_TIMEOUT` | 504 | Dependency timed out |
| `INTERNAL_SERVER_ERROR` | 500 | Anything unexpected |
| `FILE_INTEGRITY_FAILED` | 500 | Stored file failed decryption/integrity check |

## 4. API error contract

Every failing API response (Route Handlers and the proxy):

```json
{
  "success": false,
  "error": { "code": "FINDING_NOT_READY_FOR_CLOSURE", "message": "Awaiting district verification before this can be closed", "details": null },
  "requestId": "6124415a-fb18-45b4-b5b6-4c6d17c12372"
}
```

- `message` is always user-safe. For any 5xx it is the catalog's generic text, whatever the code threw.
- `details` carries user-safe structure only (`fieldErrors`, import `rows`, `duplicates`), and is `null` for 5xx.
- The same ID is in the `X-Request-Id` response header.
- **Successful responses are unchanged** (their existing shapes), so no client code had to change.

**Legacy handlers.** The 65 route files still `return NextResponse.json({ error: "..." }, { status })`. `withApiHandler` rewrites these into the contract automatically: the code comes from an optional `code` field or from the status, and extra fields become `details`. The status and headers are kept. New code should `throw` an `ApplicationError`.

## 5. HTTP status strategy

400 malformed / legacy validation · 401 unauthenticated · 403 forbidden · 404 not found · 409 conflict or business rule · 413 too large · 422 semantic validation · 429 rate limited · 500 unexpected · 502 bad upstream · 503 dependency/database unavailable · 504 upstream timeout. A failed operation never returns 200.

## 6. Where each piece lives

| Concern | File |
|---|---|
| Error classes + code catalog (isomorphic) | `src/lib/errors/index.ts` |
| Mapping of Zod, Prisma, storage, JSON, network and timeout errors | `src/lib/errors/normalize.ts` |
| Central Route Handler wrapper | `src/lib/api/handler.ts` (`withApiHandler`, `errorResponse`) |
| Request ID (proxy-safe) | `src/lib/requestId.ts` |
| Per-request context (AsyncLocalStorage) | `src/lib/requestContext.ts` |
| Structured logger | `src/lib/logger.ts` |
| Server monitoring | `src/lib/monitoring.ts`, `src/lib/sentryOptions.ts`, `src/instrumentation.ts` |
| Browser monitoring | `src/instrumentation-client.ts`, `src/lib/clientMonitoring.ts` |
| Env validation | `src/lib/env.ts` (run at startup by `instrumentation.ts`) |
| Browser API client | `src/lib/api-client.ts` |
| Error boundaries | `src/app/global-error.tsx`, `src/app/error.tsx`, `src/app/(app)/error.tsx`, `src/app/not-found.tsx` |

### Writing a Route Handler

```ts
async function handlePOST(request: Request) {
  const auth = await requirePermission("findings.close");        // 401 / 403 in the contract
  if (!auth.ok) return auth.response;
  const input = schema.parse(await request.json());               // ZodError -> VALIDATION_ERROR
  const finding = db.findings.find(...);
  if (!finding) throw new NotFoundError("finding");               // 404
  if (!closable) throw new BusinessRuleError("FINDING_NOT_READY_FOR_CLOSURE", "Awaiting district verification");
  await updateDb(...);                                            // Prisma errors mapped, transaction rolls back
  return NextResponse.json({ ok: true });
}
export const POST = withApiHandler(handlePOST);                   // no try/catch needed
```

## 7. Error boundaries

| File | Catches | Shows |
|---|---|---|
| `src/app/(app)/error.tsx` | a signed-in page failing to render | a card in place of the page (sidebar stays), reference digest, Try again / Dashboard |
| `src/app/error.tsx` | login / forgot / reset pages | a standalone card |
| `src/app/global-error.tsx` | the root layout itself | its own `<html>`, inline-styled (global CSS isn't loaded) |
| `src/app/not-found.tsx` | unknown URLs | "Page not found" |

`forbidden.tsx` / `unauthorized.tsx` are **not used**: they need the experimental `authInterrupts` flag. Page access is already enforced by the proxy (redirect to sign-in or dashboard), and APIs return 401/403 in the contract. Boundaries never show `error.message`; the digest matches the server log line (`onRequestError`).

## 8. Logging (Pino)

- One JSON line per event on stdout: `level`, `time` (ISO), `message`, `service`, `env`, plus `requestId`, `userId`, `method`, `path` automatically. Access lines add `statusCode`, `errorCode` and `duration` (ms).
- Levels: `debug` (successful GETs, including the notification poll), `info` (successful writes, expected errors), `warn` (4xx responses), `error` (5xx, unhandled exceptions, failed email/storage), `fatal` (invalid configuration at startup). Set with `LOG_LEVEL`.
- **Never logged:** `password*`, `token`/`accessToken`/`refreshToken`/`resetToken`, `apiKey`, `secret`, `authorization`, `cookie`, `smtpPassword`, `encryptionKey`, `privateKey`. These keys are censored at any common depth. Credentials inside URLs or free text (`postgresql://u:***@`, `password=***`) are scrubbed from error messages and stacks. Arbitrary error fields such as Prisma query text are not serialised.
- Password-reset logs identify users by ID, never by email address.

## 9. Monitoring (Sentry)

- Enabled only when `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN` (browser) is set. Otherwise nothing is loaded and errors stay in the logs.
- Only **unexpected** errors are reported (5xx, render failures via `onRequestError`, error boundaries).
- Privacy: `sendDefaultPii: false`. Cookies, request bodies, query strings and sensitive headers are stripped in `beforeSend`, the user is reduced to `{ id }`, and console breadcrumbs are dropped. Events are tagged with `requestId`.
- For a bank, use **self-hosted Sentry** or an approved data region. The CSP `connect-src` automatically allows only the configured DSN host.
- Source-map upload (`withSentryConfig`) is intentionally not enabled yet (see recommendations).

## 10. Configuration validation

`src/lib/env.ts` (Zod) checks every server variable at startup. Problems are logged at `fatal` by name (values are never printed), and **in production the server refuses to start**. Blank optional values are allowed.

## 11. Testing

`npm test` (Vitest) covers the error classes and mapping (Zod, Prisma, storage, network, timeout), the API contract, legacy normalisation, request-ID propagation and sanitising, sensitive-data leakage in responses and logs, a real route (401/403/400/409/503), the browser API client, error boundaries, not-found, env validation, the notification system and the import flows.
