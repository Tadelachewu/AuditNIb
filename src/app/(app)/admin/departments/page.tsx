"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiGet, apiSend, errorMessage } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Select, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { Department, District, Branch, OrgScope } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { notify, notifications } from "@/lib/notify";

const emptyForm = { code: "", name: "", orgScope: "BANK" as OrgScope, districtId: "", branchId: "" };
const emptyEditForm = { name: "", orgScope: "BANK" as OrgScope, districtId: "", branchId: "" };

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "departments.create");
  const canEdit = hasPermission(permissions, "departments.edit");
  const canToggle = hasPermission(permissions, "departments.toggle-status");
  const canDelete = hasPermission(permissions, "departments.delete");

  async function load() {
    setLoading(true);
    const [d, dist, br] = await Promise.all([
      apiGet<{ departments: Department[] }>("/api/admin/departments"),
      apiGet<{ districts: District[] }>("/api/admin/districts"),
      apiGet<{ branches: Branch[] }>("/api/admin/branches"),
    ]);
    setDepartments(d.departments);
    setDistricts(dist.districts);
    setBranches(br.branches);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const isDistrictScoped = form.orgScope === "DISTRICT";
  const isBranchScoped = form.orgScope === "BRANCH";
  const branchOptions = useMemo(
    () => (form.districtId ? branches.filter((b) => b.districtId === form.districtId) : branches),
    [branches, form.districtId]
  );

  const editIsDistrictScoped = editForm.orgScope === "DISTRICT";
  const editIsBranchScoped = editForm.orgScope === "BRANCH";
  const editBranchOptions = useMemo(
    () => (editForm.districtId ? branches.filter((b) => b.districtId === editForm.districtId) : branches),
    [branches, editForm.districtId]
  );

  function districtName(id?: string | null) {
    return districts.find((d) => d.id === id)?.name ?? "—";
  }
  function branchName(id?: string | null) {
    return branches.find((b) => b.id === id)?.name ?? "—";
  }
  function scopeLabel(d: Department) {
    if (d.orgScope === "BRANCH") return branchName(d.branchId);
    if (d.orgScope === "DISTRICT") return districtName(d.districtId);
    return "Bank-wide";
  }

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/departments", "POST", {
        code: form.code,
        name: form.name,
        orgScope: form.orgScope,
        districtId: form.districtId || undefined,
        branchId: form.branchId || undefined,
      });
      notify.success(notifications.department.created);
      setForm(emptyForm);
      close();
      await load();
    } catch (err) {
      setFormError(errorMessage(err, "Failed to create department"));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(d: Department) {
    setEditingId(d.id);
    setEditForm({
      name: d.name,
      orgScope: d.orgScope,
      districtId: d.districtId ?? "",
      branchId: d.branchId ?? "",
    });
    setEditError(null);
  }

  async function saveEdit(d: Department) {
    setRowBusy(d.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/departments/${d.id}`, "PATCH", {
        name: editForm.name,
        orgScope: editForm.orgScope,
        districtId: editForm.districtId || undefined,
        branchId: editForm.branchId || undefined,
      });
      notify.success(notifications.department.updated);
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(errorMessage(err, "Failed to save changes"));
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteDepartment(d: Department) {
    const result = await confirm({
      title: "Permanently delete department?",
      message: `This removes "${d.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no finding still references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(d.id);
    try {
      await apiSend(`/api/admin/departments/${d.id}`, "DELETE");
      notify.success(notifications.department.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.department.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(d: Department) {
    if (d.active) {
      const result = await confirm({
        title: "Deactivate department?",
        message: `"${d.name}" will no longer be selectable when registering new findings. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(d.id);
    try {
      await apiSend(`/api/admin/departments/${d.id}`, "PATCH", { active: !d.active });
      notify.success(d.active ? notifications.department.deactivated : notifications.department.activated);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.department.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  const editingDept = departments.find((d) => d.id === editingId) ?? null;

  const columns = useMemo<MRT_ColumnDef<Department>[]>(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        size: 90,
        Cell: ({ row }) => <span className="font-mono text-xs text-slate-600">{row.original.code}</span>,
      },
      { accessorKey: "name", header: "Name", Cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span> },
      {
        id: "scope",
        header: "Scope",
        accessorFn: (d) => (d.orgScope === "BANK" ? "Bank-wide" : `${d.orgScope === "BRANCH" ? "Branch" : "District"}: ${scopeLabel(d)}`),
        Cell: ({ row, cell }) =>
          row.original.orgScope === "BANK" ? <Badge tone="blue">Bank-wide</Badge> : <span className="text-slate-600">{cell.getValue<string>()}</span>,
      },
      {
        id: "level",
        header: "Level",
        size: 100,
        accessorFn: (d) => d.orgScope,
        filterVariant: "select",
        filterSelectOptions: [
          { value: "BANK", label: "Bank-wide" },
          { value: "DISTRICT", label: "District" },
          { value: "BRANCH", label: "Branch" },
        ],
      },
      {
        id: "status",
        header: "Status",
        size: 110,
        accessorFn: (d) => (d.active ? "Active" : "Inactive"),
        filterVariant: "select",
        filterSelectOptions: ["Active", "Inactive"],
        Cell: ({ row }) => <Badge tone={row.original.active ? "green" : "gray"}>{row.original.active ? "Active" : "Inactive"}</Badge>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [districts, branches]
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Departments</h1>
      <p className="mt-1 text-sm text-slate-600">
        The internal department a finding belongs to. Scope decides who can select it: bank-wide, one district, or
        one branch.
      </p>

      <Card className="mt-5">
        <CardHeader title="All Departments" description={`${departments.length} total`}
          action={canCreate && (
            <AddDialog title="Add Department">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label htmlFor="code">Code</Label>
                  <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="orgScope">Scope</Label>
                  <Select
                    id="orgScope"
                    value={form.orgScope}
                    onChange={(e) => setForm({ ...form, orgScope: e.target.value as OrgScope, districtId: "", branchId: "" })}
                  >
                    <option value="BANK">Bank-wide</option>
                    <option value="DISTRICT">District</option>
                    <option value="BRANCH">Branch</option>
                  </Select>
                </div>
                {(isDistrictScoped || isBranchScoped) && (
                  <div>
                    <Label htmlFor="districtId">District</Label>
                    <Select
                      id="districtId"
                      required
                      value={form.districtId}
                      onChange={(e) => setForm({ ...form, districtId: e.target.value, branchId: "" })}
                    >
                      <option value="">Select district</option>
                      {districts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                {isBranchScoped && (
                  <div>
                    <Label htmlFor="branchId">Branch</Label>
                    <Select id="branchId" required value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                      <option value="">Select branch</option>
                      {branchOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adding..." : "Add Department"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <AdminTable
          columns={columns}
          data={departments}
          isLoading={loading}
          getRowId={(d) => d.id}
          exportFileName="departments"
          emptyText="No departments yet."
          toolbarActions={
            canCreate && (
              <ImportCsvDialog
                entityLabel="departments"
                templateName="departments-import"
                columns={[
                  { key: "code", required: true, example: "OPS", help: "Unique department code" },
                  { key: "name", required: true, example: "Operations", help: "Department name" },
                  { key: "scope", required: true, example: "BANK", help: "BANK, DISTRICT or BRANCH" },
                  { key: "district", example: "", help: "For DISTRICT scope: the district's code or name" },
                  { key: "branch", example: "", help: "For BRANCH scope: the branch's code or name" },
                ]}
                toPayload={(row) => {
                  const label = row.code ? `${row.code} - ${row.name}` : row.name || "(blank)";
                  if (!row.code || !row.name) return { error: "code and name are required", label };
                  const scope = (row.scope ?? "").trim().toUpperCase();
                  if (!["BANK", "DISTRICT", "BRANCH"].includes(scope)) return { error: `scope must be BANK, DISTRICT or BRANCH, not "${row.scope}"`, label };
                  const find = <T extends { code: string; name: string }>(list: T[], v: string) => {
                    const k = v.trim().toLowerCase();
                    return list.find((x) => x.code.toLowerCase() === k || x.name.toLowerCase() === k);
                  };
                  if (scope === "DISTRICT") {
                    const dist = row.district ? find(districts, row.district) : undefined;
                    if (!dist) return { error: `Unknown or missing district "${row.district ?? ""}"`, label };
                    return { payload: { code: row.code, name: row.name, orgScope: scope, districtId: dist.id }, label };
                  }
                  if (scope === "BRANCH") {
                    const br = row.branch ? find(branches, row.branch) : undefined;
                    if (!br) return { error: `Unknown or missing branch "${row.branch ?? ""}"`, label };
                    return { payload: { code: row.code, name: row.name, orgScope: scope, districtId: br.districtId, branchId: br.id }, label };
                  }
                  return { payload: { code: row.code, name: row.name, orgScope: scope }, label };
                }}
                submit={(payload) => apiSend("/api/admin/departments", "POST", payload)}
                onDone={load}
              />
            )
          }
          renderRowActions={(d) => (
            <RowActions>
              {canEdit && (
                <RowAction
                  kind="edit"
                  disabled={editingId === d.id}
                  title={editingId === d.id ? "Already editing - use Save Changes or Cancel below" : "Edit"}
                  onClick={() => startEdit(d)}
                />
              )}
              {canToggle && <StatusToggleAction active={d.active} busy={rowBusy === d.id} onClick={() => toggleActive(d)} />}
              {canDelete && <RowAction kind="delete" busy={rowBusy === d.id} onClick={() => deleteDepartment(d)} />}
            </RowActions>
          )}
        />
        {/* Editor in a dialog, like Add (see the Users page's note). */}
        {editingDept && (
        <Modal title={`Edit ${editingDept.name}`} description={editingDept.code} size="xl" onClose={() => setEditingId(null)}>
          <div className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="edit-orgScope">Scope</Label>
                <Select
                  id="edit-orgScope"
                  value={editForm.orgScope}
                  onChange={(e) =>
                    setEditForm({ ...editForm, orgScope: e.target.value as OrgScope, districtId: "", branchId: "" })
                  }
                >
                  <option value="BANK">Bank-wide</option>
                  <option value="DISTRICT">District</option>
                  <option value="BRANCH">Branch</option>
                </Select>
              </div>
              {(editIsDistrictScoped || editIsBranchScoped) && (
                <div>
                  <Label htmlFor="edit-districtId">District</Label>
                  <Select
                    id="edit-districtId"
                    value={editForm.districtId}
                    onChange={(e) => setEditForm({ ...editForm, districtId: e.target.value, branchId: "" })}
                  >
                    <option value="">Select district</option>
                    {districts.map((dist) => (
                      <option key={dist.id} value={dist.id}>
                        {dist.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {editIsBranchScoped && (
                <div>
                  <Label htmlFor="edit-branchId">Branch</Label>
                  <Select
                    id="edit-branchId"
                    value={editForm.branchId}
                    onChange={(e) => setEditForm({ ...editForm, branchId: e.target.value })}
                  >
                    <option value="">Select branch</option>
                    {editBranchOptions.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
            <StickyActions className="mt-4" error={editError}>
              <Button variant="cancel" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button disabled={rowBusy === editingDept.id} onClick={() => saveEdit(editingDept)}>
                {rowBusy === editingDept.id ? "Saving..." : "Save Changes"}
              </Button>
            </StickyActions>
          </div>
        </Modal>
        )}
      </Card>
      {dialog}
    </div>
  );
}
