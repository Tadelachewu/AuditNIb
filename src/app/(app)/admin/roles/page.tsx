"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { RoleDefinition, OrgScope } from "@/types";
import type { PageDefinition } from "@/lib/permissions/registry";

const ORG_SCOPE_LABELS: Record<OrgScope, string> = {
  BANK: "Bank-wide",
  DISTRICT: "District",
  BRANCH: "Branch",
};

const emptyForm = {
  code: "",
  name: "",
  description: "",
  orgScope: "BANK" as OrgScope,
  branchSingleton: false,
};

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [registry, setRegistry] = useState<PageDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [newPermissions, setNewPermissions] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function load() {
    setLoading(true);
    const res = await apiGet<{ roles: RoleDefinition[]; registry: PageDefinition[] }>("/api/admin/roles");
    setRoles(res.roles);
    setRegistry(res.registry);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function togglePermission(list: string[], setList: (v: string[]) => void, key: string) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/roles", "POST", { ...form, permissions: newPermissions });
      setForm(emptyForm);
      setNewPermissions([]);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create role");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditing(role: RoleDefinition) {
    setExpandedRoleId(role.id);
    setDraftPermissions(role.permissions);
    setDraftName(role.name);
    setDraftDescription(role.description ?? "");
    setEditError(null);
  }

  async function saveRole(role: RoleDefinition) {
    setRowBusy(role.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/roles/${role.id}`, "PATCH", {
        name: draftName,
        description: draftDescription,
        permissions: draftPermissions,
      });
      setExpandedRoleId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to update role");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteRole(role: RoleDefinition) {
    const result = await confirm({
      title: "Permanently delete role?",
      message: `This removes "${role.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no user still holds this role.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(role.id);
    try {
      await apiSend(`/api/admin/roles/${role.id}`, "DELETE");
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete role");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleStatus(role: RoleDefinition) {
    if (role.status === "ACTIVE") {
      const result = await confirm({
        title: "Deactivate role?",
        message: `Anyone currently holding "${role.name}" keeps their existing session until they next log in, but can no longer log in afterward, and the role won't be assignable to new users. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(role.id);
    try {
      await apiSend(`/api/admin/roles/${role.id}`, "PATCH", { status: role.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update role");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Roles &amp; Permissions</h1>
      <p className="mt-1 text-sm text-slate-500">
        Roles are data, not code: create as many as your organization needs, and grant each one page-by-page,
        action-by-action access. The Administrator role always holds every permission and can&apos;t be edited away,
        so there&apos;s always a way back in.
      </p>

      <Card className="mt-5">
        <CardHeader title="New Role" />
        <form onSubmit={handleCreate} className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                required
                placeholder="REGIONAL_AUDITOR"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="orgScope">Organization scope</Label>
              <Select
                id="orgScope"
                value={form.orgScope}
                onChange={(e) => setForm({ ...form, orgScope: e.target.value as OrgScope })}
              >
                <option value="BANK">Bank-wide</option>
                <option value="DISTRICT">District</option>
                <option value="BRANCH">Branch</option>
              </Select>
            </div>
            {form.orgScope === "BRANCH" && (
              <div className="flex items-center gap-2 pb-1.5 pt-5">
                <input
                  id="branchSingleton"
                  type="checkbox"
                  checked={form.branchSingleton}
                  onChange={(e) => setForm({ ...form, branchSingleton: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <Label htmlFor="branchSingleton">At most one active user per branch</Label>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div>
            <Label>Permissions</Label>
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              {registry.map((page) => (
                <div key={page.code} className="flex flex-wrap items-center gap-3">
                  <span className="w-44 shrink-0 text-sm text-slate-700">{page.label}</span>
                  {page.actions.map((a) => {
                    const key = `${page.code}.${a.action}`;
                    return (
                      <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={newPermissions.includes(key)}
                          onChange={() => togglePermission(newPermissions, setNewPermissions, key)}
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        {a.label}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating..." : "Create Role"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Roles" description={`${roles.length} total`} />
        <div className="divide-y divide-slate-100">
          {loading && <p className="px-4 py-4 text-sm text-slate-400">Loading...</p>}
          {!loading &&
            roles.map((role) => {
              const isAdminRole = role.code === "ADMIN";
              const isExpanded = expandedRoleId === role.id;
              return (
                <div key={role.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-slate-900">{role.name}</span>{" "}
                      <span className="font-mono text-xs text-slate-400">{role.code}</span>{" "}
                      <Badge tone="blue">{ORG_SCOPE_LABELS[role.orgScope]}</Badge>{" "}
                      {role.isSystem && <Badge tone="gray">System</Badge>}{" "}
                      <Badge tone={role.status === "ACTIVE" ? "green" : "gray"}>{role.status}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">{role.permissions.length} permission(s)</span>
                      <Button
                        variant="secondary"
                        onClick={() => (isExpanded ? setExpandedRoleId(null) : startEditing(role))}
                      >
                        {isExpanded ? "Cancel" : "Edit role"}
                      </Button>
                      {!isAdminRole && (
                        <Button variant={role.status === "ACTIVE" ? "danger" : "secondary"} disabled={rowBusy === role.id} onClick={() => toggleStatus(role)}>
                          {role.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                        </Button>
                      )}
                      {!role.isSystem && (
                        <Button variant="danger" disabled={rowBusy === role.id} onClick={() => deleteRole(role)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                  {role.description && <p className="mt-1 text-xs text-slate-500">{role.description}</p>}

                  {isExpanded && (
                    <div className="mt-3 rounded-md border border-slate-200 p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={`name-${role.id}`}>Name</Label>
                          <Input id={`name-${role.id}`} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
                        </div>
                        <div>
                          <Label htmlFor={`desc-${role.id}`}>Description</Label>
                          <Input
                            id={`desc-${role.id}`}
                            value={draftDescription}
                            onChange={(e) => setDraftDescription(e.target.value)}
                          />
                        </div>
                      </div>

                      {isAdminRole ? (
                        <p className="mt-3 text-xs text-slate-500">
                          The Administrator role always holds every permission and can&apos;t be narrowed - only its
                          name and description can change here.
                        </p>
                      ) : (
                        <div className="mt-3 flex flex-col gap-2">
                          {registry.map((page) => (
                            <div key={page.code} className="flex flex-wrap items-center gap-3">
                              <span className="w-44 shrink-0 text-sm text-slate-700">{page.label}</span>
                              {page.actions.map((a) => {
                                const key = `${page.code}.${a.action}`;
                                return (
                                  <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={draftPermissions.includes(key)}
                                      onChange={() => togglePermission(draftPermissions, setDraftPermissions, key)}
                                      className="h-3.5 w-3.5 rounded border-slate-300"
                                    />
                                    {a.label}
                                  </label>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}

                      {editError && <p className="mt-2 text-sm text-red-600">{editError}</p>}
                      <div className="mt-3">
                        <Button disabled={rowBusy === role.id} onClick={() => saveRole(role)}>
                          {rowBusy === role.id ? "Saving..." : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </Card>
      {dialog}
    </div>
  );
}
