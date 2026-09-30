# Reopening (Reversing) Closed Findings

**Reopen reverses a finding back to its original "sent to the branch" state, with status REVERSED.** It works on a **closed** finding and on a **partially closed** one, including a **transferred** finding part of which was closed before it moved on.

- **Where:** the finding's page → **Reopen**.
- **Who:** roles with **Findings › Reopen Closed / Partially Closed Findings** (`findings.reopen`). The Administrator has it and can grant it to other roles.
- **Conditions:** the finding is in your organisational scope, and **no period its rectifications or closures were credited to is locked**. That means its current period, and for a transferred finding also the earlier period.
- **Reason:** required (at least 5 characters), in a confirmation dialog **before** anything changes.

## What changes

| | After reopening |
|---|---|
| Status | **REVERSED** |
| Rectified, district-verified and closed cases and amounts | 0 |
| Rectification and closure records | removed, so they **no longer count** in performance %, dashboards or reports, in whichever period they were credited |
| Itemized cases | back to *Outstanding* |
| Transfers | kept (movement history) |

## The REVERSED status

REVERSED is the same state as **Sent to Branch Manager**, and the workflow treats it the same way. The branch sees it in its work queue and must rectify it again. It then moves on as usual (Partially Rectified → Rectified → verified → Closed), and can also be transferred or reminded about. It counts as an official, outstanding finding on the dashboards. The separate name just makes it visible that the finding was reversed.

## What is kept

- The **full workflow history**, plus a *Reopen* step (old status → REVERSED) with the reason.
- The **audit log** entry `REOPEN_REVERSED`, with the reason and a snapshot of every removed rectification and closure and the previous figures.

**Who is told:** the branch's rectifiers and the registrant get a **Reopened** notification. Its email can be switched on or off in Settings → Email Events.

Code: `src/lib/findingReopen.ts`, `src/app/api/findings/[id]/reopen/route.ts`. Error codes: `FINDING_NOT_REOPENABLE` (nothing closed), `PERIOD_LOCKED`.
