# BRD Compliance Cross-Check

A requirement-by-requirement comparison of `AuditDocs/` (the BRD, the
Master IT Development Document, and the Project Proposal) against what's
actually in this repo, done by re-reading all three source documents in
full and checking each claim against the current code — not against
memory of what was intended. Three concrete gaps were found and fixed
during the original pass (§4); everything else is reported as found.

**Updated for Phase 7** (see `PHASE7.md`): the five items §5 previously
listed as deferred — Transfer Engine, real evidence upload, threaded
comments, in-app notifications, and Reports/exports, plus the District/HO/
Executive dashboards — are now implemented and verified live. Every
section below that referenced one of these as ⚠️/❌ has been updated in
place to ✅ with fresh evidence, rather than left stale alongside a new
Phase 7 section — so this remains one document that reflects the current
state of the app, not a history of two passes.

**Status key**: ✅ Implemented and verified · ⚠️ Partial · 📝 Deliberate,
documented deviation · ❌ Not implemented

---

## 1. Roles, users, and organization

| Requirement | Status | Evidence |
|---|---|---|
| 7 roles: Administrator, HO Internal Controller, District Internal Controller, District Director, Branch Internal Controller, Branch Manager, Executive Read-only (icfms.txt §7, master.txt §25) | ✅ | Seeded in `src/lib/db.ts`; roles are now *data*, not a hard-coded list — an admin can create more (PHASE2.md) |
| Administrator: user creation, role assignment, branch/district config, category maintenance, workflow config, system settings (icfms.txt §7) | ✅ | `ADMIN` is seeded with every permission (`ALL_PERMISSION_KEYS`), covering `/admin/users`, `/admin/districts`, `/admin/branches`, `/admin/categories`, `/admin/roles`, `/admin/settings`. Like any other role, it can be narrowed from the Roles & Permissions page — the one permission it can never lose is `roles.manage`, so there's always a way back in (`src/app/api/admin/roles/[id]/route.ts`) |
| Branch Internal Controller: register/edit-draft/submit findings, verify rectifications, view branch history (icfms.txt §7) | ✅ | `findings.create/edit/delete/submit/rectify` in `BRANCH_CONTROLLER`'s default permissions (`src/lib/db.ts`); "view branch history" = `findings.view` scoped to their branch |
| District Internal Controller: review submissions, verify, approve/return, transfer, monitor, report (icfms.txt §7) | ✅ | Review/approve/return/monitor ✅ (`findings.district-review`); **transfer** now implemented — `findings.transfer` default-granted to `DISTRICT_CONTROLLER`, `POST /api/findings/[id]/transfer` (PHASE7.md §A), verified live moving a finding's `periodId` forward with no double-count |
| HO Internal Controller: monitor all districts, register IA findings, executive reports, configure performance, monitor national performance (icfms.txt §7) | ✅ | Monitor/register/HO-review ✅; "configure performance calculations" is **intentionally not granted** — master.txt §5 and §9 both separately say *"Only Admin changes scoring rules"*, which overrides icfms.txt's role description (PHASE5.md §2 documents this exact resolution); "executive reports" now covered by `/reports` (`reports.view`, default-granted to `HO_CONTROLLER` — PHASE7.md §E), plus the new `HODashboard` |
| Branch Manager: view assigned findings, record corrective actions, rectification progress, rectified case counts, evidence, respond to comments (icfms.txt §7) | ✅ | Everything, including "respond to comments" — `findings.comment` default-granted to `BRANCH_MANAGER`, and real evidence upload (`findings.evidence`) replaces the old text-note placeholder (PHASE7.md §B, §C) |
| District Director: view dashboards, review branch performance, review high-risk findings, comment, **cannot modify** (icfms.txt §7) | ✅ | The restriction is the best-verified line in the whole app — `DISTRICT_DIRECTOR` holds zero mutating `findings.*` permissions *except* `findings.comment`, which proposal.txt §6 explicitly authorizes ("District Directors shall have view and comment access") — a live `POST .../district-review` call authenticated as `district.director` still returns `403`, while `POST .../comments` succeeds (PHASE6.md §3, §6; PHASE7.md §C). `DistrictDashboard` now renders real branch-ranking/category/risk data (PHASE7.md §F) |
| Constraint: exactly one Branch Manager + one Branch Internal Controller per branch; District/HO may have multiple Internal Controllers (master.txt §5) | ✅ | `RoleDefinition.branchSingleton`, enforced in `src/lib/org.ts`'s `assertBranchRoleAvailable()`; districts' lack of a singleton constraint was verified directly by successfully assigning two `DISTRICT_CONTROLLER` users to the same district (PHASE Districts task) |
| A user assigned to only one branch or district/org unit at a time (master.txt §5) | ✅ | `resolveOrgAssignment()` — a role's `orgScope` determines exactly one of `districtId`/`branchId`/neither, never a combination |
| Org hierarchy is config-driven, no hard-coded 13/410 limits (master.txt §1, §17) | ✅ | Districts/Branches are plain CRUD entities (`/admin/districts`, `/admin/branches`); nothing in the code assumes a specific count |
| District list shows who's assigned (analogous to Branch Manager/Controller) | ✅ | Added on request — `findDistrictControllers()`/`findDistrictDirectors()` in `org.ts`, shown as columns on `/admin/districts`, correctly rendering multiple names or `--` |

