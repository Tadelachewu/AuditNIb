# Email Events: Choosing Which Notifications Are Emailed

Every notification appears in the **bell** in the top bar. Each one can also be sent as an **email**. An administrator decides, event by event, which notifications are emailed.

- **Where:** Admin → **Settings** → **Email Events**
- **Who can change it:** roles with **Settings › Edit**. Roles with **Settings › View** can open the section but can't change it.
- **Default:** every event is emailed, the same as before this setting existed.

---

## 1. What the switch does

| Event ticked | Bell notification | Email |
|---|---|---|
| ✅ On | Sent | Sent (if email delivery is set up and the user has an email address) |
| ⬜ Off | **Still sent** | Not sent |

Turning an event off **never** hides anything in the app. It only stops the email copy, so people can't miss work because of this setting; they just aren't emailed about it.

The switch applies to **everyone**: it's a bank-wide choice, not a per-user preference. *Who* receives each notification doesn't change; that's decided by roles and permissions (see [notifications.md](notifications.md)).

---

## 2. When emails go out at all

An email is sent only when **all** of these are true:

1. **Notification Delivery → Provider** is set (not *None*), with the SMTP host, port and the `SMTP_USER` / `SMTP_PASSWORD` environment variables in place. See [EMAIL_SETUP.md](EMAIL_SETUP.md).
2. The event is **ticked** in Email Events.
3. The recipient's user account has an **email address**.

While the provider is *None*, the Email Events section shows a warning: you can still choose events in advance, and they take effect once email delivery is configured.

---

## 3. The events

| Group | Event | Sent when | Typical recipients |
|---|---|---|---|
| Finding review | **Submitted** | A finding is submitted for review, for Bank-Wide Approval, or straight to the branch | District reviewers; picked approvers; branch rectifiers |
| | **District approved** | A district approves a finding | HO reviewers |
| | **HO approved** | HO approves a finding | Branch rectifiers |
| | **Bank approved** | Bank-Wide Approval approves a bank-registered finding | Branch rectifiers |
| | **Returned** | A finding is returned for correction (by district, HO or bank approval) | The registrant (+ district reviewers when HO / bank returns it) |
| | **Rejected** | A finding is rejected | The registrant (+ district reviewers when HO rejects it) |
| Rectification | **Rectified** | The branch records a rectification | Other branch rectifiers, district verifiers |
| | **Rectification resubmitted** | The branch corrects a returned rectification | District verifiers |
| | **Rectification returned** | The district or HO sends a rectification back | Branch rectifiers (+ district verifiers when HO returns it) |
| | **Rectification verified** | The district verifies a rectification | Closers |
| | **Rectification reminder** | No rectification progress for the configured days (Settings → Rectification Reminders) | Branch rectifiers |
| | **Closed** | A finding is closed | The registrant |
| | **Reopened** | A closed / partially closed finding was reset to Sent to Branch Manager | Branch rectifiers, the registrant |
| Transfers & periods | **Transferred** | A finding moves to another period | The registrant, transferers |
| | **Period locked** | A reporting period is locked | District reviewers, branch rectifiers |
| | **Period unlocked** | A reporting period is unlocked | District reviewers, branch rectifiers |
| Comments & support | **Comment** | A comment is posted on a finding | The registrant, the author of the comment replied to |
| | **New support message** | A user opens or follows up a support thread | Support staff (`support.respond`) |
| | **Support reply** | Support replies to a thread | The thread's owner |

The full recipient rules (scope, permissions, the Administrator exception) are in [notifications.md](notifications.md).

**Suggested setup for a busy bank:** keep the action-needed events on (*Submitted, District approved, HO approved, Bank approved, Returned, Rectified, Rectification returned, Rectification verified, Rectification reminder, New support message, Support reply*) and turn off the purely informational ones (*Comment, Period locked / unlocked, Transferred, Closed*) if inboxes get noisy.

---

## 4. Using it

1. Go to **Admin → Settings** and expand **Email Events**.
2. Tick or untick events. Each group has an **all / none** link; **Enable all** and **Disable all** cover every event.
3. Click **Save** at the bottom of the Settings page. The change applies to the next notification sent; nothing already sent is affected.

Every save is recorded in the **Audit Log** (entity *Settings*) with the old and new values, so you can see who switched an event off and when.

---

## 5. For developers

| File | Role |
|---|---|
| `src/lib/notificationEvents.ts` | The event catalog (type, label, group, hint) and `isEmailEnabled()` |
| `src/lib/mail.ts` | `sendNotificationEmail()` skips the email when the event is switched off |
| `src/lib/notifications.ts` | `notifyUsers()` always creates the bell notification; `NotifyOptions.type` must be a catalog type |
| `src/components/admin/EmailEventsEditor.tsx` | The Settings section |
| `src/app/api/admin/settings/route.ts` | Validates `notification.emailEvents` (unknown event names are rejected) |

- **Storage:** `Settings.notification.emailEvents`, a map of event type → `true`/`false` inside the existing `notification` JSON column. No database migration is needed. Only `false` switches an event off; a missing entry means *emailed*, so older installs and newly added events default to on.
- **Adding a notification type:** add it to `NOTIFICATION_EVENT_GROUPS` in `src/lib/notificationEvents.ts`. `NotifyOptions.type` is typed from that catalog, so a type that isn't listed won't compile, and every type is guaranteed to appear in the Settings page.
