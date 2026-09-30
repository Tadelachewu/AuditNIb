"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiGet, apiSend, errorMessage } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Select, Label } from "@/components/ui/Field";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { District, Branch } from "@/types";
import { notify, notifications } from "@/lib/notify";

type BranchRow = Branch & { managerName: string | null; subManagerName: string | null; controllerName: string | null };

export default function BranchesPage() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "", districtId: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", districtId: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "branches.create");
  const canEdit = hasPermission(permissions, "branches.edit");
  const canToggle = hasPermission(permissions, "branches.toggle-status");
  const canDelete = hasPermission(permissions, "branches.delete");

  async function load() {
    setLoading(true);
    const [b, d] = await Promise.all([
      // The whole list (no ?page=) - the table searches, filters, sorts
      // and pages it client-side, so every branch is always searchable.
      apiGet<{ branches: BranchRow[] }>("/api/admin/branches"),
      apiGet<{ districts: District[] }>("/api/admin/districts"),
    ]);
    setBranches(b.branches);
    setDistricts(d.districts);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function districtName(id: string) {
    return districts.find((d) => d.id === id)?.name ?? "—";
  }

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/branches", "POST", form);
      setForm({ code: "", name: "", districtId: "" });
      close();
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "Failed to create branch"));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(b: BranchRow) {
    setEditingId(b.id);
    setEditForm({ name: b.name, districtId: b.districtId });
    setEditError(null);
  }

  async function saveEdit(b: BranchRow) {
    setRowBusy(b.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/branches/${b.id}`, "PATCH", editForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(errorMessage(err, "Failed to save changes"));
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteBranch(b: BranchRow) {
    const result = await confirm({
      title: "Permanently delete branch?",
      message: `This removes "${b.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no users are still assigned to it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(b.id);
    try {
      await apiSend(`/api/admin/branches/${b.id}`, "DELETE");
      notify.success(notifications.branch.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.branch.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleStatus(b: BranchRow) {
    if (b.status === "ACTIVE") {
      const result = await confirm({
        title: "Deactivate branch?",
        message: `"${b.name}" will no longer be selectable for new findings or user assignments. Its current Manager/Controller stay assigned. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(b.id);
    try {
      await apiSend(`/api/admin/branches/${b.id}`, "PATCH", { status: b.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      notify.success(b.status === "ACTIVE" ? notifications.branch.deactivated : notifications.branch.activated);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.branch.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  const columns = useMemo<MRT_ColumnDef<BranchRow>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        size: 90,
        Cell: ({ row }) => <span className="font-mono text-xs text-slate-600">{row.original.code}</span>,
      },
      {
        accessorKey: "name",
        header: "Name",
        Cell: ({ row }) =>
          editingId === row.original.id ? (
            <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="max-w-48" autoFocus />
          ) : (
            <span className="font-medium text-slate-900">{row.original.name}</span>
          ),
      },
      {
        id: "district",
        header: "District",
        accessorFn: (b) => districtName(b.districtId),
        filterVariant: "select",
        Cell: ({ row, cell }) =>
          editingId === row.original.id ? (
            <Select value={editForm.districtId} onChange={(e) => setEditForm({ ...editForm, districtId: e.target.value })}>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          ) : (
            <>{cell.getValue<string>()}</>
          ),
      },
      {
        id: "manager",
        header: "Manager",
        accessorFn: (b) => b.managerName ?? "",
        Cell: ({ row }) => (row.original.managerName ? <>{row.original.managerName}</> : <Badge tone="amber">Unassigned</Badge>),
        meta: { exportValue: (b: BranchRow) => b.managerName ?? "Unassigned" },
      },
      { id: "subManager", header: "Sub-Manager", accessorFn: (b) => b.subManagerName ?? "—" },
      {
        id: "controller",
        header: "Controller",
        accessorFn: (b) => b.controllerName ?? "",
        Cell: ({ row }) => (row.original.controllerName ? <>{row.original.controllerName}</> : <Badge tone="amber">Unassigned</Badge>),
        meta: { exportValue: (b: BranchRow) => b.controllerName ?? "Unassigned" },
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        filterVariant: "select",
        filterSelectOptions: [
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Inactive" },
        ],
        Cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, editForm, districts]
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Branches</h1>
      <p className="mt-1 text-sm text-slate-600">
        Linked to a district. Manager and Internal Controller are assigned from the Users page.
      </p>

      <Card className="mt-5">
        <CardHeader title="All Branches" description={`${branches.length} total`}
          action={canCreate && (
            <AddDialog title="Add Branch">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="code">Code</Label>
                  <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="districtId">District</Label>
                  <Select
                    id="districtId"
                    required
                    value={form.districtId}
                    onChange={(e) => setForm({ ...form, districtId: e.target.value })}
                  >
                    <option value="">Select district</option>
                    {districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adding..." : "Add Branch"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <AdminTable
          columns={columns}
          data={branches}
          isLoading={loading}
          getRowId={(b) => b.id}
          exportFileName="branches"
          emptyText="No branches yet."
          toolbarActions={
            canCreate && (
              <ImportCsvDialog
                entityLabel="branches"
                templateName="branches-import"
                columns={[
                  { key: "code", required: true, example: "BOLE", help: "Unique branch code" },
                  { key: "name", required: true, example: "Bole Branch", help: "Branch name" },
                  { key: "district", required: true, example: "AA", help: "The district's code or exact name" },
                ]}
                toPayload={(row) => {
                  const label = row.code ? `${row.code} - ${row.name}` : row.name || "(blank)";
                  if (!row.code || !row.name || !row.district) return { error: "code, name and district are required", label };
                  const key = row.district.trim().toLowerCase();
                  const district = districts.find((d) => d.code.toLowerCase() === key || d.name.toLowerCase() === key);
                  if (!district) return { error: `Unknown district "${row.district}"`, label };
                  return { payload: { code: row.code, name: row.name, districtId: district.id }, label };
                }}
                submit={(payload) => apiSend("/api/admin/branches", "POST", payload)}
                onDone={load}
              />
            )
          }
          renderRowActions={(b) =>
            editingId === b.id ? (
              <div className="flex flex-col items-end gap-1">
                {editError && <p className="text-xs text-red-600">{editError}</p>}
                <RowActions inline>
                  <RowAction kind="cancel" onClick={() => setEditingId(null)} />
                  <RowAction kind="save" busy={rowBusy === b.id} label={rowBusy === b.id ? "Saving..." : "Save"} onClick={() => saveEdit(b)} />
                </RowActions>
              </div>
            ) : (
              <RowActions>
                {canEdit && <RowAction kind="edit" onClick={() => startEdit(b)} />}
                {canToggle && <StatusToggleAction active={b.status === "ACTIVE"} busy={rowBusy === b.id} onClick={() => toggleStatus(b)} />}
                {canDelete && <RowAction kind="delete" busy={rowBusy === b.id} onClick={() => deleteBranch(b)} />}
              </RowActions>
            )
          }
        />
      </Card>
      {dialog}
    </div>
  );
}
