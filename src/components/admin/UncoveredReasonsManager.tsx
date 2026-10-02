"use client";

import { useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Label } from "@/components/ui/Field";
import { INPUT_FILTERS, codeError, entityNameError, LIMITS } from "@/lib/inputRules";
import { RuleInput } from "@/components/ui/RuleInput";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
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
      notify.success(notifications.uncoveredReason.created);
      setForm({ code: "", name: "" });
      close();
      router.refresh();
    } catch (err) {
      setFormError(notify.formError(err, notifications.uncoveredReason.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  const editingItem = reasons.find((x) => x.id === editingId) ?? null;

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
      notify.success(notifications.uncoveredReason.updated);
      setEditingId(null);
      router.refresh();
    } catch (err) {
      setEditError(notify.formError(err, notifications.uncoveredReason.updateFailed));
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
        Cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span>,
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
    []
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
                  <RuleInput id="code" required filter={INPUT_FILTERS.code} maxLength={LIMITS.code.max} check={(v) => codeError(v)} hint="Letters, numbers, dashes and underscores; no spaces" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <RuleInput id="name" required maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !!codeError(form.code) || !!entityNameError(form.name)}>
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
                  codeError(row.code) || entityNameError(row.name)
                    ? { error: (codeError(row.code) || entityNameError(row.name))!, label: row.code || row.name || "(blank)" }
                    : { payload: { code: row.code, name: row.name }, label: `${row.code} - ${row.name}` }
                }
                submit={(payload) => apiSend("/api/admin/uncovered-reasons", "POST", payload)}
                onDone={() => router.refresh()}
              />
          }
          renderRowActions={(r) => (
            <RowActions>
              <RowAction kind="edit" onClick={() => startEdit(r)} />
              <StatusToggleAction active={r.active} busy={rowBusy === r.id} onClick={() => toggleActive(r)} />
              <RowAction kind="delete" busy={rowBusy === r.id} onClick={() => deleteReason(r)} />
            </RowActions>
          )}
        />
      </Card>
      {editingItem && (
        <Modal title={`Edit ${editingItem.name}`} description={editingItem.code} onClose={() => setEditingId(null)}>
          <form
            className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit(editingItem);
            }}
          >
            <div>
              <Label htmlFor="edit-name">Reason name</Label>
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
    </>
  );
}