---

## 2. Findings registration (BRD §3.3 / master.txt §6)

| Field | Status | Evidence |
|---|---|---|
| Finding ID/Reference (unique) | ✅ | Auto-generated `<branchCode>-<periodCode>-<seq>` (`nextFindingReference()`), verified to sequence correctly per branch+period |
| Finding Source (Internal Control / Internal Audit / future configurable) | ✅ | `Source` entity, admin-manageable, seeded with IC/IA |
| Reporting Month/Period | ✅ | `periodId`, restricted to `OPEN` periods at creation |
| District/Branch (validated against org scope) | ✅ | Forced to the caller's own org unit for branch-scoped roles; validated for HO's free choice (§1) |
| Finding Date, Operation Area, Type of Irregularity | ✅ | Present on the registration form and `Finding` type |
| Classified Case | ✅ | `categoryId` → `ClassifiedCategory` |
| Amount / Currency, Number of Cases, Risk Level | ✅ | All present; currency list now matches master.txt §25's reference values (§4) |
| Description, Recommendation (optional) | ✅ | Present |
| Evidence (optional) | ✅ | Real file upload, stored on local disk (`data/uploads/`, same "local now, swappable later" pattern as `db.json` — master.txt §24 leaves object storage as an open infra decision, so local disk stands in for it rather than blocking the feature); allow-listed types (PDF/PNG/JPG/XLSX/DOCX/CSV), 10 MB cap, server-generated filenames (no path traversal); verified live: an uploaded CSV downloaded back byte-identical, a `.txt` file rejected, and a >10 MB file rejected (PHASE7.md §B) |
| Draft save vs Submit | ✅ | `submit: boolean` on create, and a separate `POST .../submit` for an existing draft |
| Edit only while DRAFT or RETURNED | ✅ | Enforced server-side in `PATCH /api/findings/[id]`, verified: an edit attempt on a `CLOSED` finding returns `409` |
| Internal Audit findings: HO manual-entry path | ✅ | `HO_CONTROLLER` holds `findings.create`; the registration form lets HO pick any district/branch (branch-scoped roles get theirs locked) |
| Configurable routing rules per finding source (master.txt §2) | ❌ | Every source follows the identical pipeline; not built (§5) |

---

## 3. Workflow engine (BRD §3.4 / master.txt §4, §11)

The full 13-state machine from master.txt §11 is implemented literally,
including the momentary pass-through states (`SUBMITTED`,
`DISTRICT_APPROVED`, `HO_APPROVED`) as real, auditable transitions rather
than being silently skipped — see PHASE6.md §1 for why that was a
deliberate choice, not an oversight.

| Requirement | Status | Evidence |
|---|---|---|
| Draft → Submit → District Review → District Approval/Reject/Return | ✅ | `src/app/api/findings/[id]/submit`, `.../district-review` |
| District Approval → HO Review → HO Approval/Reject/Return | ✅ | `.../ho-review` |
| HO Approval → Sent to Branch Manager | ✅ | `hoApproveFinding()` |
| Reject: mandatory reason, terminal | ✅ | `zod` refinement requires ≥5 chars; `REJECTED` has no further transition routes |
| Return: routes back to originator, history retained | ✅ | Sets `RETURNED` (re-editable), full transition row kept, not overwritten |
| Comment-only actions (master.txt §4) | ✅ | `Comment` entity, one level of threading, `findings.comment` permission — granted to `BRANCH_CONTROLLER`, `BRANCH_MANAGER`, `DISTRICT_CONTROLLER`, `DISTRICT_DIRECTOR`, `HO_CONTROLLER`, deliberately **not** `EXECUTIVE_READONLY`; verified live: a reply-to-a-reply is rejected (`400`, one level only) and an executive's comment attempt is rejected (`403`) (PHASE7.md §C) |
| Full transition history (who, when, from-state, to-state, reason) | ✅ | `FindingTransition` per change, mirrored into the bank-wide `AuditLogEntry` too — verified: a closed finding's detail page renders all 9 transitions from `DRAFT` to `CLOSED` in order |
| Work queues per role ("pending my action") | ✅ | `queueStatusesForSession()` derives the right queue from *permissions held*, not a hard-coded role switch — so a custom role gets a sensible queue automatically |

