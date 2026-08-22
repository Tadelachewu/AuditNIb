"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { District, Branch } from "@/types";

type BranchRow = Branch & { managerName: string | null; controllerName: string | null };

export default function BranchesPage() {
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "", districtId: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", districtId: "" });
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function load() {
    setLoading(true);
    const [b, d] = await Promise.all([
      apiGet<{ branches: BranchRow[] }>("/api/admin/branches"),
      apiGet<{ districts: District[] }>("/api/admin/districts"),
    ]);
    setBranches(b.branches);
    setDistricts(d.districts);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function districtName(id: string) {
    return districts.find((d) => d.id === id)?.name ?? "—";
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/branches", "POST", form);
      setForm({ code: "", name: "", districtId: "" });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create branch");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(b: BranchRow) {
    setEditingId(b.id);
    setEditForm({ name: b.name, districtId: b.districtId });
    setEditError(null);
  }

  async function saveEdit(b: BranchRow) {
    setRowBusy(b.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/branches/${b.id}`, "PATCH", editForm);
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleStatus(b: BranchRow) {
    if (b.status === "ACTIVE") {
      const result = await confirm({
        title: "Deactivate branch?",
        message: `"${b.name}" will no longer be selectable for new findings or user assignments. Its current Manager/Controller stay assigned. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(b.id);
    try {
      await apiSend(`/api/admin/branches/${b.id}`, "PATCH", { status: b.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update branch");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Branches</h1>
      <p className="mt-1 text-sm text-slate-500">
        Linked to a district. Manager and Internal Controller are assigned from the Users page.
      </p>

      <Card className="mt-5">
        <CardHeader title="Add Branch" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="code">Code</Label>
            <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="districtId">District</Label>
            <Select
              id="districtId"
              required
              value={form.districtId}
              onChange={(e) => setForm({ ...form, districtId: e.target.value })}
            >
              <option value="">Select district</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-3">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add Branch"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Branches" description={`${branches.length} total`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">District</th>
                <th className="px-4 py-2 font-medium">Manager</th>
                <th className="px-4 py-2 font-medium">Controller</th>
                <th className="px-4 py-2 font-medium">Status</th>
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
                branches.map((b) => {
                  const isEditing = editingId === b.id;
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">{b.code}</td>
                      <td className="px-4 py-2 font-medium text-slate-900">
                        {isEditing ? (
                          <Input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="max-w-48"
                          />
                        ) : (
                          b.name
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {isEditing ? (
                          <Select
                            value={editForm.districtId}
                            onChange={(e) => setEditForm({ ...editForm, districtId: e.target.value })}
                          >
                            {districts.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          districtName(b.districtId)
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {b.managerName ? b.managerName : <Badge tone="amber">Unassigned</Badge>}
                      </td>
                      <td className="px-4 py-2">
                        {b.controllerName ? b.controllerName : <Badge tone="amber">Unassigned</Badge>}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isEditing ? (
                          <div className="flex flex-col items-end gap-1">
                            {editError && <p className="text-xs text-red-600">{editError}</p>}
                            <div className="flex justify-end gap-2">
                              <Button variant="secondary" onClick={() => setEditingId(null)}>
                                Cancel
                              </Button>
                              <Button disabled={rowBusy === b.id} onClick={() => saveEdit(b)}>
                                {rowBusy === b.id ? "Saving..." : "Save"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => startEdit(b)}>
                              Edit
                            </Button>
                            <Button
                              variant={b.status === "ACTIVE" ? "danger" : "secondary"}
                              disabled={rowBusy === b.id}
                              onClick={() => toggleStatus(b)}
                            >
                              {b.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
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
