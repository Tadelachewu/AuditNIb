# NIB Control360 — Test Scenarios (Start to End)

Every scenario below is directly executable against the seeded demo data
(`npm run dev`, seeded on first run). Seeded accounts, all password
`<Role>@1<digits>` as shown on `/login`'s own demo-credentials panel:

| Username | Password | Role | Org unit |
|---|---|---|---|
| `admin` | `Admin@123` | Administrator | Bank-wide |
| `ho.controller` | `Ho@12345` | HO Internal Controller | Bank-wide |
| `district.controller` | `District@123` | District Internal Controller | Addis Ababa District |
| `district.director` | `Director@123` | District Director | Addis Ababa District |
| `branch.controller` | `Branch@123` | Branch Internal Controller | Bole Branch |
| `branch.manager` | `Manager@123` | Branch Manager | Bole Branch |
| `executive` | `Executive@123` | Executive (Read-only) | Bank-wide |

Scenarios are grouped in the order a full run-through would actually hit
them — auth first, admin setup next, then the Findings lifecycle
start-to-end, then the cross-cutting checks (permissions, org-scope,
period locks) that apply throughout. Each scenario states **Actor**,
**Steps**, and **Expected**. A ✅/❌ column is left blank for whoever runs
the pass to fill in.

---

## 1. Authentication & Session

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 1.1 | Anyone | Visit any page (e.g. `/dashboard`) while logged out | Redirected to `/login?from=/dashboard` |  |
| 1.2 | Each of the 7 seeded users | Log in with correct credentials | `200`, redirected to `/dashboard`, correct role/name shown in Topbar |  |
| 1.3 | Anyone | Log in with a wrong password | `401 Invalid username or password`, no session created |  |
| 1.4 | Anyone | Log in with a non-existent username | `401`, same generic message (no username enumeration) |  |
| 1.5 | Any logged-in user | Visit `/login` while already authenticated | Redirected straight to `/dashboard` |  |
| 1.6 | Any logged-in user | Click **Sign out** | Session cleared, redirected to `/login` |  |
| 1.7 | Anyone | Call any `/api/**` route with no session cookie | `401 Not authenticated` |  |
| 1.8 | Anyone | After signing out, reuse the old (now-invalid) cookie against an API route | `401` |  |
| 1.9 | Admin | Deactivate a user (§7.3), then that user attempts to log in | `403 This account has been deactivated` |  |
| 1.10 | Admin | Deactivate a role (§2.6), then a user holding it attempts to log in | `403 Your role has been deactivated...` |  |

---

## 2. Roles & Permissions — `/admin/roles`

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 2.1 | Admin | Open `/admin/roles` | All 7 seeded roles listed with their permission counts |  |
| 2.2 | Admin | Create a new custom role with a small permission subset | `201`, role appears, immediately usable when assigning a user (§7) |  |
| 2.3 | Admin | Edit an existing role's permissions (add/remove a few) | `200`, change is live for that role's users on their **next login** (not the current session) |  |
| 2.4 | Admin | Delete the custom role from 2.2 while no user holds it | `200`, role removed |  |
| 2.5 | Admin | Attempt to delete a role that has active users assigned | `409`, blocked with a clear message |  |
| 2.6 | Admin | Attempt to delete the built-in `ADMIN` role | `409` — cannot ever be deleted |  |
| 2.7 | Admin | Deactivate a non-`ADMIN` role, then reactivate it | Both succeed; deactivated role's users get 1.10's login block in between |  |
| 2.8 | Non-admin (e.g. `branch.controller`) | Attempt `GET /admin/roles` or any `roles.*` API call | `403` (no `roles.view`/`roles.manage` by default) |  |
| 2.9 | Admin | Grant a custom permission to `district.director`'s role, e.g. `findings.rectify` | Saved; **on next login**, that user can now rectify — proving permissions are genuinely dynamic, not hard-coded by role name |  |

---

## 3. Organization Admin — Districts & Branches

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 3.1 | Admin | Create a district (`/admin/districts`) | `201`, appears in list |  |
| 3.2 | Admin | Rename it, then deactivate it | Both succeed |  |
| 3.3 | Admin | Delete a district with no branches/users attached | `200`, removed |  |
| 3.4 | Admin | Attempt to delete a district that still has branches | `409`, blocked with explanation |  |
| 3.5 | Admin | Create a branch under an existing district | `201` |  |
| 3.6 | Admin | Attempt to delete a branch that still has users or findings | `409`, blocked |  |
| 3.7 | Admin | Assign a second `BRANCH_MANAGER` to a branch that already has an active one | `409`, error names the existing manager |  |
| 3.8 | Admin | Assign a second `DISTRICT_CONTROLLER` to a district that already has one | Succeeds — districts allow multiple Internal Controllers, unlike branches |  |
| 3.9 | Anyone viewing `/admin/districts` | Check the District Controller(s)/Director(s) columns | Correctly lists every active holder by name, or `--` if unassigned |  |
| 3.10 | Non-admin | Attempt any `districts.*`/`branches.*` mutating call | `403` unless their role was explicitly granted it |  |

