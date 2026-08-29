"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { Department, District, Branch, OrgScope } from "@/types";

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

  async function handleCreate(e: React.FormEvent) {
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
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create department");
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
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
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
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete department");
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
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update department");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Departments</h1>
      <p className="mt-1 text-sm text-slate-500">
        The internal department a finding belongs to. Scope decides who can select it: bank-wide, one district, or
        one branch.
      </p>

      <Card className="mt-5">
        <CardHeader title="Add Department" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="sm:col-span-2 lg:col-span-4">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add Department"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Departments" description={`${departments.length} total`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Scope</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                departments.map((d) => {
                  const isEditing = editingId === d.id;
                  return (
                    <Fragment key={d.id}>
                      <tr>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{d.code}</td>
                        <td className="px-4 py-2 font-medium text-slate-900">{d.name}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {d.orgScope === "BANK" ? (
                            <Badge tone="blue">Bank-wide</Badge>
                          ) : (
                            <span>
                              {d.orgScope === "BRANCH" ? "Branch: " : "District: "}
                              {scopeLabel(d)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={d.active ? "green" : "gray"}>{d.active ? "Active" : "Inactive"}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => (isEditing ? setEditingId(null) : startEdit(d))}>
                              {isEditing ? "Cancel" : "Edit"}
                            </Button>
                            <Button
                              variant={d.active ? "danger" : "secondary"}
                              disabled={rowBusy === d.id}
                              onClick={() => toggleActive(d)}
                            >
                              {d.active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button variant="danger" disabled={rowBusy === d.id} onClick={() => deleteDepartment(d)}>
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={5} className="bg-slate-50 px-4 py-3">
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
                            {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                            <div className="mt-3 flex justify-end gap-2">
                              <Button variant="secondary" onClick={() => setEditingId(null)}>
                                Cancel
                              </Button>
                              <Button disabled={rowBusy === d.id} onClick={() => saveEdit(d)}>
                                {rowBusy === d.id ? "Saving..." : "Save Changes"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
      {dialog}
    </div>
  );
}
