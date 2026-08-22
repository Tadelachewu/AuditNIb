"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { District } from "@/types";

export default function DistrictsPage() {
  const [districts, setDistricts] = useState<District[]>([]);
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
    const res = await apiGet<{ districts: District[] }>("/api/admin/districts");
    setDistricts(res.districts);
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
      await apiSend("/api/admin/districts", "POST", form);
      setForm({ code: "", name: "" });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create district");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(d: District) {
    setEditingId(d.id);
    setEditName(d.name);
    setEditError(null);
  }

  async function saveEdit(d: District) {
    setRowBusy(d.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/districts/${d.id}`, "PATCH", { name: editName });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleStatus(d: District) {
    if (d.status === "ACTIVE") {
      const result = await confirm({
        title: "Deactivate district?",
        message: `"${d.name}" and its branches will stay in the system but ${d.name} will no longer be selectable for new assignments. This can be reversed.`,
        confirmLabel: "Deactivate",
        tone: "danger",
      });
      if (result === false) return;
    }
    setRowBusy(d.id);
    try {
      await apiSend(`/api/admin/districts/${d.id}`, "PATCH", { status: d.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update district");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Districts</h1>
      <p className="mt-1 text-sm text-slate-500">Bank-wide, config-driven — no hard-coded district count.</p>

      <Card className="mt-5">
        <CardHeader title="Add District" />
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
              {submitting ? "Adding..." : "Add District"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Districts" description={`${districts.length} total`} />
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
                districts.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{d.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">
                      {editingId === d.id ? (
                        <div className="flex items-center gap-2">
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="max-w-56" />
                        </div>
                      ) : (
                        d.name
                      )}
                      {editingId === d.id && editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {editingId === d.id ? (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                          <Button disabled={rowBusy === d.id} onClick={() => saveEdit(d)}>
                            {rowBusy === d.id ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" onClick={() => startEdit(d)}>
                            Edit
                          </Button>
                          <Button
                            variant={d.status === "ACTIVE" ? "danger" : "secondary"}
                            disabled={rowBusy === d.id}
                            onClick={() => toggleStatus(d)}
                          >
                            {d.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
      {dialog}
    </div>
  );
}
