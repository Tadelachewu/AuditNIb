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
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import type { Source } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { notify, notifications } from "@/lib/notify";

// The table is server-paged (useServerList): the server searches, filters,
// sorts and pages the list; after every change list.reload() fetches the page again.
interface SourcesPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canToggle: boolean;
  canDelete: boolean;
}

export function SourcesManager({ permissions }: { permissions: SourcesPermissions }) {
  const list = useServerList<Source>("/api/admin/sources", { key: "sources", defaultSort: { id: "name", desc: false } });
  const sources = list.rows;
  const { canCreate, canEdit, canToggle, canDelete } = permissions;
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
      await apiSend("/api/admin/sources", "POST", form);
      notify.success(notifications.source.created);
      setForm({ code: "", name: "" });
      close();
      list.reload();
    } catch (err) {
      setFormError(notify.formError(err, notifications.source.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  const editingItem = sources.find((x) => x.id === editingId) ?? null;

  function startEdit(s: Source) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditError(null);
  }

  async function saveEdit(s: Source) {
    setRowBusy(s.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "PATCH", { name: editName });
      notify.success(notifications.source.updated);
      setEditingId(null);
      list.reload();
    } catch (err) {
      setEditError(notify.formError(err, notifications.source.updateFailed));
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteSource(s: Source) {
    const result = await confirm({
      title: "Permanently delete source?",
      message: `This removes "${s.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no scoring rule still references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(s.id);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "DELETE");
      notify.success(notifications.source.deleted);
      list.reload();
    } catch (err) {
      notify.fromError(err, notifications.source.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(s: Source) {
    if (s.active) {
      const result = await confirm({
        title: "Deactivate source?",
        message: `"${s.name}" will no longer be selectable when registering new findings. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(s.id);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "PATCH", { active: !s.active });
      notify.success(s.active ? notifications.source.deactivated : notifications.source.activated);
      list.reload();
    } catch (err) {
      notify.fromError(err, notifications.source.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  // Setting one source default always unsets whichever one currently is
  // (server enforces this too) - unsetting the current default needs no
  // confirmation, but picking a new one is a one-click action either way.
  async function makeDefault(s: Source) {
    setRowBusy(s.id);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "PATCH", { isDefault: !s.isDefault });
      notify.success(s.isDefault ? notifications.source.defaultCleared : notifications.source.defaultSet);
      list.reload();
    } catch (err) {
      notify.fromError(err, notifications.source.defaultFailed);
    } finally {
      setRowBusy(null);
    }
  }

  const columns = useMemo<MRT_ColumnDef<Source>[]>(
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
      {
        id: "default",
        header: "Default",
        size: 110,
        accessorFn: (s) => (s.isDefault ? "Default" : ""),
        filterVariant: "select",
        filterSelectOptions: ["Default"],
        Cell: ({ row }) => (row.original.isDefault ? <Badge tone="gold">★ Default</Badge> : <span className="text-slate-400">—</span>),
      },
    ],
    []
  );

  return (
    <>
      <Card className="mt-5">
        <CardHeader title="All Sources" description={`${list.total} total`}
          action={canCreate && (
            <AddDialog title="Add Source">
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
                    {submitting ? "Adding..." : "Add Source"}
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
          getRowId={(s) => s.id}
          exportFileName="finding-sources"
          emptyText="No sources yet."
          tableOptions={{
            // The default source's row keeps its gold accent.
            muiTableBodyRowProps: ({ row }) =>
              row.original.isDefault
                ? { sx: { backgroundColor: "rgba(254, 185, 20, 0.10)", boxShadow: "inset 4px 0 0 0 #feb914" } }
                : {},
          }}
          toolbarActions={
            canCreate && (
              <ImportCsvDialog
                entityLabel="sources"
                templateName="sources-import"
                columns={[
                  { key: "code", required: true, example: "IC", help: "Unique code" },
                  { key: "name", required: true, example: "Internal Control", help: "Name" },
                ]}
                toPayload={(row) =>
                  codeError(row.code) || entityNameError(row.name)
                    ? { error: (codeError(row.code) || entityNameError(row.name))!, label: row.code || row.name || "(blank)" }
                    : { payload: { code: row.code, name: row.name }, label: `${row.code} - ${row.name}` }
                }
                submit={(payload) => apiSend("/api/admin/sources", "POST", payload)}
                onDone={() => list.reload()}
              />
            )
          }
          renderRowActions={(s) => (
            <RowActions>
              {canEdit && <RowAction kind="edit" onClick={() => startEdit(s)} />}
              {canEdit && (
                <RowAction
                  kind={s.isDefault ? "undefault" : "default"}
                  busy={rowBusy === s.id}
                  disabled={!s.isDefault && !s.active}
                  title={!s.isDefault && !s.active ? "Activate this source first" : "Pre-fill this source on new findings"}
                  onClick={() => makeDefault(s)}
                />
              )}
              {canToggle && <StatusToggleAction active={s.active} busy={rowBusy === s.id} onClick={() => toggleActive(s)} />}
              {canDelete && <RowAction kind="delete" busy={rowBusy === s.id} onClick={() => deleteSource(s)} />}
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
              <Label htmlFor="edit-name">Source name</Label>
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
