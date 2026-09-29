"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Select, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { ScoringAdjustment, District, Branch, ReportingPeriod } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";

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

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/scoring-adjustments", "POST", {
        ...form,
        value: Number(form.value),
      });
      setForm(emptyForm);
      close();
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

  const columns = useMemo<MRT_ColumnDef<ScoringAdjustment>[]>(
    () => [
      {
        id: "target",
        header: "Target",
        accessorFn: (a) => targetName(a),
        Cell: ({ row, cell }) => (
          <span className="text-slate-900">
            {cell.getValue<string>()} <span className="text-xs text-slate-500">({row.original.targetType})</span>
          </span>
        ),
      },
      {
        accessorKey: "targetType",
        header: "Level",
        size: 100,
        filterVariant: "select",
        filterSelectOptions: [
          { value: "BRANCH", label: "Branch" },
          { value: "DISTRICT", label: "District" },
        ],
      },
      { id: "period", header: "Period", size: 100, accessorFn: (a) => periodCode(a.periodId), filterVariant: "select" },
      {
        accessorKey: "value",
        header: "Value",
        size: 90,
        filterVariant: "range",
        Cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.value}%</span>,
      },
      {
        id: "status",
        header: "Status",
        size: 110,
        accessorFn: (a) => (a.status === "ACTIVE" ? "Active" : "Inactive"),
        filterVariant: "select",
        filterSelectOptions: ["Active", "Inactive"],
        Cell: ({ row }) => (
          <Badge tone={row.original.status === "ACTIVE" ? "green" : "gray"}>{row.original.status === "ACTIVE" ? "Active" : "Inactive"}</Badge>
        ),
      },
      { accessorKey: "reason", header: "Reason" },
      {
        accessorKey: "createdAt",
        header: "Date",
        meta: { exportValue: (a: ScoringAdjustment) => formatDateTime(a.createdAt) },
        Cell: ({ row }) => <span className="text-xs text-slate-500">{formatDateTime(row.original.createdAt)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [districts, branches, periods]
  );

  return (
    <div>
      {dialog}
      <h1 className="text-lg font-semibold text-slate-900">Scoring Adjustments</h1>
      <p className="mt-1 text-sm text-slate-600">
        A manual override of a branch&apos;s or district&apos;s performance % (0-100) for one reporting period. While ACTIVE it replaces
        the calculated figure on dashboards, rankings, the Reports page and the district report templates, marked
        &quot;Adjusted&quot; - case counts are never changed, and bank-wide totals always stay calculated. Only one adjustment per
        target and period is active at a time: adding or re-activating one deactivates the previous one. Every change needs a reason
        and is written to the audit trail.
      </p>

      <Card className="mt-5">
        <CardHeader title="Adjustment History" description={`${adjustments.length} total`}
          action={canCreate && (
            <AddDialog title="New Adjustment">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
                    min="0"
                    max="100"
                    required
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Label htmlFor="reason">Reason</Label>
                  <Input id="reason" required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                </div>
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Saving..." : "Record Adjustment"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        {rowError && <p className="px-4 pt-3 text-sm text-red-600">{rowError}</p>}
        <AdminTable
          columns={columns}
          data={adjustments}
          isLoading={loading}
          getRowId={(a) => a.id}
          exportFileName="scoring-adjustments"
          emptyText="No adjustments recorded."
          renderRowActions={
            canToggle
              ? (a) => (
                  <RowActions>
                    <StatusToggleAction active={a.status === "ACTIVE"} busy={rowBusy === a.id} onClick={() => toggleStatus(a)} />
                  </RowActions>
                )
              : undefined
          }
        />
      </Card>
    </div>
  );
}
