# Reopening Closed Findings

**Reopen reverses a closure.** It works on a **closed** finding and on a **partially closed** one, including a **transferred** finding part of which was closed before it moved on.

- **Where:** the finding's page → **Reopen**.
- **Who:** roles with **Findings › Reopen Closed / Partially Closed Findings** (`findings.reopen`). The Administrator has it and can grant it to other roles.
- **Conditions:** the finding is in your organisational scope, and **no period the closure was credited to is locked**. That means its current period, and for a transferred finding also the period it was closed in.
- **Reason:** required (at least 5 characters), in a confirmation dialog **before** anything changes.

## What changes

| | After reopening |
|---|---|
| Closure records | removed, so they **no longer count** in performance %, dashboards or reports, in whichever period they were credited |
| Closed cases / amount | 0 |
| Status | **reversed**. A **closed** finding returns to the status it had **just before it was closed**, taken from its own history (usually *Rectified* or *Partially Rectified*). A **partially closed** finding keeps its current status (e.g. *Transferred*) |
| Rectifications and district verifications | **kept**. Only the closure is undone, so the closer can review it and close it again |
| Transfers, itemized cases, comments, evidence | unchanged |

## What is kept

- The **full workflow history**, plus a *Reopen* step (closed → previous status) with the reason when the status changes.
- The **audit log** entry `REOPEN_CLOSURE_REVERSED`, with the reason and a snapshot of every removed closure and the previous figures.

**Who is told:** the district's closers (they can close it again), the branch's rectifiers and the registrant get a **Reopened** notification. Its email can be switched on or off in Settings → Email Events.

Code: `src/lib/findingReopen.ts`, `src/app/api/findings/[id]/reopen/route.ts`. Error codes: `FINDING_NOT_REOPENABLE` (nothing closed), `PERIOD_LOCKED`.
