"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { Source } from "@/types";

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function load() {
    setLoading(true);
    const res = await apiGet<{ sources: Source[] }>("/api/admin/sources");
    setSources(res.sources);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/sources", "POST", form);
      setForm({ code: "", name: "" });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create source");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(s: Source) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditError(null);
  }

  async function saveEdit(s: Source) {
    setRowBusy(s.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "PATCH", { name: editName });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteSource(s: Source) {
    const result = await confirm({
      title: "Permanently delete source?",
      message: `This removes "${s.name}" entirely - unlike deactivating, this cannot be undone. Only allowed if no scoring rule still references it.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(s.id);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "DELETE");
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete source");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(s: Source) {
    if (s.active) {
      const result = await confirm({
        title: "Deactivate source?",
        message: `"${s.name}" will no longer be selectable when registering new findings. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(s.id);
    try {
      await apiSend(`/api/admin/sources/${s.id}`, "PATCH", { active: !s.active });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update source");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Finding Sources</h1>
      <p className="mt-1 text-sm text-slate-500">Internal Control, Internal Audit, and future configurable sources.</p>

      <Card className="mt-5">
        <CardHeader title="Add Source" />
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
              {submitting ? "Adding..." : "Add Source"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Sources" description={`${sources.length} total`} />
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
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={4}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                sources.map((s) => {
                  const isEditing = editingId === s.id;
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2 font-mono text-xs text-slate-600">{s.code}</td>
                      <td className="px-4 py-2 font-medium text-slate-900">
                        {isEditing ? (
                          <>
                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-56" />
                            {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
                          </>
                        ) : (
                          s.name
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={s.active ? "green" : "gray"}>{s.active ? "Active" : "Inactive"}</Badge>
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                            <Button disabled={rowBusy === s.id} onClick={() => saveEdit(s)}>
                              {rowBusy === s.id ? "Saving..." : "Save"}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => startEdit(s)}>
                              Edit
                            </Button>
                            <Button
                              variant={s.active ? "danger" : "secondary"}
                              disabled={rowBusy === s.id}
                              onClick={() => toggleActive(s)}
                            >
                              {s.active ? "Deactivate" : "Activate"}
                            </Button>
                            <Button variant="danger" disabled={rowBusy === s.id} onClick={() => deleteSource(s)}>
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
    </div>
  );
}
