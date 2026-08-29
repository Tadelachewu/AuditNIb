# Rectification — `PARTIALLY_RECTIFIED` vs `RECTIFIED`

How the app decides between these two statuses, exactly what changes
underneath each one, and what happens next in either case. Everything
here reflects `src/app/api/findings/[id]/rectify/route.ts` as it stands —
this is the *only* place either status is ever set.

For where rectification sits in the overall lifecycle, see
[FINDINGS_WORKFLOW.md](FINDINGS_WORKFLOW.md) §5.

---

## 1. The one rule that decides everything

Every rectification call updates two running totals on the `Finding`
itself:

```
finding.rectifiedCases  += rectifiedCases   (this call's amount)
finding.rectifiedAmount += rectifiedAmount  (this call's amount)
```

Then, **and only then**, one check decides the resulting status:

```ts
const fullyRectified = f.rectifiedCases >= f.caseCount && f.rectifiedAmount >= f.amount;
const toStatus = fullyRectified ? "RECTIFIED" : "PARTIALLY_RECTIFIED";
```

**Both** the case count **and** the amount must be fully covered for the
finding to become `RECTIFIED`. If either dimension still falls short —
even by one case, or one currency unit — the finding lands (or stays) at
`PARTIALLY_RECTIFIED`. There is no independent "cases done" vs. "amount
done" status; the two are evaluated together, every time.

**Concretely**: a 3-case / ETB 45,000 finding where all 3 cases were
fixed but only ETB 40,000 was recorded is still `PARTIALLY_RECTIFIED` —
the outstanding amount (ETB 5,000) is what's keeping it open, even though
every case is nominally closed out.

---

## 2. What "outstanding" means, and how it's validated

Outstanding is never stored — it's computed on every read:

```
outstandingCases  = finding.caseCount - finding.rectifiedCases
outstandingAmount = finding.amount    - finding.rectifiedAmount
```

Before a rectification is accepted, the route checks the **submitted**
amounts against outstanding, independently for cases and for amount:

- `rectifiedCases > outstandingCases` → `400`, rejected, nothing changes.
- `rectifiedAmount > outstandingAmount` → `400`, rejected, nothing changes.
- Both `0` → `400` ("Enter at least a rectified case count or amount") —
  a no-op call is refused rather than silently accepted.

This is the BRD's own worked example, reproduced exactly: a 3-case /
ETB 45,000 finding, rectify 1 case / ETB 10,000 → the *next* call's
ceiling is correctly 2 cases / ETB 35,000, not the original 3 / 45,000.

---

## 3. `PARTIALLY_RECTIFIED` — what it means, what's still possible

**Reached when**: a rectification was accepted, but cases and/or amount
still fall short of the total.

**What it signals**: the Branch Manager has made *some* documented
progress, but the finding is not yet done. It stays visible in the
rectify-holder's work queue.

**What's still possible from here**:
- **Rectify again** — `PARTIALLY_RECTIFIED` is itself one of the three
  statuses the rectify route accepts (`SENT_TO_BRANCH_MANAGER`,
  `PARTIALLY_RECTIFIED`, `TRANSFERRED`), so further partial (or
  final) rectifications can keep being recorded, each appending its own
  ledger entry and narrowing the outstanding balance further.
- **Transfer** — if the reporting period locks while a finding is still
  `PARTIALLY_RECTIFIED`, the District Controller can transfer the
  *remaining outstanding* balance into a new open period (see
  [FINDINGS_WORKFLOW.md](FINDINGS_WORKFLOW.md) §6). Rectification then
  continues there, against the same running totals — the finding is not
  reset or duplicated.
- **Closeable for the rectified-to-date portion** — a District/HO
  Controller can verify-and-close whatever's been rectified so far even
  while the finding is still `PARTIALLY_RECTIFIED` overall; the
  still-unrectified remainder stays open and untouched. See §10. There is
  still no path that skips or writes off the remaining balance — it can
  only be closed once it's actually rectified.