---

## 4. Fixed during this cross-check

Three concrete deviations were found and corrected while re-reading the
docs against the running code, rather than only reported:

1. **Locked periods didn't block workflow actions on existing findings**
   — only new-finding creation checked `period.status === "LOCKED"`.
   master.txt §13 is explicit: *"Locked periods prevent unauthorized
   reportable changes"* — not just new writes. Added `assertPeriodWritable()`
   (`src/lib/findings.ts`) and wired it into edit, delete, submit,
   district-review, ho-review, and rectify. Verified live: locking the
   current period after a finding was already mid-workflow correctly
   turned a district-review approval into a `409`. (Deliberately **not**
   applied to `close` — closing a fully-rectified finding doesn't change
   any reportable case/amount total, so it isn't the kind of change §13 is
   protecting against. Rectification against a locked period is correctly
   blocked; the Transfer Engine built in Phase 7 is exactly the intended
   escape hatch — see `src/app/api/findings/[id]/rectify/route.ts`'s
   comment and PHASE7.md §A.)
2. **Seeded currencies were `["ETB", "USD"]`**, missing master.txt §25's
   explicit reference list (*"ETB; USD; EUR; GBP initially; configurable"*).
   Fixed in `src/lib/db.ts`.
3. **Seeded classified-case names didn't match master.txt §25's reference
   list wording** ("ATM Long O/S" vs "ATM Long Outstanding", "IT" vs
   "IT Case", "Dormant" vs "Dormant Account"). Fixed to match exactly;
   codes were already correct and unaffected.

Also fixed: the README pointed at `AuditDocs/NIB_Control360_Development_Plan.md`,
which doesn't actually exist in this repo (it's a file the user has open
locally from `Downloads/`, never copied into `AuditDocs/`) — corrected to
point at `AuditDocs/master.txt` §21, which has the same roadmap.

---

## 5. Not implemented (deferred, not missed)

The five items this section listed after Phase 6 — Case Transfer Engine,
real evidence upload, threaded comments, notifications, and Reports/
exports, plus the District/HO/Executive dashboards — were built in
Phase 7 and are now covered as ✅ throughout this document (see §1–§3,
§7, and `PHASE7.md`). What remains below are the items that were **never**
in Phase 7's scope — still deliberate scoping decisions, not oversights:

| Requirement | Where it's specified | Why deferred |
|---|---|---|
| Excel Migration Toolkit | master.txt §22 | Not started — no import template, validation, or reconciliation-vs-Excel tooling |
| Knowledge Base module | icfms.txt §8 | Not started |
| Configurable per-source workflow routing | master.txt §2 | Every source follows one uniform pipeline |
| Scoring-adjustment integration into the computed performance figure | master.txt §9 | `ScoringAdjustment` records exist and are audit-logged, but `computePerformance()` doesn't currently fold a manual adjustment into the displayed percentage — the two coexist rather than combine |
| Outlook/SMTP email delivery for notifications | BRD §9, master.txt §12 | Phase 7 built a real **in-app** notification center (bell, unread badge, mark-as-read); email/Outlook delivery still has no SMTP/Graph credentials to send through — `Settings.notification` remains a config placeholder (provider/from-address) |

---

## 6. Performance/scoring — the one calculation the BRD gives worked examples for

proposal.txt §6's own example: *"Total Other Cases = 120, Rectified Cases
= 60, Performance = (60÷120)×100 = 50%."* `computePerformance()`
(`src/lib/findings.ts`) implements exactly this ratio — sum of
`rectifiedCases` ÷ sum of `caseCount` × 100 — generalized to whatever
categories/sources the *active, versioned* `ScoringRule` currently
includes, rather than hard-coding "Other Case" as the category name
(master.txt §9: *"Do not hard-code these policy decisions"*). Verified
live end-to-end: a fully-rectified 3-case Other Case finding produced
exactly `100.0%` on the Branch Dashboard.

Because the default rule's `sources` array includes both Internal Control
and Internal Audit, a single finding-level formula naturally satisfies
master.txt §9's *"District cumulative score combines Internal Control and
Internal Audit results"* without a separate combination step — both
sources feed the same eligible-set filter.