---

## 4. Reference Data — Sources & Classified Categories

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 4.1 | Admin | View `/admin/sources` | `Internal Control`, `Internal Audit` seeded, both active |  |
| 4.2 | Admin | Create and then delete an unused source | Both succeed |  |
| 4.3 | Admin | View `/admin/categories` | 7 seeded categories (ATM Mismatch, ATM Long Outstanding, IT Case, Dormant Account, Zero Balance, CK Book, Other Case), `Other Case` flagged `Scored` |  |
| 4.4 | Admin | Attempt to delete a category referenced by an active Scoring Rule | `409`, blocked |  |
| 4.5 | Admin | Deactivate a category | It disappears from the Finding registration form's Classified Case options, but existing findings referencing it are unaffected |  |

---

## 5. Scoring Rules & Adjustments

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 5.1 | Admin | View `/admin/scoring-rules` | One active v1 rule, formula matching proposal.txt §6 |  |
| 5.2 | Admin | Create a v2 rule and activate it | `201` then `200`; v1 automatically deactivated — exactly one active version at all times |  |
| 5.3 | Non-admin (any role, including `ho.controller`) | Attempt to create/activate a scoring rule | `403` — Admin-only by design, even though icfms.txt's HO role text suggests otherwise (master.txt §9 overrides it) |  |
| 5.4 | Admin | Submit a Scoring Adjustment with no reason | `400`, rejected |  |
| 5.5 | Admin | Submit a Scoring Adjustment with a valid reason | `201`, recorded and shows in the Audit Log |  |

---

## 6. Reporting Periods

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 6.1 | Admin | Create a new period (e.g. next month) | `201`, status `OPEN` |  |
| 6.2 | Admin | Attempt to create a duplicate period (same year+month) | `409` |  |
| 6.3 | Admin | Lock a period without a reason | `400` (reason required, min length enforced) |  |
| 6.4 | Admin | Lock a period with a valid reason | `200`, status `LOCKED`, `lockedBy`/`lockedAt` set |  |
| 6.5 | Any district/HO controller | Confirm a `PERIOD_LOCKED` notification arrived (see §17) | Present, correct period code |  |
| 6.6 | Branch Controller | Attempt to register a **new** finding against a locked period | `409` |  |
| 6.7 | Any actor with an in-flight finding in that period | Attempt edit / submit / district-review / ho-review / rectify against it | All `409` — locked periods block every mutating action on *existing* findings too, not just new ones |  |
| 6.8 | District Controller | Transfer an outstanding finding out of the locked period into an open one (§14) | Succeeds — this is the one deliberate exception |  |
| 6.9 | District/HO Controller | Close a `RECTIFIED` finding whose period is locked | Succeeds — closing doesn't change reportable totals, so it's exempt |  |
| 6.10 | Admin | Unlock the period | `200`, status back to `OPEN`; `PERIOD_UNLOCKED` notification fires |  |

---

## 7. Users

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 7.1 | Admin | Create a user with a branch-scoped role | `201`, `districtId` auto-derived from the chosen branch |  |
| 7.2 | Admin | Create a user with a district-scoped role, no branch supplied | `201` |  |
| 7.3 | Admin | Edit a user's name and role | `200` |  |
| 7.4 | Admin | Deactivate a user, then reactivate them | Both succeed; see 1.9 for the login effect in between |  |
| 7.5 | Admin | Reset a user's password | `200`; old password no longer works, new one does |  |
| 7.6 | Admin | Attempt to assign a second active `BRANCH_MANAGER` to an already-staffed branch, via the Users page this time | `409`, same rule as 3.7 enforced centrally |  |
| 7.7 | Non-admin | Attempt any `users.*` call | `403` |  |

---

