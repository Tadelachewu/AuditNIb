"use client";

import { useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { useRouter } from "next/navigation";
import { apiSend, errorMessage } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import type { UncoveredReason } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { notify, notifications } from "@/lib/notify";

// Same convention as SourcesManager: the list is a prop refreshed via
// router.refresh() after every mutation, not a duplicated client copy -
// only genuinely ephemeral UI state (the add-form draft, which row is mid-
// edit, per-row busy flags) lives here.
export function UncoveredReasonsManager({ initialReasons }: { initialReasons: UncoveredReason[] }) {
  const reasons = initialReasons;
  const router = useRouter();
  const [form, setForm] = useState({ code: "", name: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/uncovered-reasons", "POST", form);
      setForm({ code: "", name: "" });
      close();
      router.refresh();
    } catch (err) {
      setFormError(errorMessage(err, "Failed to create reason"));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(r: UncoveredReason) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditError(null);
  }

  async function saveEdit(r: UncoveredReason) {
    setRowBusy(r.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/uncovered-reasons/${r.id}`, "PATCH", { name: editName });
      setEditingId(null);
      router.refresh();
    } catch (err) {
      setEditError(errorMessage(err, "Failed to save changes"));
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteReason(r: UncoveredReason) {
    const result = await confirm({
      title: "Permanently delete reason?",
      message: `This removes "${r.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no coverage note still references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(r.id);
    try {
      await apiSend(`/api/admin/uncovered-reasons/${r.id}`, "DELETE");
      notify.success(notifications.uncoveredReason.deleted);
      router.refresh();
    } catch (err) {
      notify.fromError(err, notifications.uncoveredReason.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(r: UncoveredReason) {
    if (r.active) {
      const result = await confirm({
        title: "Deactivate reason?",
        message: `"${r.name}" will no longer be offered when recording why a branch went uncovered. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(r.id);
    try {
      await apiSend(`/api/admin/uncovered-reasons/${r.id}`, "PATCH", { active: !r.active });
      notify.success(r.active ? notifications.uncoveredReason.deactivated : notifications.uncoveredReason.activated);
      router.refresh();
    } catch (err) {
      notify.fromError(err, notifications.uncoveredReason.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  const columns = useMemo<MRT_ColumnDef<UncoveredReason>[]>(
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
            <div>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-56" autoFocus />
              {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
            </div>
          ) : (
            <span className="font-medium text-slate-900">{row.original.name}</span>
          ),
      },
      {
        id: "status",
        header: "Status",
        size: 110,
        accessorFn: (x) => (x.active ? "Active" : "Inactive"),
        filterVariant: "select",
        filterSelectOptions: ["Active", "Inactive"],
        Cell: ({ row }) => <Badge tone={row.original.active ? "green" : "gray"}>{row.original.active ? "Active" : "Inactive"}</Badge>,
      },
    ],
    [editingId, editName, editError]
  );

  return (
    <>
      <Card className="mt-5">
        <CardHeader title="All Reasons" description={`${reasons.length} total - reporters can always type their own via "Other" instead`}
          action={(
            <AddDialog title="Add Reason">
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
                    {submitting ? "Adding..." : "Add Reason"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <AdminTable
          columns={columns}
          data={reasons}
          getRowId={(r) => r.id}
          exportFileName="uncovered-branch-reasons"
          emptyText="No reasons yet."
          toolbarActions={
              <ImportCsvDialog
                entityLabel="reasons"
                templateName="uncovered-reasons-import"
                columns={[
                  { key: "code", required: true, example: "NOSTAFF", help: "Unique code" },
                  { key: "name", required: true, example: "No staff available", help: "Name" },
                ]}
                toPayload={(row) =>
                  !row.code || !row.name
                    ? { error: "code and name are required", label: row.code || row.name || "(blank)" }
                    : { payload: { code: row.code, name: row.name }, label: `${row.code} - ${row.name}` }
                }
                submit={(payload) => apiSend("/api/admin/uncovered-reasons", "POST", payload)}
                onDone={() => router.refresh()}
              />
          }
          renderRowActions={(r) =>
            editingId === r.id ? (
              <RowActions inline>
                <RowAction kind="cancel" onClick={() => setEditingId(null)} />
                <RowAction kind="save" busy={rowBusy === r.id} label={rowBusy === r.id ? "Saving..." : "Save"} onClick={() => saveEdit(r)} />
              </RowActions>
            ) : (
              <RowActions>
                <RowAction kind="edit" onClick={() => startEdit(r)} />
                <StatusToggleAction active={r.active} busy={rowBusy === r.id} onClick={() => toggleActive(r)} />
                <RowAction kind="delete" busy={rowBusy === r.id} onClick={() => deleteReason(r)} />
              </RowActions>
            )
          }
        />
      </Card>
      {dialog}
    </>
  );
}
