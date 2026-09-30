# Reopening Closed Findings

A **closed** or **partially closed** finding can be reset to a fresh **Sent to Branch Manager**, as if nothing had been rectified yet.

- **Where:** the finding's page → **Reopen** (next to Edit/Submit/Delete).
- **Who:** roles with **Findings › Reopen Closed / Partially Closed Findings** (`findings.reopen`). The Administrator has it; grant it to other roles in Roles & Permissions. The finding must be in your organisational scope and its reporting period must not be locked.
- **Reason:** required (at least 5 characters), in a confirmation dialog **before** anything changes.

## What changes

| | After reopening |
|---|---|
| Status | `SENT_TO_BRANCH_MANAGER` (recorded as a `REOPEN` step) |
| Rectified / district-verified / closed cases and amounts | 0 |
| Rectification and closure records | removed, so they no longer count in performance %, dashboards or reports |
| Itemized cases | back to *Outstanding* |
| Transfers | kept (movement history) |

## What is kept

- The **full workflow history** on the finding (every earlier step plus the new `REOPEN` step with its reason).
- The **audit log** entry `REOPEN_RESET`, with the reason and a snapshot of the previous figures and every removed rectification / closure record.

The branch's rectifiers and the registrant get a **Reopened** notification (it can be switched on/off for email in Settings → Email Events).

Code: `src/lib/findingReopen.ts`, `src/app/api/findings/[id]/reopen/route.ts`. Error code when not applicable: `FINDING_NOT_REOPENABLE`.
