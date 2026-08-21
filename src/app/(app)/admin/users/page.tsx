"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { ROLES, ROLE_LABELS, type Role, type SafeUser, type District, type Branch } from "@/types";

const BRANCH_SCOPED: Role[] = ["BRANCH_CONTROLLER", "BRANCH_MANAGER"];
const DISTRICT_SCOPED: Role[] = ["DISTRICT_CONTROLLER", "DISTRICT_DIRECTOR"];

const emptyForm = { name: "", username: "", password: "", role: "BRANCH_CONTROLLER" as Role, districtId: "", branchId: "" };

export default function UsersPage() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

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
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const branchesInDistrict = useMemo(
    () => branches.filter((b) => (form.districtId ? b.districtId === form.districtId : true)),
    [branches, form.districtId]
  );

  function districtName(id?: string | null) {
    return districts.find((d) => d.id === id)?.name ?? "—";
  }
  function branchName(id?: string | null) {
    return branches.find((b) => b.id === id)?.name ?? "—";
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
      });
      setForm(emptyForm);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(user: SafeUser) {
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

  const isBranchScoped = BRANCH_SCOPED.includes(form.role);
  const isDistrictScoped = DISTRICT_SCOPED.includes(form.role);

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Users</h1>
      <p className="mt-1 text-sm text-slate-500">
        Create, deactivate/reactivate users and assign role + organization unit. Each branch may have at most one
        active Branch Manager and one active Branch Internal Controller.
      </p>

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
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role, districtId: "", branchId: "" })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
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
              <Select
                id="branchId"
                required
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
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

          <div className="sm:col-span-2 lg:col-span-3">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
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
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last Login</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={7}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 font-medium text-slate-900">{u.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{u.username}</td>
                    <td className="px-4 py-2 text-slate-600">{ROLE_LABELS[u.role]}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {u.branchId ? branchName(u.branchId) : u.districtId ? districtName(u.districtId) : "Bank-wide"}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant={u.status === "ACTIVE" ? "danger" : "secondary"}
                        disabled={rowBusy === u.id}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