**Two different notifications, two different audiences.** A district/HO
Controller (`findings.close` holders, scoped to the district) is only
paged on *full* rectification (§4) — "there's now something to verify and
close," not "some progress was made." Separately, *every* rectification
call — partial or full — notifies the other `findings.rectify` holder(s)
at that same branch (Branch Manager and Branch Internal Controller both
hold it; icfms.txt gives the Controller a "verify rectifications" duty),
excluding whoever just recorded it. That's what puts a rectification
event in front of the Controller to acknowledge (mark-as-read in the
notification bell) even when the finding isn't fully done yet.

---

## 4. `RECTIFIED` — what it means, what's still possible

**Reached when**: a rectification call brings both `rectifiedCases` and
`rectifiedAmount` to meet or exceed the finding's `caseCount`/`amount`.
This can happen on the **very first** rectify call if the whole balance
is recorded at once — `PARTIALLY_RECTIFIED` is not a required stepping
stone, it only appears if the fix is genuinely partial.

**What fires immediately**: every district/HO controller in that
district who holds `findings.close` gets a notification —
*"`<reference>` fully rectified... Ready to verify and close."* This is
the one moment in the whole rectification flow that pages anyone.

**What's still possible from here — deliberately narrow**:
- **Close** — the *only* forward action. Closing is not self-service: the
  Branch Manager who just recorded the fix does **not** hold
  `findings.close` by default. A District or HO Controller — someone
  independent of who did the fixing — has to verify and close it. This is
  separation-of-duties made structural, not a paper rule (verified live: a
  Branch Manager's own close attempt on their own rectification returns
  `403`). See §10 for how closing behaves when the finding got here via a
  partial rectification followed by more rectification (`rectifiedCases`
  can outrun `closedCases`).
- **Rectify again — blocked.** `RECTIFIED` is *not* in the rectify
  route's accepted-status list. A further rectify attempt returns `409`
  ("This finding isn't awaiting rectification"), not a confusing
  "exceeds outstanding by 0" error. There is nothing left to rectify by
  definition, so the route refuses to try.
- **Transfer — blocked.** `RECTIFIED` is likewise not in the transfer
  route's accepted-status list. There's no outstanding balance left to
  carry into a new period.

`RECTIFIED` is therefore a narrow, single-purpose waypoint: nothing can
happen to the finding except closing it (or, in principle, waiting — it
can sit at `RECTIFIED` indefinitely if nobody closes it yet).

---

## 5. The ledger vs. the running total

Every accepted rectify call, partial or full, appends a permanent
`RectificationEntry` row (`findingId`, `periodId`, `rectifiedCases`,
`rectifiedAmount`, an optional `note`, who submitted it, when) — this is
the audit trail, shown on the finding detail page as the **Rectification
Ledger**, oldest call to most recent. Every entry is therefore a real
transaction linked to a user, a date, and a period, satisfying that
requirement directly rather than by inference.

`periodId` is a **snapshot** of `finding.periodId` at the moment the
entry is written, not a live reference to the finding's current period.
This matters specifically because of Transfer (§6): a transfer changes
`finding.periodId` going forward, but a rectification recorded *before*
that transfer genuinely happened in the old period and must stay
attributed to it. Verified live: rectifying a finding, then transferring
it, then rectifying again — the first `RectificationEntry` still reads
the original period; only the second reads the new one.

The **running total** (`finding.rectifiedCases`/`rectifiedAmount`, and
therefore "outstanding") lives separately, on the `Finding` itself, kept
in lockstep with the ledger by the same route in the same request. The
ledger is never summed on the fly to derive the total — the two are
written together, so they can't drift apart.

A finding that took three separate rectification calls to close out will
show three ledger rows, but the finding's own `rectifiedCases`/`rectifiedAmount`
fields always reflect the cumulative sum after the most recent one.

---

## 6. Side by side

| | `PARTIALLY_RECTIFIED` | `RECTIFIED` |
|---|---|---|
| Reached when | Cases **or** amount still short of the total | Cases **and** amount both meet/exceed the total |
| Can rectify again? | ✅ Yes — still in the accepted-status list | ❌ No — `409`, not in the accepted-status list |
| Can transfer? | ✅ Yes — outstanding balance can move to a new period | ❌ No — nothing outstanding to move |
| Can close? | ✅ Yes, for whatever's rectified so far (§10) — the rest stays open | ✅ Yes — fully closes it |
| Notification fired? | None | Every close-holder in that district |
| Who can act next | Branch Manager / Branch Controller (rectify), District Controller (transfer) | District/HO Controller only (close) — not the Branch Manager who fixed it |
| Terminal? | No | No (one step from terminal — `CLOSED`) |