## 8. Settings

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 8.1 | Admin | View `/admin/settings` | Currencies `ETB, USD, EUR, GBP`; risk levels `Low, Medium, High, Critical` |  |
| 8.2 | Admin | Add a currency, save | Persisted; new currency appears on the Finding registration form immediately |  |
| 8.3 | Admin | Add/rename a risk level, save | Persisted; reflected on the registration form and every dashboard's Risk Distribution widget |  |
| 8.4 | Non-admin | Attempt `PATCH /api/admin/settings` | `403` |  |

---

## 9. Audit Log

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 9.1 | Admin | Perform any mutating action anywhere in the app | A corresponding entry appears in `/admin/audit-log` with who/when/what/old→new |  |
| 9.2 | Admin | Search/filter the audit log by entity type or user | Correctly narrows the list |  |
| 9.3 | Anyone | Look for an edit/delete API on an audit entry | None exists — audit entries are permanently immutable |  |
| 9.4 | Non-admin without `audit-log.view` | Attempt to view it | `403` |  |

---

## 10. Findings — Registration (`/findings/new`)

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 10.1 | Branch Controller | Open the form | District/branch fields locked to their own org unit |  |
| 10.2 | HO Controller | Open the form | District/branch are freely selectable (registering an Internal Audit finding on any branch's behalf) |  |
| 10.3 | Branch Controller | Fill every field, click **Save Draft** | `201`, status `DRAFT`, reference auto-generated as `<branchCode>-<periodCode>-<seq>` |  |
| 10.4 | Branch Controller | Fill and click **Save & Submit** | `201`, status jumps straight to `DISTRICT_REVIEW` (via the `SUBMITTED` pass-through) |  |
| 10.5 | Branch Controller | Register a second finding in the same branch+period | Reference sequence increments (`...-002`) |  |
| 10.6 | Branch Controller | Submit the form with a required field missing | `400`, clear field-level message, nothing created |  |
| 10.7 | Branch Controller | Submit with `caseCount: 0` | `400` — must be ≥ 1 |  |
| 10.8 | Executive / District Director | Attempt `POST /api/findings` | `403` — neither role holds `findings.create` |  |

---

## 11. Findings — Draft editing & deletion

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 11.1 | Branch Controller (owner) | Edit a `DRAFT` finding's fields | `200`, saved |  |
| 11.2 | Branch Controller | Delete a `DRAFT` finding | `200`, removed |  |
| 11.3 | Branch Controller | Attempt to edit a `SUBMITTED`/`CLOSED`/any non-DRAFT/RETURNED finding | `409` |  |
| 11.4 | Branch Controller | Attempt to delete a non-`DRAFT` finding | `409` |  |
| 11.5 | A different branch's controller | Attempt to view/edit/delete this finding | `403` (org-scope), and the finding is absent from their own Findings list entirely |  |

---

## 12. Findings — District & HO Review

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 12.1 | District Controller | Open the queue before the finding is submitted | Finding genuinely absent |  |
| 12.2 | Branch Controller | Submit the finding | Now present in the District Controller's queue |  |
| 12.3 | District Director (view/comment-only) | Attempt `POST .../district-review` | `403` — proves "cannot modify findings" is enforced, not just hidden in the UI |  |
| 12.4 | District Controller | **Reject** with no reason | `400` (≥5 char reason required) |  |
| 12.5 | District Controller | **Reject** with a valid reason | `200`, status `REJECTED` — terminal, no further transitions possible |  |
| 12.6 | District Controller | **Return** with a valid reason (on a fresh finding) | `200`, status `RETURNED`; original creator can now edit/resubmit it |  |
| 12.7 | District Controller | **Approve** | `200`, status `HO_REVIEW` (via `DISTRICT_APPROVED` pass-through); HO Controller's queue now includes it, and it was absent before this step |  |
| 12.8 | HO Controller | Repeat Approve/Reject/Return at the HO stage | Same rules as 12.4–12.7, transitioning to `SENT_TO_BRANCH_MANAGER` on approve |  |
| 12.9 | Anyone with view access | Open the finding's Transition History | Every step above appears as a separate, timestamped row — including the two automatic pass-through transitions per approval |  |
| 12.10 | A different district's controller | Attempt district-review on this finding | `403` (org-scope) |  |

---

## 13. Findings — Rectification

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 13.1 | Branch Manager | On a 3-case / 45,000 finding, record 1 case / 10,000 | `200`, status `PARTIALLY_RECTIFIED`, outstanding shows exactly 2 cases / 35,000 |  |
| 13.2 | Branch Manager | Attempt to rectify more cases/amount than outstanding | `400`, rejected before any data changes |  |
| 13.3 | Branch Manager | Record the remaining 2 cases / 35,000 | `200`, status `RECTIFIED` (fully rectified) |  |
| 13.4 | District/HO Controller | Confirm a `RECTIFIED` notification arrived the moment it became fully rectified | Present |  |
| 13.5 | Branch Manager | Attempt to rectify a finding still in `HO_REVIEW` (not yet at `SENT_TO_BRANCH_MANAGER`) | `409` |  |
| 13.6 | Branch Manager | Attempt to rectify against a finding whose period just got locked | `409` — must be Transferred first (§14) |  |

---

## 14. Findings — Transfer to next period

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 14.1 | District Controller | Transfer an outstanding finding with no reason | `400` |  |
| 14.2 | District Controller | Transfer into the **same** period it's already in | `400` |  |
| 14.3 | District Controller | Transfer into a period that's `LOCKED` | `409` |  |
| 14.4 | District Controller | Transfer into a valid different `OPEN` period, with a reason | `200`, status `TRANSFERRED`, `finding.periodId` now the new period |  |
| 14.5 | Anyone | `GET /api/findings?periodId=<old>` | Finding **absent** |  |
| 14.6 | Anyone | `GET /api/findings?periodId=<new>` | Finding **present** — confirms no double-counting, no manual reconciliation |  |
| 14.7 | Anyone | Check `finding.createdAt` / the detail page's "Case age" | Unchanged by the transfer — age is always from original registration |  |
| 14.8 | Anyone | Open the finding's Transfer History | Shows the transfer with reason, actor, timestamp |  |
| 14.9 | Branch Manager | Rectify further in the new period | Works exactly as §13 |  |
| 14.10 | Branch Controller / Branch Manager / Executive | Attempt `POST .../transfer` | `403` — not a default holder of `findings.transfer` |  |

---

## 15. Findings — Evidence

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 15.1 | Branch Controller | Upload a `.csv` file under 10 MB | `201`, listed with filename/size/uploader/date |  |
| 15.2 | Branch Controller | Upload a `.txt` file | `400` — unsupported type (allow-list is PDF/PNG/JPG/XLSX/DOCX/CSV) |  |
| 15.3 | Branch Controller | Upload a file over 10 MB | `400` — exceeds the limit |  |
| 15.4 | Anyone with view access (e.g. HO Controller, no upload permission) | Download an already-uploaded file | `200`, byte-identical to the original |  |
| 15.5 | Executive | Attempt to upload evidence | `403` — view-only role |  |
| 15.6 | A different branch's controller | Attempt to view/download this finding's evidence | `403` (org-scope) |  |

---

## 16. Findings — Comments

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 16.1 | District Controller | Post a top-level comment | `201` |  |
| 16.2 | District Director | Reply to that comment | `201` — the one mutating action this role gets |  |
| 16.3 | District Director | Reply to their own reply (nesting two levels deep) | `400` — replies are one level only |  |
| 16.4 | Executive | Attempt to post a comment | `403` |  |
| 16.5 | Executive | `GET` the comment thread | `200` — read access still works |  |
| 16.6 | Comment's parent author / the finding's creator | Confirm a `COMMENT` notification arrived after 16.1/16.2 | Present |  |

---

## 17. Findings — Verification & Closure

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 17.1 | Branch Manager | Attempt to close the finding they just fully rectified | `403` — no `findings.close` by default; verification is a separate, independent duty |  |
| 17.2 | District/HO Controller | Close a `RECTIFIED` finding | `200`, status `CLOSED` |  |
| 17.3 | District/HO Controller | Attempt to close a finding that's only `PARTIALLY_RECTIFIED` | `409` |  |
| 17.4 | Finding's original creator | Confirm a `CLOSED` notification arrived | Present |  |
| 17.5 | Anyone | Attempt any further edit/transition on a `CLOSED` finding | `409` on every route — fully terminal |  |

---

## 18. Notifications

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 18.1 | Any user | Open the bell icon after any of the events in §6.5/§12–§17 | Correct title/message, unread badge count matches |  |
| 18.2 | Any user | Click a notification | Marked read, navigates to the underlying finding |  |
| 18.3 | Any user | Click **Mark all read** | All notifications' unread state clears, badge disappears |  |
| 18.4 | User A | Attempt to mark User B's notification as read via its API id | `404` — scoped strictly to `recipientUserId` |  |
| 18.5 | Any user | Confirm the bell polls automatically (no manual refresh) | New notification appears within ~30s |  |

---

## 19. Dashboards

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 19.1 | Branch Controller/Manager | Open `/dashboard` | Branch KPIs, category totals, risk distribution, monthly trend, work queue, recent activity — all real |  |
| 19.2 | District Controller/Director | Open `/dashboard` | District aggregate + branch-by-branch ranking table |  |
| 19.3 | HO Controller | Open `/dashboard` | Bank-wide KPIs, district ranking, IC vs. IA source comparison, reporting-period status |  |
| 19.4 | Executive | Open `/dashboard` | Concise bank-wide KPIs, top-district/branch rankings, high/critical-risk exceptions count — no work queue (view-only) |  |
| 19.5 | Admin | Open `/dashboard` | Generic landing page with a link into `/admin` (Admin's real "dashboard") |  |
| 19.6 | Admin | Revoke a role's `<x>-dashboard.view` permission, that role's user logs in again | Sees the "ask an administrator" fallback card instead of the dashboard |  |
| 19.7 | Any dashboard viewer | Change the FilterBar's period/category/etc. | KPI numbers update accordingly; org fields (district/branch) stay locked to their own scope, never editable to a wider one |  |

---

## 20. Reports & Exports — `/reports`

| # | Actor | Steps | Expected | ✓ |
|---|---|---|---|---|
| 20.1 | District/HO Controller, District Director, Executive | Open `/reports` | Findings Report table, Branch/District Performance, Category/Risk breakdowns, Transfers list |  |
| 20.2 | Any viewer | Apply a filter (period/branch/category/etc.) | Every widget on the page narrows consistently |  |
| 20.3 | Any viewer | Click **Download CSV** | File downloads; rows match exactly what's on screen for the same filters |  |
| 20.4 | Any viewer | Click **Print / Save as PDF** | Browser print dialog opens with sidebar/topbar hidden, report content only |  |
| 20.5 | Branch Controller/Manager | Attempt to open `/reports` | Redirected away — no `reports.view` by default |  |
| 20.6 | Any viewer | Click through to Reporting Period Status / Audit Trail links | Lands on the real existing admin pages, not a duplicate |  |

---

## 21. Cross-cutting checks (run throughout, not just once)

| # | Check | How to verify | ✓ |
|---|---|---|---|
| 21.1 | Server-side enforcement, not just UI | Call any permission-gated API directly (curl/Postman) with a session that lacks the permission | `403`, regardless of what the UI would have hidden |  |
| 21.2 | Org-scope enforcement | A district/branch-scoped user's API calls for another org unit's data | `403` or silently absent from list results — never visible |  |
| 21.3 | Reference data stays bank-wide-visible | Any role with `districts.view`/`branches.view`/etc. | Sees all districts/branches/sources/categories regardless of their own org unit — this is intentional, not a scope leak |  |
| 21.4 | Session cookie security | Inspect the cookie in devtools | `httpOnly`, `sameSite=lax`, `secure` in production |  |
| 21.5 | Zero console errors | Open browser devtools console while navigating every page in this document | No errors on any of them |  |
| 21.6 | `npm run lint` / `npm run build` | Run both from a clean `data/` state | Both exit clean |  |

---

## Appendix — a single unbroken run-through (smoke test)

For a fast end-to-end sanity check rather than the full matrix above, run
this one sequence:

1. Log in as `admin`. Create a district, a branch under it, and confirm
   both appear.
2. Log in as `branch.controller`. Register and submit a 3-case /
   ETB 45,000 "Other Case" finding.
3. Log in as `district.controller`. Confirm the finding is in the queue,
   approve it.
4. Log in as `ho.controller`. Confirm it arrived, approve it.
5. As `admin`, lock the finding's reporting period with a reason.
6. As `branch.manager`, attempt to rectify → confirm `409`.
7. As `district.controller`, transfer the finding into a new open period
   with a reason.
8. As `branch.manager`, upload a CSV as evidence; download it back and
   diff it against the original.
9. As `district.controller`, post a comment; as `district.director`,
   reply to it.
10. As `branch.manager`, fully rectify (3 cases / 45,000) in the new
    period.
11. As `district.controller`, close the finding.
12. As `branch.controller` (the original creator), open the bell icon —
    confirm notifications exist for approve/approve/lock/transfer/
    rectify/close.
13. As `district.controller`, open `/reports`, download the CSV, confirm
    the finding appears with status `CLOSED` and 0 outstanding.
14. Open `/dashboard` as `branch.controller`, `district.controller`,
    `ho.controller`, and `executive` in turn — confirm each shows this
    finding correctly reflected in its own KPIs.
15. Log out. Confirm the old session cookie no longer works against any
    API route.

If all 15 steps pass, the system is sound end-to-end.
