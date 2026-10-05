"use client";

import { useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiSend } from "@/lib/api-client";
import { useServerList } from "@/lib/useServerList";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { CheckboxField, Label } from "@/components/ui/Field";
import { INPUT_FILTERS, codeError, entityNameError, LIMITS } from "@/lib/inputRules";
import { RuleInput } from "@/components/ui/RuleInput";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { ClassifiedCategory } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { notify, notifications } from "@/lib/notify";

export default function CategoriesPage() {
  const list = useServerList<ClassifiedCategory>("/api/admin/categories", { key: "categories", defaultSort: { id: "name", desc: false } });
  const categories = list.rows;
  const [form, setForm] = useState({ code: "", name: "", scored: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "categories.create");
  const canEdit = hasPermission(permissions, "categories.edit");
  const canToggle = hasPermission(permissions, "categories.toggle-status");
  const canDelete = hasPermission(permissions, "categories.delete");

  const load = list.reload;

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/categories", "POST", form);
      notify.success(notifications.category.created);
      setForm({ code: "", name: "", scored: false });
      close();
      await load();
    } catch (err) {
      setFormError(notify.formError(err, notifications.category.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  const editingItem = categories.find((x) => x.id === editingId) ?? null;

  function startEdit(c: ClassifiedCategory) {
    setEditingId(c.id);
    setEditName(c.name);
    setEditError(null);
  }

  async function saveEdit(c: ClassifiedCategory) {
    setRowBusy(c.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/categories/${c.id}`, "PATCH", { name: editName });
      notify.success(notifications.category.updated);
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(notify.formError(err, notifications.category.updateFailed));
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(c: ClassifiedCategory) {
    if (c.active) {
      const result = await confirm({
        title: "Deactivate category?",
        message: `"${c.name}" will no longer be selectable when registering new findings. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(c.id);
    try {
      await apiSend(`/api/admin/categories/${c.id}`, "PATCH", { active: !c.active });
      notify.success(c.active ? notifications.category.deactivated : notifications.category.activated);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.category.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteCategory(c: ClassifiedCategory) {
    const result = await confirm({
      title: "Permanently delete category?",
      message: `This removes "${c.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no scoring rule still references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(c.id);
    try {
      await apiSend(`/api/admin/categories/${c.id}`, "DELETE");
      notify.success(notifications.category.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.category.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleScored(c: ClassifiedCategory) {
    const goingScored = !c.scored;
    const result = await confirm({
      title: goingScored ? "Include in scoring?" : "Remove from scoring?",
      message: goingScored
        ? `"${c.name}" will be eligible to be included in scoring rules and can affect the live performance calculation once added to the active rule.`
        : `"${c.name}" will no longer be eligible for scoring rules. If it's part of the active scoring rule, performance figures will change.`,
      confirmLabel: goingScored ? "Mark as scored" : "Remove from scoring",
      tone: goingScored ? "default" : "danger",
    });
    if (result === false) return;
    setRowBusy(c.id);
    try {
      await apiSend(`/api/admin/categories/${c.id}`, "PATCH", { scored: goingScored });
      notify.success(goingScored ? notifications.category.nowScored : notifications.category.notScored);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.category.updateFailed);
    } finally {
      setRowBusy(null);
    }
  }

  const columns = useMemo<MRT_ColumnDef<ClassifiedCategory>[]>(
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
        id: "scored",
        header: "Scored",
        accessorFn: (c) => (c.scored ? "Scored" : "Informational"),
        filterVariant: "select",
        filterSelectOptions: ["Scored", "Informational"],
        Cell: ({ row }) => {
          const c = row.original;
          const badge = <Badge tone={c.scored ? "blue" : "gray"}>{c.scored ? "Scored" : "Informational"}</Badge>;
          return canEdit ? (
            <button type="button" onClick={() => toggleScored(c)} disabled={rowBusy === c.id} title="Click to switch Scored / Informational">
              {badge}
            </button>
          ) : (
            badge
          );
        },
      },
      {
        id: "status",
        header: "Status",
        size: 110,
        accessorFn: (c) => (c.active ? "Active" : "Inactive"),
        filterVariant: "select",
        filterSelectOptions: ["Active", "Inactive"],
        Cell: ({ row }) => <Badge tone={row.original.active ? "green" : "gray"}>{row.original.active ? "Active" : "Inactive"}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowBusy, canEdit]
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Classified Case Categories</h1>
      <p className="mt-1 text-sm text-slate-600">
        Only categories marked <strong>Scored</strong> are included in the performance calculation; the rest stay
        visible for general reporting.
      </p>

      <Card className="mt-5">
        <CardHeader title="All Categories" description={`${list.total} total`}
          action={canCreate && (
            <AddDialog title="Add Category">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 items-start gap-3 p-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="code">Code</Label>
                  <RuleInput id="code" required filter={INPUT_FILTERS.code} maxLength={LIMITS.code.max} check={(v) => codeError(v)} hint="Letters, numbers, dashes and underscores; no spaces" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="name">Name</Label>
                  <RuleInput id="name" required maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <CheckboxField id="scored" label="Scored category" checked={form.scored} onChange={(scored) => setForm({ ...form, scored })} />
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !!codeError(form.code) || !!entityNameError(form.name)}>
                    {submitting ? "Adding..." : "Add Category"}
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
          getRowId={(c) => c.id}
          exportFileName="classified-categories"
          emptyText="No categories yet."
          toolbarActions={
            canCreate && (
              <ImportCsvDialog
                entityLabel="categories"
                templateName="categories-import"
                columns={[
                  { key: "code", required: true, example: "OTHER", help: "Unique category code" },
                  { key: "name", required: true, example: "Other Cases", help: "Category name" },
                  { key: "scored", example: "yes", help: "yes = counts toward performance; no (or blank) = informational only" },
                ]}
                toPayload={(row) => {
                  const label = row.code ? `${row.code} - ${row.name}` : row.name || "(blank)";
                  const bad = codeError(row.code) || entityNameError(row.name);
                  if (bad) return { error: bad, label };
                  const flag = (row.scored ?? "").trim().toLowerCase();
                  if (flag && !["yes", "no", "true", "false", "1", "0", "y", "n"].includes(flag)) return { error: `scored must be yes or no, not "${row.scored}"`, label };
                  return { payload: { code: row.code, name: row.name, scored: ["yes", "true", "1", "y"].includes(flag) }, label };
                }}
                submit={(payload) => apiSend("/api/admin/categories", "POST", payload)}
                onDone={load}
              />
            )
          }
          renderRowActions={(c) => (
            <RowActions>
              {canEdit && <RowAction kind="edit" onClick={() => startEdit(c)} />}
              {canToggle && <StatusToggleAction active={c.active} busy={rowBusy === c.id} onClick={() => toggleActive(c)} />}
              {canDelete && <RowAction kind="delete" busy={rowBusy === c.id} onClick={() => deleteCategory(c)} />}
            </RowActions>
          )}
        />
      </Card>
      {editingItem && (
        <Modal title={`Edit ${editingItem.name}`} description={editingItem.code} onClose={() => setEditingId(null)}>
          <form
            className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit(editingItem);
            }}
          >
            <div>
              <Label htmlFor="edit-name">Category name</Label>
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