---

## 7. Worked example, start to end

The BRD's own numbers (3 cases / ETB 45,000), carried through both
statuses:

1. Finding reaches `SENT_TO_BRANCH_MANAGER` — outstanding 3 cases / ETB 45,000.
2. Branch Manager rectifies **1 case / ETB 10,000**. `1 < 3` and
   `10,000 < 45,000` → status becomes `PARTIALLY_RECTIFIED`. Outstanding
   is now correctly 2 cases / ETB 35,000. No notification.
3. Branch Manager attempts to rectify **4 cases** (more than the 2
   outstanding) → `400`, rejected, nothing changes.
4. Branch Manager rectifies the remaining **2 cases / ETB 35,000**.
   `1+2 = 3 ≥ 3` and `10,000+35,000 = 45,000 ≥ 45,000` → status becomes
   `RECTIFIED`. District/HO close-holders are notified.
5. Branch Manager attempts to close it → `403` (not their permission).
6. Branch Manager attempts to rectify again (nothing left) → `409`.
7. District Controller closes it → `CLOSED`, terminal.

The Rectification Ledger on this finding shows exactly two entries — one
per step 2 and step 4 — while `rectifiedCases`/`rectifiedAmount` on the
finding itself read `3` / `45000` from step 4 onward.

---

## 8. "A finding may represent multiple similar cases" — the partial-rectification rule

A finding can bundle several individual incidents into one record — the
canonical example: a 3-case / ETB 45,000 finding that's actually three
distinct cash-shortage incidents:

| Case | Amount (ETB) |
|---|---|
| Case 1 | 15,000 |
| Case 2 | 10,000 |
| Case 3 | 20,000 |
| **Total** | **45,000** |

If the Branch Manager fixes **only Case 2**, the system must end up
recording exactly: `caseCount = 3`, `amount = 45,000`,
`rectifiedCases = 1`, `rectifiedAmount = 10,000`, `outstandingCases = 2`,
`outstandingAmount = 35,000` — and the outstanding portion (Cases 1 and
3) must remain available for future rectification.

