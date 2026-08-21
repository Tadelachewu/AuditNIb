"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import type { Source } from "@/types";

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

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

  async function toggleActive(s: Source) {
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
                sources.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{s.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{s.name}</td>
                    <td className="px-4 py-2">
                      <Badge tone={s.active ? "green" : "gray"}>{s.active ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant={s.active ? "danger" : "secondary"}
                        disabled={rowBusy === s.id}
                        onClick={() => toggleActive(s)}
                      >
                        {s.active ? "Deactivate" : "Activate"}
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
