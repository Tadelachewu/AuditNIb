"use client";

import { useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiSend } from "@/lib/api-client";
import { useServerList } from "@/lib/useServerList";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Label } from "@/components/ui/Field";
import { INPUT_FILTERS, codeError, entityNameError, LIMITS } from "@/lib/inputRules";
import { RuleInput } from "@/components/ui/RuleInput";
import { StatusBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { District } from "@/types";
import { notify, notifications } from "@/lib/notify";

type DistrictRow = District & { controllerNames: string[]; directorNames: string[] };

/** Comma-joined names, or a literal "--" when nobody is assigned. */
function namesOrDash(names: string[] | undefined) {
  return names && names.length > 0 ? names.join(", ") : "--";
}

export default function DistrictsPage() {
  const list = useServerList<DistrictRow>("/api/admin/districts", { key: "districts", defaultSort: { id: "name", desc: false } });
  const districts = list.rows;
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

  const load = list.reload;

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/districts", "POST", form);
      notify.success(notifications.district.created);
      setForm({ code: "", name: "" });
      close();
      await load();
    } catch (err) {
      setFormError(notify.formError(err, notifications.district.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  const editingItem = districts.find((x) => x.id === editingId) ?? null;

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
      notify.success(notifications.district.updated);
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(notify.formError(err, notifications.district.updateFailed));
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
      notify.success(notifications.district.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.district.deleteFailed);
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
      notify.success(d.status === "ACTIVE" ? notifications.district.deactivated : notifications.district.activated);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.district.statusFailed);
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
          return <span className="font-medium text-slate-900">{d.name}</span>;
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
    []
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Districts</h1>
      <p className="mt-1 text-sm text-slate-600">Bank-wide, config-driven — no hard-coded district count.</p>

      <Card className="mt-5">
        <CardHeader title="All Districts" description={`${list.total} total`}
          action={canCreate && (
            <AddDialog title="Add District">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="code">Code</Label>
                  <RuleInput id="code" required filter={INPUT_FILTERS.code} maxLength={LIMITS.code.max} check={(v) => codeError(v)} hint="Letters, numbers, dashes and underscores; no spaces" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="name">Name</Label>
                  <RuleInput id="name" required maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !!codeError(form.code) || !!entityNameError(form.name)}>
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
          server={list}
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
                  codeError(row.code) || entityNameError(row.name)
                    ? { error: (codeError(row.code) || entityNameError(row.name))!, label: row.code || row.name || "(blank)" }
                    : { payload: { code: row.code, name: row.name }, label: `${row.code} - ${row.name}` }
                }
                submit={(payload) => apiSend("/api/admin/districts", "POST", payload)}
                onDone={load}
              />
            )
          }
          renderRowActions={(d) => (
            <RowActions>
              {canEdit && <RowAction kind="edit" onClick={() => startEdit(d)} />}
              {canToggle && <StatusToggleAction active={d.status === "ACTIVE"} busy={rowBusy === d.id} onClick={() => toggleStatus(d)} />}
              {canDelete && <RowAction kind="delete" busy={rowBusy === d.id} onClick={() => deleteDistrict(d)} />}
            </RowActions>
          )}
        />
      </Card>
      {editingItem && (
        <Modal title={`Edit ${editingItem.name}`} description={editingItem.code} onClose={() => setEditingId(null)}>
          <form
            className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit(editingItem);
            }}
          >
            <div>
              <Label htmlFor="edit-name">District name</Label>
              <RuleInput id="edit-name" maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <StickyActions error={editError}>
              <Button type="button" variant="cancel" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={rowBusy === editingItem.id || !!entityNameError(editName)}>
                {rowBusy === editingItem.id ? "Saving..." : "Save Changes"}
              </Button>
            </StickyActions>
          </form>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
