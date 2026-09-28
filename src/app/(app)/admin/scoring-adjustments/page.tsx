"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { ScoringAdjustment, District, Branch, ReportingPeriod } from "@/types";

const emptyForm = { targetType: "DISTRICT" as "DISTRICT" | "BRANCH", targetId: "", periodId: "", value: "", reason: "" };

export default function ScoringAdjustmentsPage() {
  const [adjustments, setAdjustments] = useState<ScoringAdjustment[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [periods, setPeriods] = useState<ReportingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "scoring-adjustments.create");
  const canToggle = hasPermission(permissions, "scoring-adjustments.toggle-status");

  async function load() {
    setLoading(true);
    const [a, d, b, p] = await Promise.all([
      apiGet<{ scoringAdjustments: ScoringAdjustment[] }>("/api/admin/scoring-adjustments"),
      apiGet<{ districts: District[] }>("/api/admin/districts"),
      apiGet<{ branches: Branch[] }>("/api/admin/branches"),
      apiGet<{ reportingPeriods: ReportingPeriod[] }>("/api/admin/reporting-periods"),
    ]);
    setAdjustments(a.scoringAdjustments);
    setDistricts(d.districts);
    setBranches(b.branches);
    setPeriods(p.reportingPeriods);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const targetOptions = useMemo(
    () => (form.targetType === "DISTRICT" ? districts : branches),
    [form.targetType, districts, branches]
  );

  function targetName(a: ScoringAdjustment) {
    const list = a.targetType === "DISTRICT" ? districts : branches;
    return list.find((x) => x.id === a.targetId)?.name ?? a.targetId;
  }
  function periodCode(id: string) {
    return periods.find((p) => p.id === id)?.code ?? id;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/scoring-adjustments", "POST", {
        ...form,
        value: Number(form.value),
      });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create adjustment");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(a: ScoringAdjustment) {
    const activating = a.status === "INACTIVE";
    const reason = await confirm({
      title: activating ? "Re-activate this adjustment?" : "Deactivate this adjustment?",
      message: activating
        ? `${targetName(a)}'s ${periodCode(a.periodId)} performance will show ${a.value}% again, overriding the computed formula.`
        : `${targetName(a)}'s ${periodCode(a.periodId)} performance will revert to the computed formula (or "--" if not computable).`,
      confirmLabel: activating ? "Activate" : "Deactivate",
      tone: activating ? "success" : "danger",
      needsReason: true,
    });
    if (reason === false) return;

    setRowError(null);
    setRowBusy(a.id);
    try {
      await apiSend(`/api/admin/scoring-adjustments/${a.id}`, "PATCH", {
        status: activating ? "ACTIVE" : "INACTIVE",
        reason,
      });
      await load();
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "Failed to update status");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      {dialog}
      <h1 className="text-lg font-semibold text-slate-900">Scoring Adjustments</h1>
      <p className="mt-1 text-sm text-slate-600">
        A manual override of a computed score - while ACTIVE, it replaces the dashboard/report figure for that exact target and period
        outright. Every adjustment (and every activate/deactivate) requires a reason and is written to the audit trail.
      </p>

      {canCreate && (
      <Card className="mt-5">
        <CardHeader title="New Adjustment" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="targetType">Target type</Label>
            <Select
              id="targetType"
              value={form.targetType}
              onChange={(e) => setForm({ ...form, targetType: e.target.value as "DISTRICT" | "BRANCH", targetId: "" })}
            >
              <option value="DISTRICT">District</option>
              <option value="BRANCH">Branch</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="targetId">{form.targetType === "DISTRICT" ? "District" : "Branch"}</Label>
            <Select id="targetId" required value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })}>
              <option value="">Select...</option>
              {targetOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="periodId">Reporting period</Label>
            <Select id="periodId" required value={form.periodId} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
              <option value="">Select...</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="value">Adjusted score (%)</Label>
            <Input
              id="value"
              type="number"
              step="0.01"
              required
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Record Adjustment"}
            </Button>
          </div>
        </form>
      </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="Adjustment History" description={`${adjustments.length} total`} />
        {rowError && <p className="px-4 pt-3 text-sm text-red-600">{rowError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">Value</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Reason</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={7}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading && adjustments.length === 0 && (
                <tr>
                  <td className="px-4 py-4 text-slate-500" colSpan={7}>
                    No adjustments recorded.
                  </td>
                </tr>
              )}
              {!loading &&
                adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2 text-slate-900">
                      {targetName(a)} <span className="text-xs text-slate-500">({a.targetType})</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{periodCode(a.periodId)}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{a.value}%</td>
                    <td className="px-4 py-2">
                      <Badge tone={a.status === "ACTIVE" ? "green" : "gray"}>{a.status === "ACTIVE" ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{a.reason}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(a.createdAt)}</td>
                    <td className="px-4 py-2">
                      {canToggle && (
                        <Button
                          variant={a.status === "ACTIVE" ? "danger" : "success"}
                          disabled={rowBusy === a.id}
                          onClick={() => toggleStatus(a)}
                        >
                          {a.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </Button>
                      )}
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
