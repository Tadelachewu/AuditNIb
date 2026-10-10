"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { notify, notifications, presentError } from "@/lib/notify";
import { SENT_TODAY_LIMIT, type EmailQueueStatus } from "@/lib/emailQueue/types";

/** "2 s", "1 min 5 s", "3 h 12 min" - how long an email waited between being queued and being sent. */
function waited(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Settings -> Email Queue: what is waiting, sent and failed, whether the
 * worker is running, and the admin actions (pause / resume, send now, retry
 * or cancel a failed email) - docs/email-queue.md. Self-contained: loads and
 * acts through /api/admin/email-queue.
 */
export function EmailQueuePanel({ canEdit }: { canEdit: boolean }) {
  const [status, setStatus] = useState<EmailQueueStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSent, setShowSent] = useState(false);

  const load = useCallback(() => {
    apiGet<EmailQueueStatus>("/api/admin/email-queue", { background: true })
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((err) => setError(presentError(err, notifications.emailQueue.loadFailed).message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(body: { action: string; id?: string }, success: (typeof notifications.emailQueue)[keyof typeof notifications.emailQueue]) {
    setBusy(true);
    try {
      const res = await apiSend<{ status: EmailQueueStatus }>("/api/admin/email-queue", "POST", body);
      setStatus(res.status);
      notify.success(success);
    } catch (err) {
      notify.fromError(err, notifications.emailQueue.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  if (error && !status) return <p className="p-4 text-sm text-red-600">{error}</p>;
  if (!status) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  if (!status.installed) {
    return (
      <p className="m-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
        The email queue isn&apos;t installed on this database yet. Apply its migration (see docs/email-queue.md); until then notification emails
        are sent once, without retries.
      </p>
    );
  }

  const { counts, state } = status;
  const waiting = counts.PENDING + counts.QUEUED + counts.SENDING;
  const tiles: { label: string; value: number; tone: "blue" | "green" | "red" | "gray" }[] = [
    { label: "Waiting", value: waiting, tone: waiting > 0 ? "blue" : "gray" },
    { label: "Sent today", value: status.sentToday, tone: "green" },
    { label: "Failed", value: counts.FAILED, tone: counts.FAILED > 0 ? "red" : "gray" },
    { label: "Cancelled / expired", value: counts.CANCELLED, tone: "gray" },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      {!status.configured && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          Email can&apos;t be sent right now: {status.configProblem}. Nothing new is queued until that is fixed (Notification Delivery above).
        </p>
      )}
      {status.driver === "bullmq" && status.redis && !status.redis.ok && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          Redis isn&apos;t reachable, so BullMQ can&apos;t dispatch. Emails are being delivered by the built-in worker instead (every 20 seconds) and
          switch back by themselves when Redis returns. Nothing is lost.
        </p>
      )}
      {state.paused && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">
          <strong>Paused</strong>
          {state.pausedBy ? ` by ${state.pausedBy}` : ""}
          {state.pausedAt ? ` on ${formatDateTime(state.pausedAt)}` : ""}: {state.pausedReason ?? "no reason given"}. Emails keep queuing and are
          sent when the queue is resumed.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border border-slate-200 px-3 py-2">
            <dt className="text-xs text-slate-500">{t.label}</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <span className="text-xl font-semibold tabular-nums text-slate-900">{t.value}</span>
              {t.value > 0 && t.tone !== "gray" && <Badge tone={t.tone}>{t.label}</Badge>}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-slate-500">
        {status.oldestPendingAt ? `Oldest waiting since ${formatDateTime(status.oldestPendingAt)}. ` : "Nothing waiting. "}
        {state.lastRunAt ? `Last delivery run ${formatDateTime(state.lastRunAt)} (${state.lastRunBy ?? "worker"}). ` : "No delivery run yet. "}
        Worker: {status.workerMode === "external" ? "separate process (npm run worker:email)" : "inside the app"}.{" "}
        {status.driver === "bullmq"
          ? `Dispatch: BullMQ on Redis${status.redis?.ok ? ` (${status.redis.waiting} queued, ${status.redis.active} sending)` : " (unreachable)"}. `
          : "Dispatch: built-in worker, every 20 seconds. "}
        A failed send is retried after 1 min, 5 min, 15 min, 1 h and 4 h, then marked Failed.
      </p>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {state.paused ? (
            <Button type="button" variant="success" onClick={() => act({ action: "resume" }, notifications.emailQueue.resumed)} disabled={busy}>
              Resume sending
            </Button>
          ) : (
            <Button type="button" variant="warning" onClick={() => act({ action: "pause" }, notifications.emailQueue.paused)} disabled={busy}>
              Pause sending
            </Button>
          )}
          <Button type="button" variant="neutral" onClick={() => act({ action: "run" }, notifications.emailQueue.ran)} disabled={busy || state.paused || waiting === 0}>
            Send waiting now
          </Button>
          <Button type="button" variant="info" onClick={() => act({ action: "retry-all" }, notifications.emailQueue.retried)} disabled={busy || counts.FAILED === 0}>
            Retry all failed ({counts.FAILED})
          </Button>
        </div>
      )}

      {status.failed.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">Queued</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Why it failed</th>
                <th className="px-3 py-2 font-medium">Tries</th>
                {canEdit && <th className="px-3 py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {status.failed.map((f) => (
                <tr key={f.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatDateTime(f.createdAt)}</td>
                  <td className="px-3 py-2 text-slate-900">{f.toAddress}</td>
                  <td className="px-3 py-2 text-slate-700">{f.subject}</td>
                  <td className="px-3 py-2 text-red-700">{f.lastError ?? "Unknown"}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">{f.attempts}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex gap-1.5">
                        <Button type="button" variant="info" className="px-2 py-1 text-xs" onClick={() => act({ action: "retry", id: f.id }, notifications.emailQueue.retried)} disabled={busy}>
                          Retry
                        </Button>
                        <Button type="button" variant="cancel" className="px-2 py-1 text-xs" onClick={() => act({ action: "cancel", id: f.id }, notifications.emailQueue.cancelled)} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-slate-200">
        <button
          type="button"
          onClick={() => setShowSent((v) => !v)}
          aria-expanded={showSent}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium text-slate-900"
        >
          <span>
            Sent today ({status.sentToday})
            {status.sentToday > status.sent.length && <span className="ml-2 text-xs font-normal text-slate-500">showing the latest {SENT_TODAY_LIMIT}</span>}
          </span>
          <span className="text-xs font-normal text-slate-500">{showSent ? "Hide" : "Show"}</span>
        </button>
        {showSent &&
          (status.sent.length === 0 ? (
            <p className="border-t border-slate-200 px-3 py-4 text-center text-xs text-slate-500">No email has been sent today.</p>
          ) : (
            <div className="overflow-x-auto border-t border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Queued at</th>
                    <th className="px-3 py-2 font-medium">Sent at</th>
                    <th className="px-3 py-2 font-medium">Took</th>
                    <th className="px-3 py-2 font-medium">To</th>
                    <th className="px-3 py-2 font-medium">Subject</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Tries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {status.sent.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500" title={formatDateTime(e.createdAt)}>
                        {timeOnly(e.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-900" title={formatDateTime(e.sentAt)}>
                        {timeOnly(e.sentAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{waited(e.createdAt, e.sentAt)}</td>
                      <td className="px-3 py-2 text-slate-900">{e.toAddress}</td>
                      <td className="px-3 py-2 text-slate-700">{e.subject}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{e.notificationType ?? "-"}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-500">
                        {e.attempts}
                        {e.attempts > 1 && <Badge tone="amber" className="ml-1.5">retried</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}