Scoring Rules remain versioned and Admin-only to create/activate
(master.txt §9: *"Admin alone can add/remove/activate scoring
categories"*), verified in PHASE2/PHASE5: no non-admin role's default
permissions include `scoring-rules.create` or `.activate`.

---

## 7. Security, dashboards, and other cross-cutting requirements

| Requirement | Status | Evidence |
|---|---|---|
| Web-based, role-based access control | ✅ | Next.js app; permission-based access control is *more* granular than the BRD's plain "role-based" ask (PHASE2.md) |
| Server-side authorization; UI scope is not a security boundary (master.txt §15, §16) | ✅ | Every mutating route calls `requirePermission()` independently of the UI/proxy layer — stated explicitly as policy in `src/lib/guard.ts`'s own comment, and re-verified this session (§3, §6) |
| Branch/district/HO see only their own scope (master.txt §16) | ✅ | For **Findings** specifically — verified live: a district-2 controller got `403` acting on a district-1 finding, and that finding was absent from their own list entirely. Reference/config data (Districts, Branches, Sources, Categories) is intentionally bank-wide-visible to anyone with the relevant `.view` permission — that data describes the org itself, not a district's operational records, so scoping it per-district wouldn't match the BRD's intent |
| Read-only users cannot modify | ✅ | `DISTRICT_DIRECTOR`/`EXECUTIVE_READONLY` hold no mutating permissions by default |
| Passwords never stored in plain text | ✅ | bcrypt via `src/lib/auth.ts` |
| Complete audit logs, immutable/protected (master.txt §15) | ✅ | `AuditLogEntry` has no update/delete API at all; every Finding transition, admin CRUD action, login/logout is logged |
| Session expiry / secure secrets | ⚠️ | iron-session's cookie is `httpOnly`, `sameSite: lax`, `secure` in production, sealed with a required ≥32-char secret — solid, but there's no *configurable* session TTL and no server-side revocation (deactivating a role/user doesn't invalidate an already-issued cookie until its next login — documented trade-off, PHASE2.md §4) |
| Production-grade authentication/SSO | 📝 | master.txt §24 itself lists "Production SSO/identity provider" as an **open decision to confirm before production**, not something the BRD expects solved at this stage — the app has solid application-level auth (bcrypt + iron-session), deliberately not an SSO integration |
| Dashboards: filters never bypass organizational scope (master.txt §10) | ✅ | `FilterBar`'s `fixedDistrict`/`fixedBranch` render locked org fields as plain text, not editable selects — verified: no `<select>` present for a branch-scoped user's district field |
| KPI cards, category totals, work queue, recent activity | ✅ | Wired to real data for all four dashboards — Branch (Phase 6), District/HO/Executive (PHASE7.md §F) — including a real per-risk-level breakdown and a monthly performance trend on every dashboard, replacing the last `EmptyWidget` placeholders |

---

## 8. Non-functional reality check — the one caveat that matters most

master.txt §1 states the system "covers the entire bank: 13 districts and
more than 410 branches" and §17 requires the solution be "optimized for
bank-scale historical monthly data." **This is the single biggest gap
between the BRD's ambition and the current build**, and it's not a missing
feature — it's the foundational storage decision made explicitly at the
very start of this project (per the original instruction: *"use nextjs and
local storage, we will convert into a db later"*): the entire app persists
to one JSON file on disk (`src/lib/db.ts`), read and rewritten in full on
every request. That's appropriate for development and demonstration, and
every module was deliberately built so that swapping in a real database
later only means reimplementing `readDb()`/`writeDb()`/`updateDb()` — but
it will not hold up at "410+ branches, years of monthly findings" scale.
This isn't a new finding — it's been flagged in every phase document since
PHASE1.md §2 — but it belongs explicitly in a BRD compliance check, since
master.txt §26's own "Definition of Done" requires "performance testing
completed with realistic bank-scale data," which is not yet meaningful to
run against this storage layer.

---

## 9. Bottom line

The **foundation, Administration console, and the full Findings
lifecycle** — registration through district/HO review, rectification,
cross-period transfer, evidence, comment-based collaboration,
notifications, reporting/export, and district/HO-verified closure — are
built and verified against the BRD's own worked examples (the 120/60/50%
performance calculation, the 3-case/45,000 partial-rectification example,
the full DRAFT→…→TRANSFERRED→…→CLOSED state chain with no double-counting
across the transfer). Access control is enforced server-side and
org-scoped, matching master.txt §16's explicit requirement, and includes
the period-lock enforcement gap the original cross-check found and
closed. All four role dashboards (Branch, District, HO, Executive) are
now wired to real Finding data, matching master.txt §10 in full.

What remains genuinely out of scope is the *harder, more
infrastructure-dependent* remainder that was never part of Phase 6 or
Phase 7: the Excel Migration Toolkit, the Knowledge Base module,
Outlook/SMTP email delivery (in-app notifications now exist), and a
production-scale database — every one of them already named as future
work, not silently dropped. §8's storage-scale caveat still applies
unchanged: this remains a local-JSON-file "database," appropriate for
development and demonstration, deliberately built so that swapping in a
real database later only means reimplementing `readDb()`/`writeDb()`/
`updateDb()`.
