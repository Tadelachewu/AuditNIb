# ID & Reference-ID Generation Rules

This document is the single source of truth for **every identifier scheme** in
NIB Control360 — what it is, how it is generated, uniqueness guarantees, and
practical capacity limits.  It intentionally covers *both* primary-key IDs
(internal, mostly invisible) and the human-facing `Finding.reference` (the
"reference ID" users quote in reports), because both share the same set of
correctness concerns:

- **No reuse / no collisions** on already-issued values, even after a deletion.
- **No silent wraparound** when a numeric sequence grows large.
- **No lost precision** when values round-trip through JSON / HTTP / JS.

Sections are ordered by what users and operators most often ask about.

---

## 1. Finding reference (`Finding.reference`)

**Purpose.**  The human-readable, printable identifier auditors, branch
controllers, and reviewers cite in emails, reports, and tickets.

### Format

```
<branchCode>-<periodCode>-<seq>
```

| Piece          | Source / rule                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `branchCode`   | `Branch.code` of the branch the finding concerns (admin-assigned, unique, e.g. `BR042`).                 |
| `periodCode`   | `ReportingPeriod.code` of the reporting period it was registered against (admin-assigned, e.g. `2026-09`).|
| `seq`          | Monotonic positive integer, scoped per `(branchCode, periodCode)`, left-padded with `0` to width **5**.  |

### Examples

```
BR001-2025-12-00001
BR042-2026-09-00037
HOADM-2026-Q4-09999
```

### Generation algorithm

