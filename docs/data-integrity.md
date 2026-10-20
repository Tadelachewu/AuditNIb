# Data integrity: concurrency, idempotency and audit completeness

Three protections apply to **every** change in the app. They live in the shared write path, so no route can skip them.

| Problem | Protection | Code |
|---|---|---|
| Two requests change the same thing at once (race condition / TOCTOU) | Changes run one at a time; a change based on an out-of-date check is refused | `updateDb()` in `src/lib/db.ts` |
| The same request arrives twice (retry, double click, dropped connection) | Idempotency-Key: the repeat gets the first reply, and the action is not done twice | `src/lib/idempotency.ts`, `src/lib/api-client.ts` |
| A change isn't fully recorded | Every changed finding field is logged with its old and new value; the audit log is append-only | `src/lib/auditCompleteness.ts` |

---

## 1. Concurrency (race conditions / TOCTOU)

**What was wrong:** `updateDb()` read the data, changed it in memory, then saved it, with no lock. The read happened outside the transaction. Routes also checked their rules on an even earlier read. Two requests at the same moment could both pass the same check. Examples:

- Two rectifications of the same 5 outstanding cases: 10 of 5 rectified.
- An approval and a return of the same finding: both recorded.
- Two edits to one finding: the second silently overwrote the first.

**Now:**

1. **One change at a time.** `updateDb()` takes these steps in order:
   - waits for the previous change in this process;
   - opens a transaction and takes a Postgres advisory lock (`pg_advisory_xact_lock`), which every process and server shares;
   - reads the data, inside the lock;
   - applies the change and writes it.

   The lock is released when the transaction ends, even if the request fails. So each change is computed from what the previous one committed.
2. **Out-of-date checks are refused.** A POST, PATCH or DELETE request remembers what its own read saw. If any row that the change modifies or deletes was changed by someone else since that read, the change is refused with **409 CONFLICT**: "Someone else changed this just now. Reload the page…". The second of two identical actions therefore fails instead of being applied twice.
3. **Jobs** (automatic transfer, rectification reminders) pass `staleCheck: false`. They decide everything from the data they read under the lock.

**Verified:** `tests/concurrency.test.ts` (simultaneous changes, double action, different rows, two changes in one request, GET and jobs). It was also checked against the real database: two separate processes' changes interleaved with no overlap.

**Cost:** changes queue behind each other for the few hundred milliseconds each one takes. Reads (pages, lists, reports) are not affected.

---

## 2. Idempotency-Key

**What was wrong:** a repeated request was simply processed again. This happens when a connection drops after the server saved but before the browser got the reply, and the user clicks again. The result was a second finding, comment, message or approval.

**Now:**

- **The browser** (`src/lib/api-client.ts`) sends a random `Idempotency-Key` with every POST, PATCH and DELETE. It sends the **same** key when it retries the **same** request:
  - It retries a dropped connection automatically, twice, but only once the server has shown it supports keys.
  - It asks again a few times while the server says "still processing".
  - If the user clicks again within 10 minutes after an unanswered attempt, the same key is reused.
- **The server** (`src/lib/idempotency.ts`, called by `withApiHandler()` for every API route) records the key per user, method and path:

| The request with this key… | Answer |
|---|---|
| is new | It runs. A successful (2xx) reply is stored for 24 hours. |
| already finished | The **stored reply** (header `Idempotent-Replayed: true`). Nothing is done again. |
| is still running | **409 REQUEST_IN_PROGRESS**. The browser waits and asks again. |
| comes with a different body | **422 IDEMPOTENCY_KEY_REUSED** |
| failed earlier (4xx / 5xx) | It runs again. A failed request saved nothing, so the user can, for example, confirm their password and retry. |
| was saved, but the server stopped before replying | **409 REQUEST_ALREADY_PROCESSED**: "Reload the page to see the result." It is never run twice. |

- The key is marked **committed inside the change's own database transaction**. That is how the last row in the table is known for certain.
- Ages are compared using the database's own clock, so a time-zone difference between the app server and the database can't make a live request look dead.
- **Not used for:**
  - `/api/auth/*` (sign-in, sign-out and password routes set cookies, which a stored reply can't repeat);
  - `/api/system/*` (scheduler calls);
  - signed-out requests.

**Database:** migration `20261020120000_idempotency_keys` adds the `idempotency_keys` table. The code uses it through SQL, so no `prisma generate` is needed. Until the migration is applied, requests run as before, and the server log warns once.

**Verified:** `tests/idempotency.test.ts`. Against the running app: a repeat got the same reply, a different body got 422, and of two simultaneous requests one ran while the other got 409.

---

## 3. Audit completeness

The audit log already had a tamper-evident hash chain (`src/lib/audit.ts`). Admin › Audit Log reports whether the chain is intact. Added:

1. **Registering a finding** is logged (`CREATE`), whether it's saved as a draft or submitted straight away.
2. **Every changed field of a finding is logged with its old and new value.** Routes log their own entry, e.g. a status change `{status: A} → {status: B}`. Any field that entry doesn't show is added in a `FIELDS_CHANGED` entry beside it, with "With RECTIFY" etc. as the reason. Examples: rectified, verified and closed cases and amounts; the period after a transfer; totals after an adjustment. Changes made by jobs are logged as "System".
3. **Uncovered-branch note updates** log the old reason as well as the new one.
4. **The audit log is append-only.** A change that would edit or delete an existing entry is refused before anything is saved. The only exception is the development-only Dev Reset, which removes finding entries along with the findings.

**Note for the dev database:** each Dev Reset removes entries, so on a development database the chain shows "broken". Production never runs Dev Reset, so its chain stays intact.

**Verified:** `tests/auditCompleteness.test.ts`. Against the running app: a draft that was created, edited and deleted logged CREATE, UPDATE (amount 1000 → 2500) and DELETE.

---

## Deploying

1. `npx prisma migrate deploy`: adds `idempotency_keys`.
2. Restart the app and the worker. Without step 1 everything still works, but repeated requests are processed again.
