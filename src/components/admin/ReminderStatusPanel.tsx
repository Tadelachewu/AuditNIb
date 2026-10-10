"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { notify, notifications, presentError } from "@/lib/notify";
import type { ReminderRun, ReminderStatus } from "@/lib/reminders/types";

const BY: Record<string, string> = { scheduler: "the scheduler", "in-app": "the app (someone was signed in)", manual: "an administrator" };

/**
 * Settings -> Rectification Reminders: what the daily run did and when it
 * runs next, plus "Run now" (docs/rectification-reminders.md). Reads the
 * SAVED settings - a change in the form above applies after Save.
 */
export function ReminderStatusPanel({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<ReminderStatus>("/api/admin/reminders", { background: true })
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((err) => setError(presentError(err, notifications.reminders.loadFailed).message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runNow() {
    setBusy(true);
    try {
      const res = await apiSend<{ run: ReminderRun; status: ReminderStatus }>("/api/admin/reminders", "POST");
      setStatus(res.status);
      notify.success(res.run.remindedFindings > 0 ? notifications.reminders.ran : notifications.reminders.nothingDue, {
        description: res.run.remindedFindings > 0 ? `${res.run.remindedFindings} finding(s), ${res.run.notifiedUsers} user(s)` : undefined,
      });
    } catch (err) {
      notify.fromError(err, notifications.reminders.runFailed);
    } finally {
      setBusy(false);
    }
  }

  if (error && !status) return <p className="text-xs text-red-600">{error}</p>;
  if (!status) return <p className="text-xs text-slate-500">Loading…</p>;
  if (!status.installed) {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        The daily scheduled run isn&apos;t installed on this database yet (apply its migration - see docs/rectification-reminders.md). Until then
        reminders are only checked while someone is signed in, at most once an hour, and the time and weekdays above aren&apos;t used.
      </p>
    );
  }

  const last = status.runs[0];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 text-xs text-slate-600">
      <p>
        <span className="font-medium text-slate-900">Saved schedule:</span>{" "}
        {status.config.enabled ? (
          <>
            {status.dueNow
              ? "due now - it runs on the scheduler's next call (within 5 minutes)"
              : status.nextRunAt
                ? `${status.ranToday ? "today's run is done; " : ""}next run ${formatDateTime(status.nextRunAt)}`
                : "no weekday is ticked, so it never runs"}
            . {status.overdueNow} finding(s) would be reminded now.
          </>
        ) : (
          "switched off."
        )}
      </p>
      <p>
        <span className="font-medium text-slate-900">Last run:</span>{" "}
        {last ? `${formatDateTime(last.ranAt)} by ${BY[last.triggeredBy] ?? last.triggeredBy} - ${last.remindedFindings} finding(s), ${last.notifiedUsers} user(s) notified` : "none yet"}
      </p>
      {status.runs.length > 1 && (
        <details>
          <summary className="cursor-pointer text-slate-500">Earlier runs</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {status.runs.slice(1).map((r) => (
              <li key={r.id}>
                {formatDateTime(r.ranAt)} · {BY[r.triggeredBy] ?? r.triggeredBy} · {r.remindedFindings} finding(s), {r.notifiedUsers} user(s)
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && status.config.enabled && (
        <div>
          <Button type="button" variant="neutral" className="px-2 py-1 text-xs" onClick={runNow} disabled={busy} title="Reminds every overdue finding now, whatever the time or weekday. Findings reminded recently are skipped.">
            {busy ? "Sending..." : "Run now"}
          </Button>
        </div>
      )}
    </div>
  );
}
