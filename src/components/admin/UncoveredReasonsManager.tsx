"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { UncoveredReason } from "@/types";

// Same convention as SourcesManager: the list is a prop refreshed via
// router.refresh() after every mutation, not a duplicated client copy -
// only genuinely ephemeral UI state (the add-form draft, which row is mid-
// edit, per-row busy flags) lives here.
export function UncoveredReasonsManager({ initialReasons }: { initialReasons: UncoveredReason[] }) {
  const reasons = initialReasons;
  const router = useRouter();
  const [form, setForm] = useState({ code: "", name: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/uncovered-reasons", "POST", form);
      setForm({ code: "", name: "" });
      router.refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create reason");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(r: UncoveredReason) {
    setEditingId(r.id);
    setEditName(r.name);
    setEditError(null);
  }

  async function saveEdit(r: UncoveredReason) {
    setRowBusy(r.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/uncovered-reasons/${r.id}`, "PATCH", { name: editName });
      setEditingId(null);
      router.refresh();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteReason(r: UncoveredReason) {
    const result = await confirm({
      title: "Permanently delete reason?",
      message: `This removes "${r.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no coverage note still references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(r.id);
    try {
      await apiSend(`/api/admin/uncovered-reasons/${r.id}`, "DELETE");
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete reason");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(r: UncoveredReason) {
    if (r.active) {
      const result = await confirm({
        title: "Deactivate reason?",
        message: `"${r.name}" will no longer be offered when recording why a branch went uncovered. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(r.id);
    try {
      await apiSend(`/api/admin/uncovered-reasons/${r.id}`, "PATCH", { active: !r.active });
      router.refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update reason");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      <Card className="mt-5">
        <CardHeader title="Add Reason" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="code">Code</Label>
            <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add Reason"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Reasons" description={`${reasons.length} total - reporters can always type their own via "Other" instead`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reasons.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {isEditing ? (
                        <>
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-56" />
                          {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
                        </>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={r.active ? "green" : "gray"}>{r.active ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <Button disabled={rowBusy === r.id} onClick={() => saveEdit(r)}>
                            {rowBusy === r.id ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => startEdit(r)}>
                            Edit
                          </Button>
                          <Button
                            variant={r.active ? "danger" : "secondary"}
                            disabled={rowBusy === r.id}
                            onClick={() => toggleActive(r)}
                          >
                            {r.active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button variant="danger" disabled={rowBusy === r.id} onClick={() => deleteReason(r)}>
                            Delete
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
    </>
  );
}
