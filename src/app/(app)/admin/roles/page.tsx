"use client";

import { useState } from "react";
import { apiSend } from "@/lib/api-client";
import { useServerPager } from "@/lib/useServerList";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { CheckboxField, Select, Label } from "@/components/ui/Field";
import { INPUT_FILTERS, entityNameError, LIMITS, roleCodeError, textError } from "@/lib/inputRules";
import { RuleInput } from "@/components/ui/RuleInput";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import type { RoleDefinition, OrgScope } from "@/types";
import { permissionKey, type PageDefinition } from "@/lib/permissions/registry";
import { notify, notifications } from "@/lib/notify";

const ROLES_MANAGE_KEY = permissionKey("roles", "manage");

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
  // Server-paged: one page of roles at a time; the permission registry comes with it.
  const pager = useServerPager<RoleDefinition>("/api/admin/roles", "roles");
  const roles = pager.pageItems;
  const registry = (pager.meta.registry as PageDefinition[] | undefined) ?? [];
  const loading = pager.loading;
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
  const load = pager.reload;

  function togglePermission(list: string[], setList: (v: string[]) => void, key: string) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/roles", "POST", { ...form, permissions: newPermissions });
      notify.success(notifications.role.created);
      setForm(emptyForm);
      close();
      setNewPermissions([]);
      await load();
    } catch (err) {
      setFormError(notify.formError(err, notifications.role.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  const editingRole = roles.find((r) => r.id === expandedRoleId) ?? null;

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
      notify.success(notifications.role.updated);
      setExpandedRoleId(null);
      await load();
    } catch (err) {
      setEditError(notify.formError(err, notifications.role.updateFailed));
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
      notify.success(notifications.role.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.role.deleteFailed);
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
      notify.success(role.status === "ACTIVE" ? notifications.role.deactivated : notifications.role.activated);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.role.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Roles &amp; Permissions</h1>
      <p className="mt-1 text-sm text-slate-600">
        Roles are data, not code: create as many as your organization needs, and grant each one page-by-page,
        action-by-action access. The Administrator role can be narrowed like any other, except it always keeps
        &quot;Roles &amp; Permissions: Manage&quot;, so there&apos;s always a way back in.
      </p>

      <Card className="mt-5">
        <CardHeader title="All Roles" description={`${pager.total} total`}
          action={(
            <AddDialog size="xl" title="New Role">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="flex flex-col gap-4 p-4">
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="code">Code</Label>
                    <RuleInput
                      id="code"
                      required
                      maxLength={LIMITS.code.max}
                      placeholder="REGIONAL_AUDITOR"
                      check={(v) => roleCodeError(v)}
                      filter={INPUT_FILTERS.roleCode}
                      hint="UPPER_SNAKE_CASE, starting with a letter"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="name">Name</Label>
                    <RuleInput id="name" required maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                    <CheckboxField
                      id="branchSingleton"
                      label="At most one active user per branch"
                      checked={form.branchSingleton}
                      onChange={(branchSingleton) => setForm({ ...form, branchSingleton })}
                    />
                  )}
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <RuleInput
                    id="description"
                    maxLength={LIMITS.shortText.max}
                    check={(v) => textError(v, "Description", LIMITS.shortText.max)}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Permissions</Label>
                  <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
                    {registry.map((page) => (
                      <div key={page.code} className="flex flex-wrap items-center gap-3">
                        <span className="w-44 shrink-0 text-sm font-semibold text-slate-900">{page.label}</span>
                        {page.actions.map((a) => {
                          const key = `${page.code}.${a.action}`;
                          return (
                            <label
                              key={key}
                              className="flex items-center gap-1.5 text-xs text-slate-600"
                            >
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

                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !!roleCodeError(form.code) || !!entityNameError(form.name) || !!textError(form.description, "Description", LIMITS.shortText.max)}>
                    {submitting ? "Creating..." : "Create Role"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <div className="divide-y divide-slate-100">
          {loading && <ListSkeleton rows={5} />}
          {!loading &&
            pager.pageItems.map((role) => {
              const isAdminRole = role.code === "ADMIN";
              return (
                <div key={role.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-slate-900">{role.name}</span>{" "}
                      <span className="font-mono text-xs text-slate-500">{role.code}</span>{" "}
                      <Badge tone="blue">{ORG_SCOPE_LABELS[role.orgScope]}</Badge>{" "}
                      {role.isSystem && <Badge tone="gray">System</Badge>}{" "}
                      <Badge tone={role.status === "ACTIVE" ? "green" : "gray"}>{role.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">{role.permissions.length} permission(s)</span>
                    <RowActions>
                      <RowAction kind="edit" onClick={() => startEditing(role)} />
                      {!isAdminRole && (
                        <StatusToggleAction
                          active={role.status === "ACTIVE"}
                          busy={rowBusy === role.id}
                          onClick={() => toggleStatus(role)}
                        />
                      )}
                      {!role.isSystem && <RowAction kind="delete" busy={rowBusy === role.id} onClick={() => deleteRole(role)} />}
                    </RowActions>
                    </div>
                  </div>
                  {role.description && <p className="mt-1 text-xs text-slate-500">{role.description}</p>}

                </div>
              );
            })}
        </div>
        <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} pageSize={pager.pageSize} onPageChange={pager.setPage} />
      </Card>
      {editingRole && (
        <Modal title={`Edit ${editingRole.name}`} description={editingRole.code} size="xl" onClose={() => setExpandedRoleId(null)}>
          <form
            className="flex flex-col gap-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveRole(editingRole);
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-role-name">Name</Label>
                <RuleInput id="edit-role-name" maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={draftName} onChange={(e) => setDraftName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="edit-role-desc">Description</Label>
                <RuleInput
                  id="edit-role-desc"
                  maxLength={LIMITS.shortText.max}
                  check={(v) => textError(v, "Description", LIMITS.shortText.max)}
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                />
              </div>
            </div>

            {editingRole.code === "ADMIN" && (
              <p className="mt-3 text-xs text-slate-500">
                Narrowing the Administrator role is allowed, except for one line that can&apos;t be
                crossed: it must always keep &quot;Roles &amp; Permissions: Manage&quot;, or no
                administrator could ever open this screen again to undo a mistake.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {registry.map((page) => (
                <div key={page.code} className="flex flex-wrap items-center gap-3">
                  <span className="w-44 shrink-0 text-sm font-semibold text-slate-900">{page.label}</span>
                  {page.actions.map((a) => {
                    const key = `${page.code}.${a.action}`;
                    const locked = editingRole.code === "ADMIN" && key === ROLES_MANAGE_KEY;
                    return (
                      <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={draftPermissions.includes(key)}
                          disabled={locked}
                          onChange={() => togglePermission(draftPermissions, setDraftPermissions, key)}
                          className="h-3.5 w-3.5 rounded border-slate-300 disabled:opacity-50"
                        />
                        {a.label}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>

            <StickyActions error={editError}>
              <Button type="button" variant="cancel" onClick={() => setExpandedRoleId(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  rowBusy === editingRole.id ||
                  !!entityNameError(draftName) ||
                  !!textError(draftDescription, "Description", LIMITS.shortText.max)
                }
              >
                {rowBusy === editingRole.id ? "Saving..." : "Save Changes"}
              </Button>
            </StickyActions>
          </form>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
