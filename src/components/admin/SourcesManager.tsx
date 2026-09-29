"use client";

import { useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import type { Source } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";

// The list itself is never copied into local state - `sources` is read
// straight from the prop the Server Component parent passes in, so a
// post-mutation router.refresh() (which re-runs that Server Component and
// hands down a fresh prop) is the one and only source of truth, instead
// of an apiGet()-triggered local reload racing a separately-tracked copy.
// Everything that *is* local state here is genuinely ephemeral UI: the
// add-form draft, which row is mid-edit, and per-row busy flags.
interface SourcesPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canToggle: boolean;
  canDelete: boolean;
}

export function SourcesManager({ initialSources, permissions }: { initialSources: Source[]; permissions: SourcesPermissions }) {
  const sources = initialSources;
  const { canCreate, canEdit, canToggle, canDelete } = permissions;
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
      await apiSend("/api/admin/sources", "POST", form);
      setForm({ code: "", name: "" });
      close();
      router.refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create source");
    } finally {
      setSubmitting(false);
    }
  }

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
      setEditingId(null);
      router.refresh();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
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
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete source");
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
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update source");
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
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update default source");
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
    [editingId, editName, editError]
  );

  return (
    <>
      <Card className="mt-5">
        <CardHeader title="All Sources" description={`${sources.length} total`}
          action={canCreate && (
            <AddDialog title="Add Source">
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
          data={sources}
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
                  !row.code || !row.name
                    ? { error: "code and name are required", label: row.code || row.name || "(blank)" }
                    : { payload: { code: row.code, name: row.name }, label: `${row.code} - ${row.name}` }
                }
                submit={(payload) => apiSend("/api/admin/sources", "POST", payload)}
                onDone={() => router.refresh()}
              />
            )
          }
          renderRowActions={(s) =>
            editingId === s.id ? (
              <RowActions inline>
                <RowAction kind="cancel" onClick={() => setEditingId(null)} />
                <RowAction kind="save" busy={rowBusy === s.id} label={rowBusy === s.id ? "Saving..." : "Save"} onClick={() => saveEdit(s)} />
              </RowActions>
            ) : (
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
            )
          }
        />
      </Card>
      {dialog}
    </>
  );
}
