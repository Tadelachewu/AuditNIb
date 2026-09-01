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
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [form, setForm] = useState({ startsAt: startOfMonthLocal(now), endsAt: endOfMonthLocal(now) });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function load() {
    setLoading(true);
    const res = await apiGet<{ reportingPeriods: ReportingPeriod[] }>("/api/admin/reporting-periods");
    setPeriods(res.reportingPeriods);
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

  async function toggleLock(p: ReportingPeriod) {
    const nextStatus = p.status === "OPEN" ? "LOCKED" : "OPEN";
    const reason = await confirm({
      title: nextStatus === "LOCKED" ? `Lock ${p.code}?` : `Unlock ${p.code}?`,
      message:
        nextStatus === "LOCKED"
          ? `Locking blocks new writes against ${p.code} bank-wide, except explicitly authorized exceptions. This can be reversed by unlocking.`
          : `Unlocking reopens ${p.code} for new writes bank-wide.`,
      confirmLabel: nextStatus === "LOCKED" ? "Lock" : "Unlock",
      tone: "danger",
      needsReason: true,
    });
    if (reason === false) return;
    setRowBusy(p.id);
    try {
      await apiSend(`/api/admin/reporting-periods/${p.id}`, "PATCH", { status: nextStatus, reason });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update reporting period");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Reporting Periods</h1>
      <p className="mt-1 text-sm text-slate-500">
        Locking a period blocks new writes against it. Lock/unlock always requires a reason and is audit-logged.
      </p>

      <Card className="mt-5">
        <CardHeader title="Open a New Period" description="The period's code/month is derived from its start date/time." />
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
    </div>
  );
}
