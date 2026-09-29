"use client";

import { NOTIFICATION_EVENT_GROUPS, NOTIFICATION_EVENT_TYPES, isEmailEnabled } from "@/lib/notificationEvents";
import type { NotificationSettings } from "@/types";

/**
 * Settings → Email Events: which notification types are also emailed.
 * Unticking one stops only its email - the in-app bell notification is
 * still sent. See docs/email-events.md.
 */
export function EmailEventsEditor({
  notification,
  onChange,
}: {
  notification: NotificationSettings;
  onChange: (emailEvents: Record<string, boolean>) => void;
}) {
  const current = notification.emailEvents;
  const enabledCount = NOTIFICATION_EVENT_TYPES.filter((t) => isEmailEnabled(current, t)).length;
  const emailOff = notification.provider === "NONE";

  function setMany(types: readonly string[], on: boolean) {
    const next: Record<string, boolean> = {};
    for (const t of NOTIFICATION_EVENT_TYPES) next[t] = isEmailEnabled(current, t);
    for (const t of types) next[t] = on;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{enabledCount}</span> of {NOTIFICATION_EVENT_TYPES.length} events are emailed. Unticked
          events still appear in the notification bell, just without an email.
        </p>
        <div className="flex gap-3 text-sm">
          <button type="button" onClick={() => setMany(NOTIFICATION_EVENT_TYPES, true)} className="font-medium text-blue-800 hover:underline">
            Enable all
          </button>
          <button type="button" onClick={() => setMany(NOTIFICATION_EVENT_TYPES, false)} className="font-medium text-blue-800 hover:underline">
            Disable all
          </button>
        </div>
      </div>

      {emailOff && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Email delivery is off (Notification Delivery → Provider: None), so nothing is emailed yet. These choices apply once a
          provider is set up.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {NOTIFICATION_EVENT_GROUPS.map((g) => {
          const types = g.events.map((e) => e.type);
          const allOn = types.every((t) => isEmailEnabled(current, t));
          return (
            <fieldset key={g.group} className="rounded-md border border-slate-200 p-3">
              <legend className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                {g.group}
                <button
                  type="button"
                  onClick={() => setMany(types, !allOn)}
                  className="font-normal normal-case tracking-normal text-blue-800 hover:underline"
                >
                  {allOn ? "none" : "all"}
                </button>
              </legend>
              <div className="flex flex-col gap-2">
                {g.events.map((e) => (
                  <label key={e.type} className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={isEmailEnabled(current, e.type)}
                      onChange={(ev) => setMany([e.type], ev.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      <span className="font-medium text-slate-900">{e.label}</span>
                      <span className="block text-xs text-slate-500">{e.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
