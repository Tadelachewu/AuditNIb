/**
 * Every notification type the app sends (the `type` passed to notifyUsers()
 * in src/lib/notifications.ts), with the labels the admin Settings page
 * shows for "which events are emailed". Client-safe (no server imports):
 * shared by that page, the settings API and src/lib/mail.ts.
 *
 * Adding a new notification type? Add it here too, or it can't be switched
 * off - an unlisted type is always emailed (see isEmailEnabled()).
 * Who receives each one: docs/notifications.md; the settings: docs/email-events.md.
 */
export const NOTIFICATION_EVENT_GROUPS = [
  {
    group: "Finding review",
    events: [
      { type: "SUBMITTED", label: "Submitted", hint: "A finding is submitted for review / approval, or sent straight to the branch" },
      { type: "DISTRICT_APPROVED", label: "District approved", hint: "A district approved a finding; it now needs HO review" },
      { type: "HO_APPROVED", label: "HO approved", hint: "HO approved a finding; the branch must now rectify it" },
      { type: "BANK_APPROVED", label: "Bank approved", hint: "Bank-Wide Approval approved a bank-registered finding" },
      { type: "RETURNED", label: "Returned", hint: "A finding was returned to its registrant for correction" },
      { type: "REJECTED", label: "Rejected", hint: "A finding was rejected" },
    ],
  },
  {
    group: "Rectification",
    events: [
      { type: "RECTIFIED", label: "Rectified", hint: "The branch recorded a rectification" },
      { type: "RECTIFICATION_RESUBMITTED", label: "Rectification resubmitted", hint: "The branch corrected a returned rectification" },
      { type: "RECTIFICATION_RETURNED", label: "Rectification returned", hint: "The district or HO sent a rectification back" },
      { type: "RECTIFICATION_VERIFIED", label: "Rectification verified", hint: "The district verified a rectification; it is ready to close" },
      { type: "RECTIFICATION_REMINDER", label: "Rectification reminder", hint: "No rectification progress for the configured number of days" },
      { type: "CLOSED", label: "Closed", hint: "A finding was closed" },
      { type: "REOPENED", label: "Reopened", hint: "A closed / partially closed finding was reversed to the branch (status Reversed)" },
    ],
  },
  {
    group: "Transfers & periods",
    events: [
      { type: "TRANSFERRED", label: "Transferred", hint: "A finding was moved to another reporting period" },
      { type: "PERIOD_LOCKED", label: "Period locked", hint: "A reporting period was locked" },
      { type: "PERIOD_UNLOCKED", label: "Period unlocked", hint: "A reporting period was unlocked" },
    ],
  },
  {
    group: "Comments & support",
    events: [
      { type: "COMMENT", label: "Comment", hint: "A comment on a finding the user registered, or a reply to their comment" },
      { type: "SUPPORT_MESSAGE", label: "New support message", hint: "A user opened or followed up a support thread" },
      { type: "SUPPORT_REPLY", label: "Support reply", hint: "Support replied to the user's thread" },
    ],
  },
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_GROUPS)[number]["events"][number]["type"];

export const NOTIFICATION_EVENT_TYPES: readonly string[] = NOTIFICATION_EVENT_GROUPS.flatMap((g) => g.events.map((e) => e.type));

/**
 * Whether a notification of this type is also emailed. Every event is on
 * unless the admin switched it off - so an install that never touched the
 * setting (no `emailEvents` saved) behaves exactly as before, and so does
 * any type not listed above. The in-app bell notification is never affected.
 */
export function isEmailEnabled(emailEvents: Partial<Record<string, boolean>> | undefined, type: string): boolean {
  return emailEvents?.[type] !== false;
}
