"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Label } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { TableSkeletonRows } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { useClientPagination } from "@/lib/useClientPagination";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { District } from "@/types";

type DistrictRow = District & { controllerNames: string[]; directorNames: string[] };

/** Comma-joined names, or a literal "--" when nobody is assigned. */
function namesOrDash(names: string[]) {
  return names.length > 0 ? names.join(", ") : "--";
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
  const pager = useClientPagination(districts);

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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">District Controller(s)</th>
                <th className="px-4 py-2 font-medium">District Director(s)</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && <TableSkeletonRows cols={6} />}
              {!loading && districts.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                    No districts yet.
                  </td>
                </tr>
              )}
              {!loading &&
                pager.pageItems.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{d.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {editingId === d.id ? (
                        <div className="flex items-center gap-2">
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-56" />
                        </div>
                      ) : (
                        d.name
                      )}
                      {editingId === d.id && editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{namesOrDash(d.controllerNames)}</td>
                    <td className="px-4 py-2 text-slate-600">{namesOrDash(d.directorNames)}</td>
                    <td className="px-4 py-2">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editingId === d.id ? (
                        <RowActions inline>
                          <RowAction kind="cancel" onClick={() => setEditingId(null)} />
                          <RowAction kind="save" busy={rowBusy === d.id} label={rowBusy === d.id ? "Saving..." : "Save"} onClick={() => saveEdit(d)} />
                        </RowActions>
                      ) : (
                        <RowActions>
                          {canEdit && <RowAction kind="edit" onClick={() => startEdit(d)} />}
                          {canToggle && (
                            <StatusToggleAction active={d.status === "ACTIVE"} busy={rowBusy === d.id} onClick={() => toggleStatus(d)} />
                          )}
                          {canDelete && <RowAction kind="delete" busy={rowBusy === d.id} onClick={() => deleteDistrict(d)} />}
                        </RowActions>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} pageSize={pager.pageSize} onPageChange={pager.setPage} />
      </Card>
      {dialog}
    </div>
  );
}
