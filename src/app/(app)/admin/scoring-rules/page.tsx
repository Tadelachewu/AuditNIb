"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import type { ScoringRule, ClassifiedCategory, Source } from "@/types";

const emptyForm = {
  name: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  categories: [] as string[],
  sources: [] as string[],
  basis: "Rectified eligible Other Cases ÷ Total eligible Other Cases × 100",
  formulaType: "PERCENTAGE",
  activateNow: true,
};

export default function ScoringRulesPage() {
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [categories, setCategories] = useState<ClassifiedCategory[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [r, c, s] = await Promise.all([
      apiGet<{ scoringRules: ScoringRule[] }>("/api/admin/scoring-rules"),
      apiGet<{ categories: ClassifiedCategory[] }>("/api/admin/categories"),
      apiGet<{ sources: Source[] }>("/api/admin/sources"),
    ]);
    setRules(r.scoringRules);
    setCategories(c.categories);
    setSources(s.sources);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function toggleMulti(field: "categories" | "sources", id: string) {
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id],
    }));
  }

  function nameFor(list: { id: string; name: string }[], id: string) {
    return list.find((x) => x.id === id)?.name ?? id;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await apiSend("/api/admin/scoring-rules", "POST", form);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create scoring rule");
    } finally {
      setSubmitting(false);
    }
  }

  async function setActive(rule: ScoringRule, active: boolean) {
    setRowBusy(rule.id);
    try {
      await apiSend(`/api/admin/scoring-rules/${rule.id}`, "PATCH", { active });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to update scoring rule");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Scoring Rules</h1>
      <p className="mt-1 text-sm text-slate-500">
        Versioned and admin-only. Creating a rule never edits a past version — it adds a new one, so historical
        periods keep reconciling against the rule that was live when they ran. Only one rule can be active at a
        time.
      </p>

      <Card className="mt-5">
        <CardHeader title="New Scoring Rule Version" />
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="effectiveFrom">Effective from</Label>
              <Input
                id="effectiveFrom"
                type="date"
                required
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>Included categories</Label>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => toggleMulti("categories", c.id)}
                  className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                    form.categories.includes(c.id)
                      ? "bg-blue-900 text-white ring-blue-900"
                      : "bg-white text-slate-600 ring-slate-300"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Included sources</Label>
            <div className="flex flex-wrap gap-2">
              {sources.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggleMulti("sources", s.id)}
                  className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                    form.sources.includes(s.id)
                      ? "bg-blue-900 text-white ring-blue-900"
                      : "bg-white text-slate-600 ring-slate-300"
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="basis">Calculation basis</Label>
            <Input id="basis" required value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })} />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="activateNow"
              type="checkbox"
              checked={form.activateNow}
              onChange={(e) => setForm({ ...form, activateNow: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="activateNow">Activate immediately (deactivates the current rule)</Label>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Create Version"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Rule History" description={`${rules.length} version(s)`} />
        <div className="divide-y divide-slate-100">
          {loading && <p className="px-4 py-4 text-sm text-slate-400">Loading...</p>}
          {!loading &&
            rules.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-slate-900">
                      v{r.version} — {r.name}
                    </span>
                    {r.active && <Badge tone="green">Active</Badge>}
                  </div>
                  <Button
                    variant={r.active ? "secondary" : "primary"}
                    disabled={rowBusy === r.id}
                    onClick={() => setActive(r, !r.active)}
                  >
                    {r.active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
                <p className="mt-1 text-xs text-slate-500">{r.basis}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Effective {new Date(r.effectiveFrom).toLocaleDateString()} · Categories:{" "}
                  {r.categories.map((id) => nameFor(categories, id)).join(", ") || "—"} · Sources:{" "}
                  {r.sources.map((id) => nameFor(sources, id)).join(", ") || "—"}
                </p>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
