"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { StatusBadge, Badge } from "@/components/ui/Badge";
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

  async function toggleStatus(b: BranchRow) {
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
                branches.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{b.code}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{b.name}</td>
                    <td className="px-4 py-2 text-slate-600">{districtName(b.districtId)}</td>
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
                      <Button
                        variant={b.status === "ACTIVE" ? "danger" : "secondary"}
                        disabled={rowBusy === b.id}
                        onClick={() => toggleStatus(b)}
                      >
                        {b.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
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
