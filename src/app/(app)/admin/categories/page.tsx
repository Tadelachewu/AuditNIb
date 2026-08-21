"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import type { ClassifiedCategory } from "@/types";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<ClassifiedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: "", name: "", scored: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await apiGet<{ categories: ClassifiedCategory[] }>("/api/admin/categories");
    setCategories(res.categories);
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
      await apiSend("/api/admin/categories", "POST", form);
      setForm({ code: "", name: "", scored: false });
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create category");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(c: ClassifiedCategory) {
    setRowBusy(c.id);
    try {
      await apiSend(`/api/admin/categories/${c.id}`, "PATCH", { active: !c.active });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update category");
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleScored(c: ClassifiedCategory) {
    setRowBusy(c.id);
    try {
      await apiSend(`/api/admin/categories/${c.id}`, "PATCH", { scored: !c.scored });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update category");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Classified Case Categories</h1>
      <p className="mt-1 text-sm text-slate-500">
        Only categories marked <strong>Scored</strong> are included in the performance calculation; the rest stay
        visible for general reporting.
      </p>

      <Card className="mt-5">
        <CardHeader title="Add Category" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4 sm:items-end">
          <div>
            <Label htmlFor="code">Code</Label>
            <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 pb-1.5">
            <input
              id="scored"
              type="checkbox"
              checked={form.scored}
              onChange={(e) => setForm({ ...form, scored: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="scored">Scored category</Label>
          </div>
          <div className="sm:col-span-4">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add Category"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="All Categories" description={`${categories.length} total`} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Scored</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={5}>
                    Loading...
                  </td>
                </tr>
              )}
              {!loading &&
                categories.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{c.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{c.name}</td>
                    <td className="px-4 py-2">
                      <button onClick={() => toggleScored(c)} disabled={rowBusy === c.id}>
                        <Badge tone={c.scored ? "blue" : "gray"}>{c.scored ? "Scored" : "Informational"}</Badge>
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={c.active ? "green" : "gray"}>{c.active ? "Active" : "Inactive"}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant={c.active ? "danger" : "secondary"}
                        disabled={rowBusy === c.id}
                        onClick={() => toggleActive(c)}
                      >
                        {c.active ? "Deactivate" : "Activate"}
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
