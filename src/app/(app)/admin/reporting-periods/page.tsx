"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ReportingPeriod } from "@/types";

// The GET route annotates each period with a live transfer preview (see
// outstandingTransferPreview() in src/lib/findings.ts) so the Lock dialog
// can ask an informed question instead of a blind checkbox.
type PeriodWithTransferPreview = ReportingPeriod & { outstandingTransferableCount: number; transferDestinationCode: string | null };

function startOfMonthLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01T00:00`;
}
function endOfMonthLocal(d: Date): string {
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, "0");
  const day = String(end.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}T23:59`;
}

export default function ReportingPeriodsPage() {
  const [periods, setPeriods] = useState<PeriodWithTransferPreview[]>([]);
  const [autoTransferAllowed, setAutoTransferAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [form, setForm] = useState({ startsAt: startOfMonthLocal(now), endsAt: endOfMonthLocal(now) });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  // Locking needs more input (the drafts-while-locked checkbox, and the
  // transfer-overdue-cases prompt) than the generic reason-only
  // useConfirm() dialog supports, so it gets its own small inline dialog
  // rather than widening that shared component's contract for every other
  // admin page that reuses it.
  const [lockTarget, setLockTarget] = useState<PeriodWithTransferPreview | null>(null);
  const [lockReasonInput, setLockReasonInput] = useState("");
  const [lockDraftsAllowed, setLockDraftsAllowed] = useState(true);
  const [lockTransferOverdue, setLockTransferOverdue] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  async function load() {
    setLoading(true);
    const res = await apiGet<{ reportingPeriods: PeriodWithTransferPreview[]; autoTransferOnLock: boolean }>(
      "/api/admin/reporting-periods"
    );
    setPeriods(res.reportingPeriods);
    setAutoTransferAllowed(res.autoTransferOnLock);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/reporting-periods", "POST", form);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create reporting period");
    } finally {
      setSubmitting(false);
    }
  }

  function openLockDialog(p: PeriodWithTransferPreview) {
    setLockDraftsAllowed(p.draftsAllowedWhileLocked);
    // Default to "yes, transfer" only when locking (not a flag-only edit
    // on an already-LOCKED period), the Admin allows it at all, and
    // there's actually something to transfer into somewhere - otherwise
    // there's nothing meaningful to default to yes on.
    setLockTransferOverdue(p.status === "OPEN" && autoTransferAllowed && p.outstandingTransferableCount > 0 && p.transferDestinationCode !== null);
    setLockReasonInput("");
    setLockTarget(p);
  }

  async function toggleLock(p: PeriodWithTransferPreview) {
    if (p.status === "OPEN") {
      openLockDialog(p);
      return;
    }
    // Unlocking doesn't touch draftsAllowedWhileLocked - it's only
    // meaningful while LOCKED - so it keeps using the generic dialog.
    const reason = await confirm({
      title: `Unlock ${p.code}?`,
      message: `Unlocking reopens ${p.code} for new writes bank-wide.`,
      confirmLabel: "Unlock",
      tone: "danger",
      needsReason: true,
    });
    if (reason === false) return;
    setRowBusy(p.id);
    try {
      await apiSend(`/api/admin/reporting-periods/${p.id}`, "PATCH", { status: "OPEN", reason });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update reporting period");
    } finally {
      setRowBusy(null);
    }
  }

  // True when adjusting drafts-while-locked on a period that's already
  // LOCKED (no status change), rather than locking a currently-OPEN one -
  // the same dialog serves both, just with different copy/payload.
  const isFlagEditOnly = lockTarget?.status === "LOCKED";

  async function confirmLock() {
    if (!lockTarget) return;
    setLockBusy(true);
    try {
      await apiSend(`/api/admin/reporting-periods/${lockTarget.id}`, "PATCH", {
        ...(isFlagEditOnly ? {} : { status: "LOCKED", transferOverdueCases: lockTransferOverdue }),
        reason: lockReasonInput,
        draftsAllowedWhileLocked: lockDraftsAllowed,
      });
      setLockTarget(null);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update reporting period");
    } finally {
      setLockBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Reporting Periods</h1>
      <p className="mt-1 text-sm text-slate-500">
        Locking a period blocks new writes against it, except DRAFT findings when explicitly allowed. Lock/unlock
        always requires a reason and is audit-logged.
      </p>

      <Card className="mt-5">
        <CardHeader
          title="Open a New Period"
          description="Created LOCKED by default (drafts still allowed) - use Unlock below to open it for the full workflow."
        />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:items-end">
          <div>
            <Label htmlFor="startsAt">Starts at (date &amp; time)</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="endsAt">Ends at (date &amp; time)</Label>
            <Input
              id="endsAt"
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </div>
          <div>
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Period"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Periods" description={`${periods.length} total`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">Date/Time Range</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last Change</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                periods.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">{p.code}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatDateTime(p.startsAt)} — {formatDateTime(p.endsAt)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={p.status === "OPEN" ? "green" : "red"}>{p.status}</Badge>
                      {p.status === "LOCKED" && (
                        <>
                          <Badge tone={p.draftsAllowedWhileLocked ? "blue" : "gray"} className="ml-1">
                            {p.draftsAllowedWhileLocked ? "Drafts allowed" : "Drafts blocked"}
                          </Badge>
                          <button
                            type="button"
                            onClick={() => openLockDialog(p)}
                            className="ml-1.5 text-xs text-blue-800 hover:underline"
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {p.lockReason ? `${p.lockReason} · ${formatDateTime(p.updatedAt)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="secondary" disabled={rowBusy === p.id} onClick={() => toggleLock(p)}>
                        {p.status === "OPEN" ? "Lock" : "Unlock"}
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
      {dialog}

      {lockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-900">
              {isFlagEditOnly ? `Update drafts setting for ${lockTarget.code}` : `Lock ${lockTarget.code}?`}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {isFlagEditOnly
                ? `${lockTarget.code} stays LOCKED - this only changes whether DRAFT findings can still be created/edited against it.`
                : `Locking blocks new writes against ${lockTarget.code} bank-wide, except explicitly authorized exceptions. This can be reversed by unlocking.`}
            </p>
            <div className="mt-3">
              <Label htmlFor="lock-reason">Reason</Label>
              <Input id="lock-reason" autoFocus value={lockReasonInput} onChange={(e) => setLockReasonInput(e.target.value)} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={lockDraftsAllowed}
                onChange={(e) => setLockDraftsAllowed(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Allow findings to still be drafted while locked
            </label>
            {!isFlagEditOnly && autoTransferAllowed && lockTarget.outstandingTransferableCount > 0 && (
              <>
                {lockTarget.transferDestinationCode ? (
                  <label className="mt-3 flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={lockTransferOverdue}
                      onChange={(e) => setLockTransferOverdue(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      Transfer {lockTarget.outstandingTransferableCount} outstanding case
                      {lockTarget.outstandingTransferableCount === 1 ? "" : "s"} to {lockTarget.transferDestinationCode}?
                    </span>
                  </label>
                ) : (
                  <p className="mt-3 text-xs text-amber-700">
                    {lockTarget.outstandingTransferableCount} outstanding case
                    {lockTarget.outstandingTransferableCount === 1 ? "" : "s"} in {lockTarget.code}, but there&apos;s no open
                    period after it to transfer into - open a later period first if you want to transfer them.
                  </p>
                )}
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setLockTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={lockBusy || lockReasonInput.trim().length < 5} onClick={confirmLock}>
                {lockBusy ? "Saving..." : isFlagEditOnly ? "Save" : "Lock"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
