"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import type { ReportingPeriod } from "@/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ReportingPeriodsPage() {
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [form, setForm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

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
    const reason = window.prompt(`Reason to ${nextStatus === "LOCKED" ? "lock" : "unlock"} ${p.code}:`);
    if (!reason) return;
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
        <CardHeader title="Open a New Period" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:items-end">
          <div>
            <Label htmlFor="year">Year</Label>
            <Select id="year" value={form.year} onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}>
              {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="month">Month</Label>
            <Select id="month" value={form.month} onChange={(e) => setForm({ ...form, month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
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
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last Change</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={4}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                periods.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">{p.code}</td>
                    <td className="px-4 py-2">
                      <Badge tone={p.status === "OPEN" ? "green" : "red"}>{p.status}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {p.lockReason ? `${p.lockReason} · ${new Date(p.updatedAt).toLocaleString()}` : "—"}
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
    </div>
  );
}