Implemented in [nextFindingReference()](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/findings.ts#L507-L538).

1. Build `anchor = branch.code + "-" + period.code + "-"`.
2. Collect the numbers in use: every `f.reference` in `db.findings` that starts
   with `anchor` (suffix parsed with `parseInt(suffix, 10)`). Nothing else is
   reserved.
3. New seq = the **lowest number from 1 up that isn't taken**, so a gap left by
   **any removed finding** - deleted by hand (draft, returned, rejected) or removed
   by reversing an import - is filled (00001 and 00003 exist, 00002 was removed ->
   the next finding gets 00002).
4. Pad to 5 digits with leading `0` and return `anchor + padded`.

### Why not `COUNT() + 1`?

The prior (buggy) implementation used `db.findings.filter(…).length + 1`,
which re-issued a number **still in use** the moment any earlier finding was
deleted (e.g. 00001, 00003 left -> count 2 -> 00003 again), producing a
**Postgres `unique constraint violation` on `findings.reference`**. The
lowest-free-number algorithm only ever picks a number nothing holds.

### Capacity — per `(branch, period)`

| Suffix range          | Count available   | Realistic lifetime                                                                                                    |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `00001 .. 99999`      | 99,999            | At 50 findings/branch/month → **~166 years** of monthly periods.  At 1,000/branch/month → ~8 years before the 5-digit pad naturally grows. |
| `100000 .. unlimited` | Unlimited (string)| After 99999 the value keeps incrementing as a plain integer string — there is **no wraparound** and no hard ceiling.  |

The 5-digit pad is a *display width*, not a field limit.  Values like
`BR001-2026-09-100000` are still valid, sortable, and unique; they simply take
one more column on screen.

### Places that regenerate a reference

`Finding.reference` is immutable once a finding clears DRAFT (workflow
actions never touch it).  It is only produced or rewritten in three code
paths, all through `nextFindingReference()`:

- New creation — [POST /api/findings](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L211).
- Edit that changes branch or period (while still DRAFT/RETURNED) —
  [PATCH /api/findings/[id]](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L222).
- Bulk historical import —
  [src/lib/import.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/import.ts#L601).

### Uniqueness guarantee

The Postgres column has a **`UNIQUE` constraint**
([schema.prisma](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/prisma/schema.prisma#L381):
`reference String @unique`).  If two concurrent requests somehow both read
the same `maxSeq` and try to write the same value (a TOCTOU race because the
max is computed outside the write-holding part of `updateDb()`), the slower
one fails with a constraint error rather than silently corrupting data.  The
failure surface is a 4xx/5xx to one caller, not silent duplication.

---

## 2. Entity primary keys (`*.id` on every table)

**Purpose.**  Internal join key on every relational row.  Users never see
these; they show up only in URLs (`/findings/<uuid>`) and API payloads.

### Algorithm

Standard **UUID v4** (122 random bits), generated in-application via the
`uuid` npm package — `{ v4 as uuid } from "uuid"`.

Examples:

```
550e8400-e29b-41d4-a716-446655440000
f81d4fae-7dec-11d0-a765-00a0c91e6bf6
```

### Why app-generated (not Prisma `@default(uuid())`)

Per the schema header comment at
[schema.prisma#L12-L15](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/prisma/schema.prisma#L12-L15):
the one-time ETL from the legacy JSON-file database had to preserve every
existing `id` byte-for-byte.  IDs are therefore written by application code
at the moment of entity construction, not assigned during SQL insert.

### Collision / capacity

UUID v4 has `2^122 ≈ 5.3 × 10^36` distinct values.  To reach a 50%
probability of even a single accidental collision you would need to
generate ~**2.7 × 10^18** IDs — roughly 85 billion per second for 1 year.
For this application's scale the ceiling is **effectively unreachable**.

### Call sites

30+ direct call sites across every route/helper that creates rows.  A
non-exhaustive list is in the audit-log grep output from the codebase; grep
for `id: uuid()` if you need the full set.

---

## 3. Audit log sequence (chain number)

**Purpose.**  Defines the cryptographic ordering of the tamper-evidence
hash chain.  *Not* an identifier for the row (that's `AuditLogEntry.id`, a
UUID).  This value has to be decided *before* the row is inserted so it can
be included in the entry's own SHA-256 hash; a DB `SERIAL` / `IDENTITY` is
therefore unsuitable.

### In-memory / wire / DB representation

| Layer              | Type                     | Why                                                                                                           |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| TS type            | `AuditLogEntry.sequence: string`  | JSON has no native bigint; a decimal string round-trips cleanly through Next.js's server/client boundary and into audit exports. |
| Postgres column    | `BIGINT UNIQUE NOT NULL`  | 64-bit signed integer; preserves sort order inside the DB and keeps UNIQUE enforcement.                     |
| Arithmetic in code | `BigInt(…)` wrappers      | All `+` / comparison in `audit.ts` uses native `bigint`, never the JS `number` type, to avoid 2^53 loss.    |

The [db.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/db.ts)
mapper pair is the only place that converts between representations:

- Read:  `auditLogFromRow` → `sequence: r.sequence.toString()` (BigInt → string)
- Write: `auditLogToData`  → `sequence: BigInt(r.sequence)` (string → BigInt)

### Generation algorithm

Implemented in
[appendAuditLog()](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/audit.ts#L90-L129).

1. Walk every `AuditLogEntry` currently in `db.auditLogs`, order-independent.
2. `maxSequence = max(e.sequence)` using bigint-safe `cmpSeq`; also remember
   the matching `e.hash` as `previousHash`.
3. New sequence = `maxSequence + 1`, using bigint-safe `addSeq`.
4. Compute SHA-256 over `(previousHash, sequence, timestamp, …)` via a
   key-order-canonical JSON serializer (`canonicalStringify`) so Postgres
   `jsonb` key reordering doesn't break hash verification after a round-trip.
5. Prepend the new entry to `db.auditLogs`.

### Capacity

| Type (signed)            | Max value                        | Lifetime at 1,000 appends/sec   |
| ------------------------ | -------------------------------- | ------------------------------- |
| Postgres `INTEGER` (old) | 2,147,483,647                    | ~24 days                       |
| Postgres `BIGINT`        | 9,223,372,036,854,775,807        | **292,000+ years**              |
| Application string rep   | Unbounded decimal digits         | No ceiling                      |

The migration from `INTEGER` → `BIGINT` was made precisely because the
old 32-bit ceiling was within striking distance of a long-lived audit log
run rate of thousands of workday actions.  The current ceiling is
*functionally unreachable* for any plausible audit event rate NIB will
generate over the system's lifetime.

### Chain verification

[verifyAuditLogChain()](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/audit.ts#L142-L159)
re-sorts entries by sequence using the same bigint comparator, then walks
from genesis expecting exactly consecutive integers and recomputes each
hash; the first mismatch reports `valid: false` with the offending row's
`brokenAtSequence` (also as a decimal string to match the TS type).  The
admin audit-log viewer runs this check on every GET and renders a red
badge when the chain is broken.

---

## 4. Finding case itemization (`FindingCase.seq`)

**Purpose.**  1-based position of an itemized sub-case within its parent
finding, for the "3 cases totaling 45,000" feature of Document_3 §12/§34.

### Rules

- `seq ∈ [1, caseCount]`, assigned at creation by array index:
  `input.caseAmounts.map((amount, i) => ({ seq: i + 1, … }))` —
  [POST /api/findings](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/route.ts#L250-L258).
- Capped at `500` by the Zod schema (`caseAmounts.max(500)`).
- Never renumbered, never reused.  Editing case totals is blocked while
  itemized rows exist ([PATCH /api/findings/[id]](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/route.ts#L199-L208))
  to avoid drift.

### Capacity

Max `500` per finding.  Integer `seq` is a 32-bit Postgres `INT` with no
pressure — it's scoped per finding row, not global, so the total across
the whole DB is `findings × 500`, still well within `INT` range.

---

## 5. Password-reset tokens (`PasswordResetToken.token`)

Not a reference ID per se, but often confused with one.  It is a
**32 crypto-random bytes**, hex-encoded (64 chars), generated in
`forgot-password/route.ts` via
`crypto.randomBytes(32).toString("hex")`.  Stored raw rather than hashed
(the schema comment in
[schema.prisma#L118-L123](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/prisma/schema.prisma#L118-L123)
explains the threat model).  Capacity is indistinguishable from random —
effectively 2^256 distinct values, single-use with 30-minute TTL.

---

## 6. Migration path for the two schema changes above

Both fixes (`Finding.reference` algorithm upgrade, audit `BIGINT`) require
a **Prisma schema diff** — no data-change migration is needed for the
reference algorithm (the fix is pure code, existing values stay valid),
but the audit-log column type requires one ALTER.

### 6a. Finding reference: no DB migration

Existing references in the 3-digit padded form `BR042-2026-09-007` remain
perfectly valid: the MAX parser reads any integer suffix regardless of
pad width, so a mix of old 3-digit and new 5-digit entries sorts and
increments correctly with no backfill required.

### 6b. Audit sequence: run a migration to BIGINT

Because the column changed from `Int` to `BigInt` in the schema, run:

```bash
npx prisma migrate dev --name audit_log_sequence_bigint
```

This generates a migration that executes roughly:

```sql
ALTER TABLE audit_logs ALTER COLUMN sequence TYPE BIGINT;
```

All existing values in `audit_logs.sequence` (currently in the thousands
or millions range) fit into BIGINT with no change to their numeric value,
and the `UNIQUE` constraint is preserved.  **No backfill, no row rewrite
beyond the type cast, no downtime beyond a brief exclusive lock on the
metadata.**

### 6c. Regenerate the Prisma client

After any schema change the generated client must be refreshed so its
TS types for `AuditLogEntry.sequence` switch from `number` to `bigint`:

```bash
npx prisma generate
```

---

## 7. Summary table — "can it support large volumes?"

| Scheme                            | Logical unit              | Scoped to…                | Hard ceiling (or effective)       | Is it enough?                          |
| --------------------------------- | ------------------------- | ------------------------- | --------------------------------- | -------------------------------------- |
| Finding reference suffix          | Integer, lowest free      | one `(branch, period)`    | Unlimited (string) after 99 999  | Yes.  Thousands/period → ~100yrs+.     |
| Entity PK (`id`, UUID v4)         | 122 random bits           | global                    | 2^122 distinct values             | Yes.  Statistically unreachable.        |
| Audit chain `sequence`            | BIGINT + app string      | global (chain order)      | 9.2 × 10^18 (Postgres BIGINT)     | Yes.  292k years @ 1k/sec.              |
| FindingCase.seq                   | 1..N                      | one finding               | 500 (Zod cap) + INT storage       | Yes.  Itemization cap by design.        |
| PasswordResetToken.token          | 32 crypto bytes           | per user, TTL 30 min      | 2^256, single-use                 | Yes.  Brute-force infeasible.           |

None of the schemes in use today have a **near-term** wraparound or
out-of-ID risk.  The one that *did* have a real overflow path (32-bit
audit `INTEGER` ceiling at ~2.1B) has been upgraded to 64-bit BIGINT in
the schema; the other three were already effectively unbounded.