**This is already exactly what the app does today**, with one thing
worth being precise about: `Finding` stores one `caseCount` and one
`amount` **total** — it does not store an itemized list of Case
1/2/3 with their own individual amounts. Recording "fix Case 2" is done
as `POST /api/findings/[id]/rectify { rectifiedCases: 1, rectifiedAmount: 10000, note: "Case 2 resolved - ..." }` —
the `note` field is where *which specific case* is recorded, in free
text, not as a structured, independently-validated reference to a stored
per-case entity. The system trusts that the Branch Manager's `1 case /
ETB 10,000` genuinely corresponds to a real case within the finding; it
doesn't (today) verify that 10,000 matches a specific stored case amount,
because individual case amounts aren't stored at all — only the
finding-level total is.

The **arithmetic** this rule actually cares about — outstanding cases
and amount narrowing correctly, the untouched portion staying available,
`PARTIALLY_RECTIFIED` vs `RECTIFIED` resolving correctly — is fully
covered by §1–§2 above regardless of whether "1 case" refers to a
specific named case or is just a count. If a future requirement needs the
system itself to enumerate individual cases (so a reviewer could look up
"which case was Case 2, exactly") that would be a real, separate data
model addition — a per-case sub-entity under `Finding` — not something
the current `caseCount`/`amount` pair can express.

---

## 9. Period performance after a transfer

`transferFinding()` (src/lib/findings.ts) never splits a finding — it
carries the same identity forward and moves only the outstanding balance
(master.txt §8: "Transfer only unresolved cases and amount," "Keep
original finding and full transfer history"). That means `finding.periodId`
always points at wherever the finding currently sits, and a rectification
recorded *before* a transfer happened while the finding still belonged to
the origin period.

`computePerformance()` doesn't rely on `finding.periodId` alone for a
period-scoped query. Instead, for each candidate finding it:

- Finds how many cases were **eligible during that specific period** by
  walking the finding's transfer chain (`findingCasesEligibleInPeriod()`):
  the original period gets the finding's full `caseCount`; every period it
  passed through afterward gets exactly the `casesTransferred` figure
  recorded on the transfer that carried it in. Each hop's cases count
  toward exactly one period's eligible total, never two.
- Sums rectified credit from the `RectificationEntry` ledger rows stamped
  with that period's id, not the finding's lifetime `rectifiedCases` — so
  work done before a transfer stays credited to the period it actually
  happened in.

Worked example: a 3-case / ETB 45,000 finding gets 1 case / ETB 10,000
rectified while still in Period A, then Period A locks and it transfers to
Period B carrying 2 cases / ETB 35,000. Period A's report still shows
3 eligible cases with 1 rectified (33%); Period B's report shows 2 eligible
cases, credited only for whatever gets rectified while it's there.

Queries with no `periodId` in scope (bank-wide, all-time) are unaffected —
they still sum `caseCount`/`rectifiedCases` straight off the finding,
which is exactly the lifetime total regardless of how many periods it
passed through.

---

## 10. Closing the rectified portion while the rest stays open

**The rule**: a District/HO Controller can verify-and-close whatever's
currently rectified-but-not-yet-closed at any time — they are not forced
to wait for the entire finding to reach `RECTIFIED` first. The
still-unrectified remainder keeps going through rectify/transfer exactly
as before, untouched by closing.

**Two running totals, not one**: `Finding` carries `closedCases`/
`closedAmount` alongside `rectifiedCases`/`rectifiedAmount`. The
invariant is `closedCases ≤ rectifiedCases` and `closedAmount ≤
rectifiedAmount` — you can only close what's actually been rectified,
never ahead of it. Each close call is recorded as its own
`FindingClosure` ledger row (mirrors `RectificationEntry`), and the
finding's `closedCases`/`closedAmount` are the cumulative sum, kept in
lockstep the same way `rectifiedCases`/`rectifiedAmount` are.

**What one call to `POST /api/findings/[id]/close` does**: closes
*everything* currently rectified-but-unclosed in one shot —
`closableCases = rectifiedCases - closedCases`,
`closableAmount = rectifiedAmount - closedAmount`. There's no partial-of-
partial input; if more gets rectified later, Close becomes available
again for that new increment.

**Status stays governed by the rectify/transfer axis, not closing** — a
partial close does not introduce a new `FindingStatus` value. `status`
keeps meaning exactly what it always has (progress toward full
rectification, or a transfer having happened); closing is a second,
independent axis layered on top via the two counters. The **one**
exception: once `closedCases ≥ caseCount` and `closedAmount ≥ amount`,
status moves to the terminal `CLOSED`, exactly as before — a fully closed
finding is still fully closed regardless of how many increments it took
to get there.

**Worked example**: a 3-case / ETB 45,000 finding gets 1 case / ETB
10,000 rectified (`PARTIALLY_RECTIFIED`). The District Controller closes
it — `closedCases: 1`, `closedAmount: 10,000` — status **stays**
`PARTIALLY_RECTIFIED` (2 cases / ETB 35,000 are still unrectified). Later
the Branch Manager rectifies the remaining 2 cases / ETB 35,000 →
`rectifiedCases` reaches `3`, status becomes `RECTIFIED`. The controller
closes again — `closableCases = 3 - 1 = 2`, `closableAmount = 45,000 -
10,000 = 35,000` — bringing `closedCases`/`closedAmount` to the full
total, and status becomes `CLOSED`. The Closure Ledger on this finding
shows exactly two rows, one per close call.

**Why this doesn't conflict with "keep original finding, don't
double-count"** (master.txt §8, §9 above): this feature never splits the
finding into two records and never touches `caseCount`/`amount`/
`periodId`. It only changes *when* the close action is allowed to run —
the finding's identity, transfer chain, and period attribution are
exactly as described in §1–§9.
