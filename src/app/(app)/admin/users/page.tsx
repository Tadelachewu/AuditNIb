"use client";

import { useEffect, useMemo, useState } from "react";
import type { MRT_ColumnDef } from "material-react-table";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Select, Label } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { SafeUser, District, Branch, Department, RoleDefinition } from "@/types";
import { AdminTable } from "@/components/ui/AdminTable";
import { ImportCsvDialog } from "@/components/ui/ImportCsvDialog";
import { notify, notifications } from "@/lib/notify";
import { PasswordRules } from "@/components/ui/PasswordRules";
import { validatePasswordStrength } from "@/lib/passwordValidation";
import { usernameError, USERNAME_MAX_LENGTH, USERNAME_RULE_TEXT } from "@/lib/usernameValidation";
import { INPUT_FILTERS, emailError, LIMITS, personNameError, phoneError } from "@/lib/inputRules";
import { RuleInput } from "@/components/ui/RuleInput";

const emptyForm = { name: "", username: "", email: "", phone: "", password: "", role: "", districtId: "", branchId: "", departmentId: "" };
const emptyEditForm = { name: "", email: "", phone: "", role: "", districtId: "", branchId: "", departmentId: "", password: "" };

export default function UsersPage() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  // Same rules as the server (src/lib/usernameValidation.ts, src/lib/passwordValidation.ts).
  const [usernameTouched, setUsernameTouched] = useState(false);
  const newUsernameError = usernameError(form.username.trim());
  const newPasswordValid = validatePasswordStrength(form.password).valid;
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "users.create");
  const canEdit = hasPermission(permissions, "users.edit");
  const canToggle = hasPermission(permissions, "users.toggle-status");
  const canDelete = hasPermission(permissions, "users.delete");

  async function loadAll() {
    setLoading(true);
    const [u, d, b] = await Promise.all([
      // Everyone at once - the table searches, filters and pages client-side.
      apiGet<{ users: SafeUser[] }>("/api/admin/users?all=1"),
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

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/users", "POST", {
        name: form.name.trim(),
        username: form.username.trim(),
        email: form.email || undefined,
        phone: form.phone || undefined,
        password: form.password,
        role: form.role,
        districtId: form.districtId || null,
        branchId: form.branchId || null,
        departmentId: form.departmentId || null,
      });
      notify.success(notifications.user.created);
      setForm({ ...emptyForm, role: form.role });
      setUsernameTouched(false);
      close();
      await loadAll();
    } catch (err) {
      setFormError(notify.formError(err, notifications.user.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(user: SafeUser) {
    setEditingId(user.id);
    setEditForm({
      name: user.name,
      email: user.email ?? "",
      phone: user.phone ?? "",
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
    if (!editForm.email.trim()) {
      setEditError("Email address is required");
      setRowBusy(null);
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        name: editForm.name,
        email: editForm.email.trim(),
        phone: editForm.phone.trim() || null,
        role: editForm.role,
        districtId: editForm.districtId || null,
        branchId: editForm.branchId || null,
        departmentId: editForm.departmentId || null,
      };
      if (editForm.password) payload.password = editForm.password;
      await apiSend(`/api/admin/users/${user.id}`, "PATCH", payload);
      notify.success(notifications.user.updated);
      setEditingId(null);
      await loadAll();
    } catch (err) {
      setEditError(notify.formError(err, notifications.user.updateFailed));
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
      notify.success(user.status === "ACTIVE" ? notifications.user.deactivated : notifications.user.activated);
      await loadAll();
    } catch (err) {
      notify.fromError(err, notifications.user.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteUser(user: SafeUser) {
    const result = await confirm({
      title: "Permanently delete user?",
      message: `This removes "${user.name}" (${user.username}) entirely - unlike deactivating, this cannot be undone. Only allowed if this account has never registered, reviewed, rectified, transferred, closed, uploaded evidence for, or commented on anything.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(user.id);
    try {
      await apiSend(`/api/admin/users/${user.id}`, "DELETE");
      notify.success(notifications.user.deleted);
      await loadAll();
    } catch (err) {
      notify.fromError(err, notifications.user.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

  const isBranchScoped = selectedRole?.orgScope === "BRANCH";
  const isDistrictScoped = selectedRole?.orgScope === "DISTRICT";
  const editIsBranchScoped = editSelectedRole?.orgScope === "BRANCH";
  const editIsDistrictScoped = editSelectedRole?.orgScope === "DISTRICT";

  const editingUser = users.find((u) => u.id === editingId) ?? null;

  const columns = useMemo<MRT_ColumnDef<SafeUser>[]>(
    () => [
      { accessorKey: "name", header: "Name", Cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span> },
      {
        accessorKey: "username",
        header: "User Name",
        Cell: ({ row }) => <span className="font-mono text-xs text-slate-600">{row.original.username}</span>,
      },
      { id: "email", header: "Email", accessorFn: (u) => u.email || "—" },
      { id: "phone", header: "Phone", accessorFn: (u) => u.phone || "—" },
      { id: "role", header: "Role", accessorFn: (u) => roleName(u.role), filterVariant: "select" },
      {
        id: "orgUnit",
        header: "Org Unit",
        accessorFn: (u) => (u.branchId ? branchName(u.branchId) : u.districtId ? districtName(u.districtId) : "Bank-wide"),
        filterVariant: "select",
      },
      { id: "department", header: "Department", accessorFn: (u) => departmentName(u.departmentId), filterVariant: "select" },
      {
        accessorKey: "status",
        header: "Status",
        size: 110,
        filterVariant: "select",
        filterSelectOptions: [
          { value: "ACTIVE", label: "Active" },
          { value: "INACTIVE", label: "Inactive" },
        ],
        Cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "lastLogin",
        header: "Last Login",
        accessorFn: (u) => u.lastLoginAt ?? "",
        meta: { exportValue: (u: SafeUser) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never") },
        Cell: ({ row }) => <span className="text-xs text-slate-500">{row.original.lastLoginAt ? formatDateTime(row.original.lastLoginAt) : "Never"}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roles, districts, branches, departments]
  );

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Users</h1>
      <p className="mt-1 text-sm text-slate-600">
        Create, edit, deactivate/reactivate users and assign role + organization unit. Branch-scoped roles marked
        &quot;one active user per branch&quot; (in Roles &amp; Permissions) can only be held by one active person per
        branch at a time.
      </p>
      {rolesError && <p className="mt-2 text-sm text-amber-700">{rolesError}</p>}

      <Card className="mt-5">
        <CardHeader title="All Users" description={`${users.length} total`}
          action={canCreate && (
            <AddDialog size="xl" title="Add User">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="name">Full name</Label>
                  <RuleInput id="name" required maxLength={LIMITS.personName.max} check={(v) => personNameError(v)} filter={INPUT_FILTERS.personName} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    required
                    maxLength={USERNAME_MAX_LENGTH}
                    autoComplete="off"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: INPUT_FILTERS.username(e.target.value) })}
                    onBlur={() => setUsernameTouched(true)}
                    aria-invalid={usernameTouched && newUsernameError ? true : undefined}
                    aria-describedby="username-rule"
                    className={usernameTouched && newUsernameError ? "border-red-400" : undefined}
                  />
                  <p id="username-rule" className={`mt-1 text-xs ${usernameTouched && newUsernameError ? "text-red-600" : "text-slate-500"}`}>
                    {usernameTouched && newUsernameError ? `${newUsernameError}.` : USERNAME_RULE_TEXT}
                  </p>
                </div>
                <div>
                  <Label htmlFor="email">Email <span className="font-normal text-red-600" aria-hidden="true">*</span></Label>
                  <RuleInput
                    id="email"
                    type="email"
                    required
                    maxLength={LIMITS.email.max}
                    check={(v) => emailError(v)}
                    placeholder="someone@nibbank.com.et"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <RuleInput
                    id="phone"
                    type="tel"
                    maxLength={20}
                    check={(v) => phoneError(v)}
                    filter={INPUT_FILTERS.phone}
                    inputMode="tel"
                    hint="Optional. e.g. 0911 234 567 or +251 911 234 567"
                    placeholder="+251..."
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="password">Temporary password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    aria-describedby="password-rules"
                  />
                  <PasswordRules password={form.password} id="password-rules" />
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

                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !form.role || !!personNameError(form.name) || !!emailError(form.email) || !!phoneError(form.phone) || !!newUsernameError || !newPasswordValid}>
                    {submitting ? "Creating..." : "Create User"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <AdminTable
          columns={columns}
          data={users}
          isLoading={loading}
          getRowId={(u) => u.id}
          exportFileName="users"
          emptyText="No users yet."
          toolbarActions={
            canCreate && roles.length > 0 && (
              <ImportCsvDialog
                entityLabel="users"
                templateName="users-import"
                columns={[
                  { key: "username", required: true, example: "abebe.k", help: USERNAME_RULE_TEXT },
                  { key: "name", required: true, example: "Abebe Kebede", help: "Full name" },
                  { key: "email", required: true, example: "abebe.k@nibbank.com.et", help: "Work email (used for password reset)" },
                  { key: "phone", example: "+251911000000", help: "Optional" },
                  { key: "role", required: true, example: "BRANCH_MANAGER", help: "Role code (see Roles & Permissions)" },
                  { key: "district", example: "AA", help: "District code or exact name - for district-level roles" },
                  { key: "branch", example: "BOLE", help: "Branch code or exact name - for branch-level roles (district is taken from it)" },
                  { key: "department", example: "OPS", help: "Optional department code or exact name" },
                  {
                    key: "temporary_password",
                    required: true,
                    example: "Temp#2026-Abebe",
                    help: "Must meet the password policy. The user must change it at first sign-in and it expires in 24 hours. Never written to the results file - delete the CSV after importing.",
                    sensitive: true,
                  },
                ]}
                toPayload={(row) => {
                  const label = row.username || row.name || "(blank)";
                  if (!row.username || !row.name || !row.email || !row.role || !row.temporary_password) {
                    return { error: "username, name, email, role and temporary_password are required", label };
                  }
                  const badField = usernameError(row.username.trim()) || personNameError(row.name) || emailError(row.email) || phoneError(row.phone);
                  if (badField) return { error: badField, label };
                  const weak = validatePasswordStrength(row.temporary_password);
                  if (!weak.valid) return { error: weak.error ?? "Password doesn't meet the password policy", label };
                  const match = <T extends { id: string; code?: string; name: string }>(list: T[], v: string) =>
                    list.find((x) => x.code?.toLowerCase() === v.toLowerCase() || x.name.toLowerCase() === v.toLowerCase());
                  const role = roles.find((r) => r.code.toLowerCase() === row.role.toLowerCase());
                  if (!role) return { error: `Unknown role "${row.role}"`, label };
                  const branch = row.branch ? match(branches, row.branch) : undefined;
                  if (row.branch && !branch) return { error: `Unknown branch "${row.branch}"`, label };
                  const district = row.district ? match(districts, row.district) : undefined;
                  if (row.district && !district) return { error: `Unknown district "${row.district}"`, label };
                  const department = row.department ? match(departments, row.department) : undefined;
                  if (row.department && !department) return { error: `Unknown or inactive department "${row.department}"`, label };
                  return {
                    label,
                    payload: {
                      username: row.username.trim(),
                      name: row.name,
                      email: row.email,
                      phone: row.phone || undefined,
                      role: role.code,
                      password: row.temporary_password,
                      branchId: branch?.id ?? null,
                      districtId: branch?.districtId ?? district?.id ?? null,
                      departmentId: department?.id ?? null,
                    },
                  };
                }}
                submit={(payload) => apiSend("/api/admin/users", "POST", payload)}
                onDone={loadAll}
              />
            )
          }
          renderRowActions={(u) => (
            <RowActions>
              {canEdit && (
                <RowAction
                  kind="edit"
                  disabled={editingId === u.id}
                  title={editingId === u.id ? "Already editing - use Save Changes or Cancel below" : "Edit"}
                  onClick={() => startEdit(u)}
                />
              )}
              {canToggle && <StatusToggleAction active={u.status === "ACTIVE"} busy={rowBusy === u.id} onClick={() => toggleStatus(u)} />}
              {canDelete && <RowAction kind="delete" busy={rowBusy === u.id} onClick={() => deleteUser(u)} />}
            </RowActions>
          )}
        />
        {/* The editor opens in a dialog (portalled out of the table), like Add. */}
        {editingUser && (
        <Modal title={`Edit ${editingUser.name}`} description={editingUser.username} size="xl" onClose={() => setEditingId(null)}>
          <form
            className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit(editingUser);
            }}
        >
            <div>
              <Label htmlFor="edit-name">Full name</Label>
              <RuleInput
                id="edit-name"
                maxLength={LIMITS.personName.max}
                check={(v) => personNameError(v)} filter={INPUT_FILTERS.personName}
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-email">Email <span className="font-normal text-red-600" aria-hidden="true">*</span></Label>
              <RuleInput
                id="edit-email"
                type="email"
                required
                maxLength={LIMITS.email.max}
                check={(v) => emailError(v)}
                placeholder="someone@nibbank.com.et"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit-phone">Phone</Label>
              <RuleInput
                id="edit-phone"
                type="tel"
                maxLength={20}
                check={(v) => phoneError(v)}
                  filter={INPUT_FILTERS.phone}
                  inputMode="tel"
                placeholder="+251..."
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
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
                autoComplete="new-password"
                placeholder="Leave blank to keep current"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                aria-describedby="edit-password-rules"
              />
              <PasswordRules password={editForm.password} id="edit-password-rules" />
            </div>
            <StickyActions error={editError}>
              <Button type="button" variant="cancel" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button
                disabled={
                  rowBusy === editingUser.id ||
                  !!personNameError(editForm.name) ||
                  !!emailError(editForm.email) ||
                  !!phoneError(editForm.phone) ||
                  (!!editForm.password && !validatePasswordStrength(editForm.password).valid)
                }
                type="submit"
              >
                {rowBusy === editingUser.id ? "Saving..." : "Save Changes"}
              </Button>
            </StickyActions>
          </form>
        </Modal>
        )}
      </Card>
      {dialog}
    </div>
  );
}
