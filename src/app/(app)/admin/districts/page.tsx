"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Label } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { District } from "@/types";

type DistrictRow = District & { controllerNames: string[]; directorNames: string[] };

/** Comma-joined names, or a literal "--" when nobody is assigned. */
function namesOrDash(names: string[] | undefined) {
  return names && names.length > 0 ? names.join(", ") : "--";
}

export default function DistrictsPage() {
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "districts.create");
  const canEdit = hasPermission(permissions, "districts.edit");
  const canToggle = hasPermission(permissions, "districts.toggle-status");
  const canDelete = hasPermission(permissions, "districts.delete");

  async function load() {
    setLoading(true);
    const res = await apiGet<{ districts: DistrictRow[] }>("/api/admin/districts");
    setDistricts(res.districts);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/districts", "POST", form);
      setForm({ code: "", name: "" });
      close();
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create district");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(d: District) {
    setEditingId(d.id);
    setEditName(d.name);
    setEditError(null);
  }

  async function saveEdit(d: District) {
    setRowBusy(d.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/districts/${d.id}`, "PATCH", { name: editName });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteDistrict(d: District) {
    const result = await confirm({
      title: "Permanently delete district?",
      message: `This removes "${d.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no branches or users still belong to it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(d.id);
    try {
      await apiSend(`/api/admin/districts/${d.id}`, "DELETE");
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete district");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleStatus(d: District) {
    if (d.status === "ACTIVE") {
      const result = await confirm({
        title: "Deactivate district?",
        message: `"${d.name}" and its branches will stay in the system but ${d.name} will no longer be selectable for new assignments. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(d.id);
    try {
      await apiSend(`/api/admin/districts/${d.id}`, "PATCH", { status: d.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update district");
    } finally {
      setRowBusy(null);
    }
  }

  const columns = useMemo<MRT_ColumnDef<DistrictRow>[]>(
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
        Cell: ({ row }) => {
          const d = row.original;
          if (editingId !== d.id) return <span className="font-medium text-slate-900">{d.name}</span>;
          return (
            <div>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-56" autoFocus />
              {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
            </div>
          );
        },
      },
      { id: "controllers", header: "District Controller(s)", accessorFn: (d) => namesOrDash(d.controllerNames) },
      { id: "directors", header: "District Director(s)", accessorFn: (d) => namesOrDash(d.directorNames) },
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
    [editingId, editName, editError]
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Districts</h1>
      <p className="mt-1 text-sm text-slate-600">Bank-wide, config-driven — no hard-coded district count.</p>

      <Card className="mt-5">
        <CardHeader title="All Districts" description={`${districts.length} total`}
          action={canCreate && (
            <AddDialog title="Add District">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="code">Code</Label>
                  <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adding..." : "Add District"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <AdminTable
          columns={columns}
          data={districts}
          isLoading={loading}
          getRowId={(d) => d.id}
          exportFileName="districts"
          emptyText="No districts yet."
          toolbarActions={
            canCreate && (
              <ImportCsvDialog
                entityLabel="districts"
                templateName="districts-import"
                columns={[
                  { key: "code", required: true, example: "AA", help: "Unique district code" },
                  { key: "name", required: true, example: "Addis Ababa District", help: "District name" },
                ]}
                toPayload={(row) =>
                  !row.code || !row.name
                    ? { error: "code and name are required", label: row.code || row.name || "(blank)" }
                    : { payload: { code: row.code, name: row.name }, label: `${row.code} - ${row.name}` }
                }
                submit={(payload) => apiSend("/api/admin/districts", "POST", payload)}
                onDone={load}
              />
            )
          }
          renderRowActions={(d) =>
            editingId === d.id ? (
              <RowActions inline>
                <RowAction kind="cancel" onClick={() => setEditingId(null)} />
                <RowAction kind="save" busy={rowBusy === d.id} label={rowBusy === d.id ? "Saving..." : "Save"} onClick={() => saveEdit(d)} />
              </RowActions>
            ) : (
              <RowActions>
                {canEdit && <RowAction kind="edit" onClick={() => startEdit(d)} />}
                {canToggle && <StatusToggleAction active={d.status === "ACTIVE"} busy={rowBusy === d.id} onClick={() => toggleStatus(d)} />}
                {canDelete && <RowAction kind="delete" busy={rowBusy === d.id} onClick={() => deleteDistrict(d)} />}
              </RowActions>
            )
          }
        />
      </Card>
      {dialog}
    </div>
  );
}
