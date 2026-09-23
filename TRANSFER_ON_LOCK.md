# Transfer on Lock — Operational & Implementation Rules

This document is the single source of truth for how NIB Control360 handles
**outstanding findings whose source reporting period is being locked**,
either manually (District / HO Controller's one-at-a-time action) or via
the automatic sweep at lock time.

It covers:

1.  What a transfer *is* (and is not) — definition, data mutations, snapshots.
2.  When it can run — status gates, period-state gates, source vs destination.
3.  The two paths — **Manual Transfer** vs **Automatic on-Lock Sweep**.
4.  What exactly happens when `transferOverdueCases: true` on the Lock dialog.
5.  Fallback playbook for when transfer is *not* immediately possible (no
    destination open, finding in the wrong status, etc.).

Reference the source files for the authoritative code — every rule below is
linked to its implementing line.

---

## 1. What a transfer is (and is not)

**Is a mutation of one existing `Finding` row.** Implemented in
[transferFinding()](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/findings.ts#L27-L74).

It does **not** create a new `Finding` row.  This matches master.txt §8:
*"a transferred case is a continuation, not a new finding"*.  The
identifiers that track its provenance are preserved:

| Field on Finding      | Behavior on transfer                                                               |
| --------------------- | ---------------------------------------------------------------------------------- |
| `id`                  | Never changes — same UUID keeps traveling with the case.                          |
| `createdAt`           | Never changes — case age is tracked from original registration.                  |
| `createdBy`           | Never changes — audit of who originally raised the finding is intact.             |
| `periodId`            | **Rewritten** to the destination period.  This is the essential "movement".      |
| `reference`           | **Regenerated** against the new `(branch, period)` using `nextFindingReference()`.|
| `status`              | **Regressed** to `SENT_TO_BRANCH_MANAGER` so the new period's branch manager has it explicitly in their inbox. |
| outstanding / resolved / unresolved fields | Left unchanged on the Finding row itself; what actually crossed periods is snapshotted separately (below). |

What *is* written new is a `TransferEntry` row (in `Finding.transfers`),
a per-hop snapshot of the outstanding balance at the moment of transfer —
fields `referenceAtTransfer`, `outstandingAmount`, `outstandingCaseCount`,
`resolvedAmount`, `resolvedCaseCount`, `unresolvedAmount`,
`unresolvedCaseCount`, `caseAgeDays`.  Those snapshots let period-scoped
dashboards correctly attribute a *partially* rectified finding to the
period where each portion happened (see
`findingsResidentInPeriod()` / `findingCasesEligibleInPeriod()` in
src/lib/findings.ts).

---

## 2. Transfer gates — who, what statuses, what period states

### 2a. Permission

You need `findings.transfer`.  Per the district-controller permission
bundle in `db.ts`, this means **District Controller, HO Controller, or
Admin**.  Branch auditors and branch managers cannot transfer — transfers
are an internal controller-level move, not a branch-level one.

Additionally `assertFindingInScope(auth.session, existing)` in the manual
transfer route enforces district scoping — a controller scoped to only
District-04 can't yank a finding out of District-07, even if they have the
permission name.

### 2b. Finding status eligibility

Two arrays are kept in lockstep (manual route + auto-sweep helper):

- Manual — [TRANSFERABLE_STATUSES](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/transfer/route.ts#L14)
- Auto   — [AUTO_TRANSFERABLE_STATUSES](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/lib/findings.ts#L96)

Both are the same set:

```
SENT_TO_BRANCH_MANAGER, PARTIALLY_RECTIFIED, RECTIFIED,
RECTIFICATION_RETURNED, TRANSFERRED
```

Deliberately **excluded**:

| Excluded status | Why                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DRAFT`         | A draft finding hasn't been formally submitted — no branch manager has received it yet.  Submit it past draft first, or delete it if it shouldn't exist. |
| `WAITING_CLOSURE_APPROVAL` | Either approve the closure (→ `CLOSED`, nothing to transfer) or reject it (→ `RECTIFIED`, eligible).  The close-vs-transfer decision isn't automated.  |
| `CLOSED`        | Terminal state.  The case is resolved; nothing remains to carry forward.                                                                             |

### 2c. Destination period rules

Hard-coded in the manual route at
[transfer/route.ts#L48-L55](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/transfer/route.ts#L48-L55):

1.  Must be **a different period** than the current `finding.periodId`.
2.  Must exist (the `toPeriodId` UUID resolves).
3.  Must be **`OPEN`**.  A locked destination is rejected with the 409
    `"Destination period must be open"`.

The source period has **no** such restriction.  See the comment at
[transfer/route.ts#L23-L25](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/transfer/route.ts#L23-L25):

> *"Deliberately skips assertPeriodWritable() on the *source* period:
> transfer is the intended path once a period locks with the finding
> still outstanding."*

In plain English: **you can transfer *out* of a LOCKED period.**  The lock
protects *new writes into* the period; a transfer is modeled as a forward
migration *out* of it, not a write into it.

---

## 3. Path 1 — Manual Transfer

Route: `POST /api/findings/[id]/transfer` —
[transfer/route.ts](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/transfer/route.ts).

Body:

```jsonc
{
  "toPeriodId": "<uuid of the destination period>",
  "reason": "<free text, at least 1 char>"
}
```

Behavior:

1.  Permission + scope + status checks (see §2).  Any failure → 401/403/404/409.
2.  Destination lookup + validity checks. Any failure → 400/404/409.
3.  Inside an `updateDb()` Prisma transaction:
    - Call `transferFinding(current, f, { toPeriodId, reason, userId, userName })`.
    - Write an in-app notification (type `TRANSFERRED`) to the original
      creator and every user with findings.transfer permission in the same
      district, so everyone with standing knows the finding moved.
4.  Return the fresh Finding row (with new periodId, new reference,
    regressed status).

---

## 4. Path 2 — Automatic Transfer on Period Lock

Runs inside the admin PATCH route for a reporting period, specifically on
the `OPEN → LOCKED` status transition.  Source:
[reporting-periods/[id]/route.ts#L184-L206](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/admin/reporting-periods/%5Bid%5D/route.ts#L184-L206).

### 4a. Four conditions must all be true

1.  **Genuine lock transition.** `isStatusChange && status === "LOCKED"`.
    Does NOT run when a user just edits `draftsAllowedWhileLocked` on an
    already-LOCKED period (flag-only edit).
2.  **Admin enabled the feature globally.**
    `Settings.autoTransferOnLock === true` — master switch in System
    Settings.  If an Admin turns it off, the lock dialog won't even show
    the checkbox.
3.  **Locking user explicitly confirmed.**
    `transferOverdueCases: true` on the PATCH payload.  This comes from
    the checkbox in the Lock dialog, which the UI only checks by default
    if there is something *to* transfer and a destination exists.
4.  **A destination exists.** `autoTransferOnLock()` itself checks
    `nextOpenPeriodAfter(db, period)` — the chronologically first OPEN
    period whose `startsAt` is *after* the locking period's `startsAt`.
    If none, it short-circuits with `{ transferredCount: 0, skippedNoDestination: true }`.

### 4b. What the sweep actually does

```ts
for (const f of outstandingFindingsInPeriod(db, lockedPeriod)) {
  transferFinding(db, f, {
    toPeriodId: destination.id,
    initiator: "AUTOMATIC",
    userId, userName,
    reason: `Automatic transfer - ${lockedPeriod.code} locked with this finding still outstanding, transfer confirmed by the locking user.`,
  });
}
```

That is: it loops over every finding still in that period whose status is
`∈ AUTO_TRANSFERABLE_STATUSES` and calls the exact same `transferFinding()`
engine as manual transfer.  Findings that were already manually
transferred out before the lock hit are naturally skipped — their
`periodId` is no longer this period.

`initiator: "AUTOMATIC"` is written into every produced `TransferEntry`,
distinguishable from `MANUAL` on the finding's transfer history view.

After the loop, if anything moved, an `AUTO_TRANSFER` audit-log entry is
written at the ReportingPeriod level with `newValue: { transferredCount }`
so the admin lock event is traceable to the sweep count.

### 4c. Lock dialog rendering (what the admin sees)

Source: [reporting-periods/page.tsx#L439-L497](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/(app)/admin/reporting-periods/page.tsx#L439-L497).

The Lock UI is served a `PeriodWithTransferPreview` that precomputes
`outstandingTransferableCount` (how many eligible findings are sitting in
this period) and `transferDestinationCode` (the `code` of the next OPEN
period, or `null` if none).

Behavior of the checkbox / warning:

- Only shown if: `!isFlagEditOnly && autoTransferAllowed && outstandingTransferableCount > 0`.
- If a destination exists → checkbox labeled
  *"Transfer N outstanding case(s) to <code>?"* — default checked.
- If destination is `null` → **amber paragraph** instead of checkbox:

  > *"N outstanding cases in <code>, but there's no open period after it to
  > transfer into — open a later period first if you want to transfer them."*

This is the only place the admin is told about a missing destination.  The
back-end route itself is silent when `skippedNoDestination: true` — it
doesn't fail the lock, just skips the sweep.  The UI paragraph exists so
an admin never locks expecting a sweep that can't happen.

---

## 5. Transfer-failure playbook — "what do I do if it's NOT working?"

Every branch of the decision tree below has a documented code link so you
can verify which rule fired.

### 5a. Locked the source period, forgot to enable the sweep

**State:** Source period is now LOCKED.  Eligible findings are still in it.

**Fix:** You don't need to unlock.  Transfer is explicitly allowed out of
a LOCKED source — use the manual **Transfer** action on each finding.

Code basis: [transfer/route.ts#L23-L25](file:///c:/Users/HP/Desktop/AdonayAudit/auditapp/src/app/api/findings/%5Bid%5D/transfer/route.ts#L23-L25)
(no `assertPeriodWritable` on source).

### 5b. Lock dialog shows the amber "no open period after it" banner

**State:** Outstanding findings exist, but nowhere to send them.

**Fix (3 steps):**

1.  Admin → Reporting Periods → **Create Period** for the next
    chronological window (e.g. if locking `2026-09`, create `2026-10`).
    New periods are created **LOCKED by default** with drafts allowed.
2.  On the new period, click **Unlock** (reason ≥ 5 chars, audit-logged).
3.  Either:
    - Manually transfer the findings (button on each finding), OR
    - If the source is still OPEN, cancel the in-progress lock and open
      the dialog again — the preview now shows a destination code and a
      pre-checked auto-transfer checkbox, so a single Lock call sweeps
      them all.

### 5c. Destination period is LOCKED → 409 "Destination period must be open"

**Fix:**

1.  Unlock the destination (admin permission + reason, audit-logged).
2.  Perform the transfer (either manual one-by-one, or re-sweep by
    unlocking the source briefly and re-locking with `transferOverdueCases: true`).
3.  Re-lock the destination when everything has landed.

### 5d. Finding is in `DRAFT` — no transfer button / 409

Two choices:
- **Finish it:** submit past draft (→ `SENT_TO_BRANCH_MANAGER`, eligible).
- **Delete it:** if it shouldn't be registered at all.

### 5e. Finding is in `WAITING_CLOSURE_APPROVAL`

Two choices:
- **Approve closure** → `CLOSED` (nothing left to transfer; done).
- **Reject closure** → `RECTIFIED` (eligible; transfer now works).

### 5f. Finding is `CLOSED`

Terminal by design.  If a closure was approved in error, use the
**Reject Close** route to regress back to `RECTIFIED`, then transfer.

---

## 6. Fallback of last resort — Unlock → fix → Re-lock

If none of the targeted fixes above fit (e.g., you need to change the
finding's *branch* before transferring, which requires edit access that
the lock genuinely blocks), the admin escape hatch is:

```
Unlock source period (reason: "Retro-transfer prep — N findings")
   → edit findings as needed (branch, rectify, reject-close, etc.)
   → transfer
   → re-lock source period with same or updated reason
```

Every one of those state changes writes its own entry in the audit log
(`UNLOCK`, one or more `TRANSFER`, `LOCK`, plus per-finding `TRANSFER`
rows and `Finding.transfers` snapshots), so the sequence of operations is
fully auditable even if the lock state had to be briefly reversed.

---

## 7. Quick reference decision tree

```
Need to move a finding whose period is / is being locked?
│
├─ Any eligible status?
│    ├─ DRAFT                      → Submit or delete first.
│    ├─ WAITING_CLOSURE_APPROVAL   → Approve or reject closure first.
│    ├─ CLOSED                     → Done (or reject close + transfer).
│    └─ (5 eligible statuses)      → Continue below.
│
├─ Is there an OPEN destination period after this one?
│    ├─ NO  → Create + unlock a later period first.
│    └─ YES →
│         ├─ One finding → Click **Transfer** manually (works even if
│         │                     source is already LOCKED — see §2c).
│         └─ Many findings at lock time → Lock dialog auto-transfer
│                                          checkbox (Path 2).
│
└─ Destination blocked → Temporarily unlock destination, transfer,
                          re-lock destination (§5c).
```
