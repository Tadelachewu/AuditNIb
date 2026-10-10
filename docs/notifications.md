# Notifications: Who Receives What

Every notification appears in the **bell** in the top bar. It is also **emailed** to the recipient when email delivery is configured (Admin → Settings → Notification Delivery, see [EMAIL_SETUP.md](EMAIL_SETUP.md)) and the user has an email address, **and** that event is switched on for email in Admin → Settings → **Email Events** (all are on by default; see [email-events.md](email-events.md)). Emails are queued and delivered with retries; delivery status is in Admin → Settings → **Email Queue** ([email-queue.md](email-queue.md)).

This page lists which notification each role receives, and why. The *Rectification reminder* is time-based: when and for which findings it is sent is in [rectification-reminders.md](rectification-reminders.md).

---

## 1. How recipients are chosen

There are three rules. Everything else follows from them.

1. **By permission, not by role name.** Most notifications go to "every active user whose role holds permission X". For example, *Submitted* goes to everyone holding **Findings › District Approve / Reject / Return** (`findings.district-review`). Change a role's permissions in **Admin → Roles & Permissions** and its notifications change with them.
2. **Narrowed by the role's scope.**
   - **Branch** roles only hear about findings in *their* branch.
   - **District** roles only hear about findings in *their* district.
   - **Bank-wide** roles hear about findings everywhere.
3. **Administrators receive Support notifications only.** The Administrator role holds every permission and is bank-wide, so rules 1 and 2 would otherwise send it every step of every finding in the bank, plus an email for each. An Administrator configures the system rather than working findings, so every finding notification skips users with the Administrator role, *even* ones naming them directly (as registrant, comment author or approver). This is enforced in one place, `notifyUsers()` in `src/lib/notifications.ts`.

A few notifications go to **specific people** instead of a permission group: **the registrant** (whoever registered the finding), the author of a comment being replied to, and the owner of a support thread.

Nobody is notified about their **own** comment. Rectifying a finding notifies the *other* branch users, not the person who recorded it.

---

## 2. What each role receives

These are the roles and permissions from the default setup (`prisma/seedData.ts`). If you change a role's permissions, use the **Permission needed** column in §3 to work out its notifications.

### Administrator (bank-wide)
- **New support message**: a user opened a support thread or followed up on one.
- **Support reply**: only for a thread the Administrator opened themself.
- **No finding, rectification, transfer or period notifications**, by design (rule 3).

> **Bank-Wide Approval:** an Administrator picked as an approver in Settings will **not** be notified when a finding is waiting. They'll only see it in their queue. Pick at least one non-Administrator approver, such as an HO Controller.

### Head Office Internal Controller (bank-wide)
Permissions: HO review, bank approval, close, create findings.

| Notification | When |
|---|---|
| **District approved** | A district approved a finding. It now needs HO review. |
| **Rectification verified** | A district verified a branch's rectification. It is ready to close. |
| **Submitted (awaiting approval)** | A bank-registered finding needs approval, **only if** this user is picked as an approver in Settings → Bank-Wide Approval. |
| **Returned / Rejected / Bank approved / Closed / Transferred** | Only for findings **they registered**. |
| **Comment** | On a finding they registered, or a reply to their comment. |

### District Internal Controller (their district)
Permissions: district review, verify rectification, close, transfer.

| Notification | When |
|---|---|
| **Submitted** | A branch in their district submitted a finding for review. |
| **Returned / Rejected by HO** | HO returned or rejected a finding they had approved. |
| **Returned by bank approval** | A bank-registered finding for their district was sent back. |
| **Rectified** | A branch in their district recorded a rectification. It needs verifying. |
| **Rectification resubmitted** | A branch corrected a returned rectification. |
| **Rectification returned (by HO)** | HO sent back a rectification they had already verified. |
| **Rectification verified** | A rectification in their district was verified and is ready to close. They hold the close permission, so they get this even when they verified it themselves. |
| **Transferred** | A finding in their district was moved to another period. |
| **Period locked / unlocked** | Any reporting period's status changed. |

### District Director (their district)
- **None by default.** The role has view-only access. Grant it a review or verify permission and it receives the matching notifications for its district.

### Branch Internal Controller (their branch)
Permissions: rectify, create findings.

| Notification | When |
|---|---|
| **HO approved** / **Bank approved** | A finding for their branch was approved and now needs rectifying. |
| **Submitted (sent to branch)** | A bank-registered finding went straight to their branch (no approval step configured). |
| **Rectified** | Another user at their branch recorded a rectification. |
| **Rectification returned** | The district or HO sent a rectification back for correction. |
| **Rectification reminder** | A finding at their branch has had no rectification progress for the configured number of days (Settings → Rectification Reminders). |
| **Period locked / unlocked** | Any reporting period's status changed. |
| **Returned / Rejected / Closed / Transferred** | For findings **they registered**. |
| **Comment** | On a finding they registered, or a reply to their comment. |

