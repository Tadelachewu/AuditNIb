"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { SafeUser, District, Branch, Department, RoleDefinition } from "@/types";

const emptyForm = { name: "", username: "", password: "", role: "", districtId: "", branchId: "", departmentId: "" };
const emptyEditForm = { name: "", role: "", districtId: "", branchId: "", departmentId: "", password: "" };

export default function UsersPage() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function loadAll() {
    setLoading(true);
    const [u, d, b] = await Promise.all([
      apiGet<{ users: SafeUser[] }>("/api/admin/users"),
      apiGet<{ districts: District[] }>("/api/admin/districts"),
      apiGet<{ branches: Branch[] }>("/api/admin/branches"),
    ]);
    setUsers(u.users);
    setDistricts(d.districts);
    setBranches(b.branches);

    // Same reasoning as the roles fetch below - department assignment is
    // optional, so a role that can manage users but lacks "departments.view"
    // still gets a working page, just without that one field.
    try {
      const dept = await apiGet<{ departments: Department[] }>("/api/admin/departments");
      setDepartments(dept.departments.filter((x) => x.active));
    } catch {
      setDepartments([]);
    }

    // Assigning a role requires being able to see the role catalog, i.e.
    // the "roles.view" permission too - kept as its own request so a role
    // that can manage users but not roles still gets a working page (with a
    // clear explanation) instead of the whole page failing to load.
    try {
      const r = await apiGet<{ roles: RoleDefinition[] }>("/api/admin/roles");
      setRoles(r.roles);
      setRolesError(null);
      setForm((f) => (f.role ? f : { ...f, role: r.roles.find((role) => role.status === "ACTIVE")?.code ?? "" }));
    } catch (err) {
      setRolesError(
        err instanceof ApiError && err.status === 403
          ? "You don't have permission to view the role catalog, so new users can't be assigned a role here. Ask an administrator to grant you \"Roles & Permissions › View\"."
          : "Failed to load roles."
      );
    }

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const activeRoles = useMemo(() => roles.filter((r) => r.status === "ACTIVE"), [roles]);
  const selectedRole = useMemo(() => roles.find((r) => r.code === form.role), [roles, form.role]);
  const editSelectedRole = useMemo(() => roles.find((r) => r.code === editForm.role), [roles, editForm.role]);
  const branchesInDistrict = useMemo(
    () => branches.filter((b) => (form.districtId ? b.districtId === form.districtId : true)),
    [branches, form.districtId]
  );
  const editBranchesInDistrict = useMemo(
    () => branches.filter((b) => (editForm.districtId ? b.districtId === editForm.districtId : true)),
    [branches, editForm.districtId]
  );

  // Stricter than NewFindingForm.tsx's departmentOptions (which also allows
  // bank-wide as a fallback): a user's department must match their role's
  // own org tier exactly - a branch-scoped user only sees departments
  // scoped to that exact branch, a district-scoped user only that exact
  // district, and a bank-scoped user (Admin/HO/Executive) only bank-wide
  // ones. No cross-tier fallback, unlike Finding registration.
  const departmentOptions = useMemo(() => {
    if (selectedRole?.orgScope === "BRANCH") return departments.filter((d) => d.orgScope === "BRANCH" && d.branchId === form.branchId);
    if (selectedRole?.orgScope === "DISTRICT") return departments.filter((d) => d.orgScope === "DISTRICT" && d.districtId === form.districtId);
    return departments.filter((d) => d.orgScope === "BANK");
  }, [departments, selectedRole, form.districtId, form.branchId]);

  const editDepartmentOptions = useMemo(() => {
    if (editSelectedRole?.orgScope === "BRANCH") return departments.filter((d) => d.orgScope === "BRANCH" && d.branchId === editForm.branchId);
    if (editSelectedRole?.orgScope === "DISTRICT") return departments.filter((d) => d.orgScope === "DISTRICT" && d.districtId === editForm.districtId);
    return departments.filter((d) => d.orgScope === "BANK");
  }, [departments, editSelectedRole, editForm.districtId, editForm.branchId]
  );

  function districtName(id?: string | null) {
    return districts.find((d) => d.id === id)?.name ?? "—";
  }
  function branchName(id?: string | null) {
    return branches.find((b) => b.id === id)?.name ?? "—";
  }
  function roleName(code: string) {
    return roles.find((r) => r.code === code)?.name ?? code;
  }
  function departmentName(id?: string | null) {
    if (!id) return "—";
    return departments.find((d) => d.id === id)?.name ?? "—";
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/users", "POST", {
        name: form.name,
        username: form.username,
        password: form.password,
        role: form.role,
        districtId: form.districtId || null,
        branchId: form.branchId || null,
        departmentId: form.departmentId || null,
      });
      setForm({ ...emptyForm, role: form.role });
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(user: SafeUser) {
    setEditingId(user.id);
    setEditForm({
      name: user.name,
      role: user.role,
      districtId: user.districtId ?? "",
      branchId: user.branchId ?? "",
      departmentId: user.departmentId ?? "",
      password: "",
    });
    setEditError(null);
  }

  async function saveEdit(user: SafeUser) {
    setRowBusy(user.id);
    setEditError(null);
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name,
        role: editForm.role,
        districtId: editForm.districtId || null,
        branchId: editForm.branchId || null,
        departmentId: editForm.departmentId || null,
      };
      if (editForm.password) payload.password = editForm.password;
      await apiSend(`/api/admin/users/${user.id}`, "PATCH", payload);
      setEditingId(null);
      await loadAll();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleStatus(user: SafeUser) {
    if (user.status === "ACTIVE") {
      const result = await confirm({
        title: "Deactivate user?",
        message: `"${user.name}" (${user.username}) will no longer be able to sign in. Any branch/district role they hold becomes available for reassignment. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(user.id);
    try {
      await apiSend(`/api/admin/users/${user.id}`, "PATCH", {
        status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      await loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update user");
    } finally {
      setRowBusy(null);
    }
  }

  const isBranchScoped = selectedRole?.orgScope === "BRANCH";
  const isDistrictScoped = selectedRole?.orgScope === "DISTRICT";
  const editIsBranchScoped = editSelectedRole?.orgScope === "BRANCH";
  const editIsDistrictScoped = editSelectedRole?.orgScope === "DISTRICT";

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Users</h1>
      <p className="mt-1 text-sm text-slate-500">
        Create, edit, deactivate/reactivate users and assign role + organization unit. Branch-scoped roles marked
        &quot;one active user per branch&quot; (in Roles &amp; Permissions) can only be held by one active person per
        branch at a time.
      </p>
      {rolesError && <p className="mt-2 text-sm text-amber-700">{rolesError}</p>}

      <Card className="mt-5">
        <CardHeader title="Add User" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="password">Temporary password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            <Select
              id="role"
              required
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value, districtId: "", branchId: "" })}
            >
              <option value="">Select role</option>
              {activeRoles.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>

          {(isDistrictScoped || isBranchScoped) && (
            <div>
              <Label htmlFor="districtId">District</Label>
              <Select
                id="districtId"
                required
                value={form.districtId}
                onChange={(e) => setForm({ ...form, districtId: e.target.value, branchId: "", departmentId: "" })}
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
              <Select
                id="branchId"
                required
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value, departmentId: "" })}
              >
                <option value="">Select branch</option>
                {branchesInDistrict.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="departmentId">Department (optional)</Label>
            <Select
              id="departmentId"
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            >
              <option value="">No department</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting || !form.role}>
              {submitting ? "Creating..." : "Create User"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Users" description={`${users.length} total`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Username</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">Org Unit</th>
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last Login</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={8}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                users.map((u) => {
                  const isEditing = editingId === u.id;
                  return (
                    <Fragment key={u.id}>
                      <tr>
                        <td className="px-4 py-2 font-medium text-slate-900">{u.name}</td>
                        <td className="px-4 py-2 font-mono text-xs text-slate-600">{u.username}</td>
                        <td className="px-4 py-2 text-slate-600">{roleName(u.role)}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {u.branchId ? branchName(u.branchId) : u.districtId ? districtName(u.districtId) : "Bank-wide"}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{departmentName(u.departmentId)}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={u.status} />
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => (isEditing ? setEditingId(null) : startEdit(u))}>
                              {isEditing ? "Cancel" : "Edit"}
                            </Button>
                            <Button
                              variant={u.status === "ACTIVE" ? "danger" : "secondary"}
                              disabled={rowBusy === u.id}
                              onClick={() => toggleStatus(u)}
                            >
                              {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 px-4 py-3">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <div>
                                <Label htmlFor="edit-name">Full name</Label>
                                <Input
                                  id="edit-name"
                                  value={editForm.name}
                                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                />
                              </div>
                              <div>
                                <Label htmlFor="edit-role">Role</Label>
                                <Select
                                  id="edit-role"
                                  value={editForm.role}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, role: e.target.value, districtId: "", branchId: "" })
                                  }
                                >
                                  {roles.map((r) => (
                                    <option key={r.id} value={r.code}>
                                      {r.name}
                                      {r.status === "INACTIVE" ? " (inactive)" : ""}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                              {(editIsDistrictScoped || editIsBranchScoped) && (
                                <div>
                                  <Label htmlFor="edit-districtId">District</Label>
                                  <Select
                                    id="edit-districtId"
                                    value={editForm.districtId}
                                    onChange={(e) => setEditForm({ ...editForm, districtId: e.target.value, branchId: "", departmentId: "" })}
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
                              {editIsBranchScoped && (
                                <div>
                                  <Label htmlFor="edit-branchId">Branch</Label>
                                  <Select
                                    id="edit-branchId"
                                    value={editForm.branchId}
                                    onChange={(e) => setEditForm({ ...editForm, branchId: e.target.value, departmentId: "" })}
                                  >
                                    <option value="">Select branch</option>
                                    {editBranchesInDistrict.map((b) => (
                                      <option key={b.id} value={b.id}>
                                        {b.name}
                                      </option>
                                    ))}
                                  </Select>
                                </div>
                              )}
                              <div>
                                <Label htmlFor="edit-departmentId">Department (optional)</Label>
                                <Select
                                  id="edit-departmentId"
                                  value={editForm.departmentId}
                                  onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                                >
                                  <option value="">No department</option>
                                  {editDepartmentOptions.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      {d.name}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                              <div>
                                <Label htmlFor="edit-password">Reset password (optional)</Label>
                                <Input
                                  id="edit-password"
                                  type="password"
                                  minLength={8}
                                  placeholder="Leave blank to keep current"
                                  value={editForm.password}
                                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                                />
                              </div>
                            </div>
                            {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                            <div className="mt-3 flex justify-end gap-2">
                              <Button variant="secondary" onClick={() => setEditingId(null)}>
                                Cancel
                              </Button>
                              <Button disabled={rowBusy === u.id} onClick={() => saveEdit(u)}>
                                {rowBusy === u.id ? "Saving..." : "Save Changes"}
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