### Branch Manager and Branch Sub-Manager (their branch)
Permission: rectify. They receive the same as the Branch Internal Controller **except** the registrant-only ones, because they can't register findings:
- HO approved / Bank approved
- Submitted (sent to branch)
- Rectified
- Rectification returned
- Rectification reminder
- Period locked / unlocked
- Comment: only a reply to their own comment

### Executive (Read-only) (bank-wide)
- **None by default.** The role has view-only access.

### Support, for any role
**Support reply** goes to whoever opened the thread. By default only the Administrator can open support threads (`support.create`). Grant **Support › Create** to other roles in Roles & Permissions and their users can send support messages and get replies.

---

## 3. Every notification

| Notification | Trigger | Sent to | Permission needed (scope) |
|---|---|---|---|
| **Submitted** | A finding is submitted for review | District reviewers | `findings.district-review` (finding's district) |
| **Submitted** (awaiting approval) | A bank-registered finding is submitted and Bank-Wide Approval is on | The approvers picked in Settings | picked in Settings, not a permission |
| **Submitted** (sent to branch) | A bank-registered finding is submitted and Bank-Wide Approval is off | Branch rectifiers | `findings.rectify` (finding's branch) |
| **District approved** | District approves | HO reviewers | `findings.ho-review` (bank-wide) |
| **Returned / Rejected** (by district) | District returns or rejects | The registrant | none |
| **HO approved** | HO approves | Branch rectifiers | `findings.rectify` (finding's branch) |
| **Returned / Rejected** (by HO) | HO returns or rejects | The registrant + district reviewers | `findings.district-review` (finding's district) |
| **Bank approved** | Bank-Wide Approval approves | Branch rectifiers | `findings.rectify` (finding's branch) |
| **Returned / Rejected** (by bank approval) | Bank-Wide Approval returns or rejects | The registrant; on *Return*, also district reviewers | `findings.district-review` (finding's district) |
| **Rectified** | The branch records a rectification | Other branch rectifiers **and** district verifiers | `findings.rectify` (branch); `findings.verify-rectification` or `findings.return-rectification` (district) |
| **Rectification resubmitted** | The branch corrects a returned rectification | District verifiers | `findings.verify-rectification` or `findings.return-rectification` (district) |
| **Rectification returned** | The district or HO sends a rectification back | Branch rectifiers; when HO returns it, also the district verifiers | `findings.rectify` (branch); `findings.verify-rectification` (district) |
| **Rectification verified** | The district verifies a rectification | Closers | `findings.close` (finding's district; bank-wide roles everywhere) |
| **Closed** | A finding is closed | The registrant | none |
| **Transferred** | A finding is moved to another period | The registrant + transferers | `findings.transfer` (finding's district) |
| **Comment** | A comment is posted on a finding | The registrant + the author of the comment being replied to (never the commenter) | none |
| **Period locked / unlocked** | A reporting period's status changes | District reviewers and branch rectifiers, everywhere (one notification each) | `findings.district-review` or `findings.rectify` |
| **Rectification reminder** | A finding waits longer than the reminder threshold with no progress | Branch rectifiers | `findings.rectify` (finding's branch) |
| **New support message** | A user opens a support thread or follows up | Support staff | `support.respond` (not scoped) |
| **Support reply** | Support replies in a thread | The thread's owner | none |

**The Administrator exception (rule 3) applies to every row except the last two.**

---

## 4. Known quirk

**Rectified** and **Rectification returned** are sent to two groups in two separate batches. A user in **both** groups (for example a custom role holding both `findings.rectify` and `findings.verify-rectification`) gets two notifications for one event. None of the default roles is in both groups, now that the Administrator is excluded.

---

## 5. For developers

- Every notification goes through `notifyUsers()` in `src/lib/notifications.ts`, which saves the bell entry and sends the email. The Administrator exception lives there, as `ADMIN_ROLE_CODE` and `ADMIN_NOTIFICATION_TYPES`.
- Permission-group lookups use `usersWithFindingsPermission(db, action, { districtId?, branchId? })`. It applies the scope narrowing from rule 2 (bank-wide roles are never narrowed) and skips inactive users and roles.
- **To add a notification:** call `notifyUsers` or `notifyFindingsPermissionHolders` from the route that performs the action, inside its `updateDb()` block. Then add a row to §3 and update §2.
- **To let Administrators receive a type again:** add it to `ADMIN_NOTIFICATION_TYPES`.
