"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend, ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ScoringRule, ClassifiedCategory, Source } from "@/types";

const emptyForm = {
  name: "",
  effectiveFrom: new Date().toISOString().slice(0, 10),
  categories: [] as string[],
  sources: [] as string[],
  basis: generateBasisText([]),
  formulaType: "PERCENTAGE",
  activateNow: true,
};

// Document_3 §20's formula, generalized to whichever categories are
// actually selected - "Other Case" was only ever the *seeded* eligible
// category, never something to hard-code into the label. Regenerated
// live as categories are toggled, so the displayed basis never drifts
// from what's actually configured (that drift - the field silently
// keeping its "...Other Cases..." default text even after different
// categories were picked - was the actual bug being reported).
function generateBasisText(categoryNames: string[]): string {
  const label = categoryNames.length > 0 ? `eligible ${categoryNames.join("/")} cases` : "eligible cases";
  return `Rectified ${label} ÷ Total ${label} × 100`;
}

export default function ScoringRulesPage() {
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [categories, setCategories] = useState<ClassifiedCategory[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: "", effectiveFrom: "", categories: [] as string[], sources: [] as string[], basis: "" });
  const [editError, setEditError] = useState<string | null>(null);
  // Once the admin types into "Calculation basis" directly, stop
  // overwriting it when categories change - a manual override is
  // respected, not fought.
  const [basisEditedManually, setBasisEditedManually] = useState(false);
  const [editBasisEditedManually, setEditBasisEditedManually] = useState(false);
  const { confirm, dialog } = useConfirm();

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
    setForm((f) => {
      const nextValues = f[field].includes(id) ? f[field].filter((x) => x !== id) : [...f[field], id];
      const next = { ...f, [field]: nextValues };
      if (field === "categories" && !basisEditedManually) {
        next.basis = generateBasisText(nextValues.map((cid) => nameFor(categories, cid)));
      }
      return next;
    });
  }

  function nameFor(list: { id: string; name: string }[], id: string) {
    return list.find((x) => x.id === id)?.name ?? id;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (form.activateNow) {
      const currentlyActive = rules.find((r) => r.active);
      const result = await confirm({
        title: "Activate this rule immediately?",
        message: currentlyActive
          ? `This creates v${rules.reduce((max, r) => Math.max(max, r.version), 0) + 1} and makes it the live scoring rule, replacing "v${currentlyActive.version} — ${currentlyActive.name}". Performance figures calculated from this point on will use the new rule.`
          : "This creates the rule and makes it the live scoring rule immediately.",
        confirmLabel: "Create & Activate",
        tone: "danger",
      });
      if (result === false) return;
    }

    setSubmitting(true);
    try {
      await apiSend("/api/admin/scoring-rules", "POST", form);
      setForm(emptyForm);
      setBasisEditedManually(false);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create scoring rule");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditRule(rule: ScoringRule) {
    setEditingRuleId(rule.id);
    setEditDraft({
      name: rule.name,
      effectiveFrom: rule.effectiveFrom.slice(0, 10),
      categories: rule.categories,
      sources: rule.sources,
      basis: rule.basis,
    });
    // If the saved text still matches what auto-generation would produce
    // for its own categories, it was never customized - safe to keep
    // auto-updating as categories change. If it's been hand-edited to
    // something else, respect that and stop touching it.
    setEditBasisEditedManually(rule.basis !== generateBasisText(rule.categories.map((cid) => nameFor(categories, cid))));
    setEditError(null);
  }

  async function saveRuleEdit(rule: ScoringRule) {
    setRowBusy(rule.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/scoring-rules/${rule.id}`, "PATCH", editDraft);
      setEditingRuleId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Failed to update scoring rule");
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteRule(rule: ScoringRule) {
    const result = await confirm({
      title: "Delete this scoring rule version?",
      message: `"v${rule.version} — ${rule.name}" has never gone live, so deleting it doesn't affect any historical figures. This cannot be undone.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(rule.id);
    try {
      await apiSend(`/api/admin/scoring-rules/${rule.id}`, "DELETE");
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete scoring rule");
    } finally {
      setRowBusy(null);
    }
  }

  async function setActive(rule: ScoringRule, active: boolean) {
    const result = await confirm({
      title: active ? "Activate this scoring rule version?" : "Deactivate this scoring rule version?",
      message: active
        ? `"v${rule.version} — ${rule.name}" becomes the live scoring rule, replacing whichever version is currently active. Performance figures calculated from this point on will use it.`
        : `No scoring rule will be active afterward. Performance percentages will be unavailable until a rule is activated again.`,
      confirmLabel: active ? "Activate" : "Deactivate",
      tone: "danger",
    });
    if (result === false) return;

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
            <Input
              id="basis"
              required
              value={form.basis}
              onChange={(e) => {
                setBasisEditedManually(true);
                setForm({ ...form, basis: e.target.value });
              }}
            />
            <p className="mt-1 text-xs text-slate-400">
              Auto-fills from the categories selected above - edit it directly to override.
            </p>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium text-slate-900">
                      v{r.version} — {r.name}
                    </span>{" "}
                    {r.active && <Badge tone="green">Active</Badge>}
                    {!r.everActivated && <Badge tone="gray">Draft — never activated</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={r.active ? "secondary" : "primary"}
                      disabled={rowBusy === r.id}
                      onClick={() => setActive(r, !r.active)}
                    >
                      {r.active ? "Deactivate" : "Activate"}
                    </Button>
                    {!r.everActivated && (
                      <>
                        <Button
                          variant="secondary"
                          disabled={rowBusy === r.id}
                          onClick={() => (editingRuleId === r.id ? setEditingRuleId(null) : startEditRule(r))}
                        >
                          {editingRuleId === r.id ? "Cancel" : "Edit"}
                        </Button>
                        <Button variant="danger" disabled={rowBusy === r.id} onClick={() => deleteRule(r)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {editingRuleId === r.id ? (
                  <div className="mt-3 flex flex-col gap-3 rounded-md border border-slate-200 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`edit-name-${r.id}`}>Name</Label>
                        <Input
                          id={`edit-name-${r.id}`}
                          value={editDraft.name}
                          onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`edit-effectiveFrom-${r.id}`}>Effective from</Label>
                        <Input
                          id={`edit-effectiveFrom-${r.id}`}
                          type="date"
                          value={editDraft.effectiveFrom}
                          onChange={(e) => setEditDraft({ ...editDraft, effectiveFrom: e.target.value })}
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
                            onClick={() =>
                              setEditDraft((d) => {
                                const nextCategories = d.categories.includes(c.id)
                                  ? d.categories.filter((x) => x !== c.id)
                                  : [...d.categories, c.id];
                                return {
                                  ...d,
                                  categories: nextCategories,
                                  basis: editBasisEditedManually
                                    ? d.basis
                                    : generateBasisText(nextCategories.map((cid) => nameFor(categories, cid))),
                                };
                              })
                            }
                            className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                              editDraft.categories.includes(c.id) ? "bg-blue-900 text-white ring-blue-900" : "bg-white text-slate-600 ring-slate-300"
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
                            onClick={() =>
                              setEditDraft((d) => ({
                                ...d,
                                sources: d.sources.includes(s.id) ? d.sources.filter((x) => x !== s.id) : [...d.sources, s.id],
                              }))
                            }
                            className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${
                              editDraft.sources.includes(s.id) ? "bg-blue-900 text-white ring-blue-900" : "bg-white text-slate-600 ring-slate-300"
                            }`}
                          >
                            {s.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor={`edit-basis-${r.id}`}>Calculation basis</Label>
                      <Input
                        id={`edit-basis-${r.id}`}
                        value={editDraft.basis}
                        onChange={(e) => {
                          setEditBasisEditedManually(true);
                          setEditDraft({ ...editDraft, basis: e.target.value });
                        }}
                      />
                      <p className="mt-1 text-xs text-slate-400">
                        Auto-fills from the categories selected above - edit it directly to override.
                      </p>
                    </div>
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div>
                      <Button disabled={rowBusy === r.id} onClick={() => saveRuleEdit(r)}>
                        {rowBusy === r.id ? "Saving..." : "Save Changes"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-1 text-xs text-slate-500">{r.basis}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Effective {formatDate(r.effectiveFrom)} · Categories:{" "}
                      {r.categories.map((id) => nameFor(categories, id)).join(", ") || "—"} · Sources:{" "}
                      {r.sources.map((id) => nameFor(sources, id)).join(", ") || "—"}
                    </p>
                  </>
                )}
              </div>
            ))}
        </div>
      </Card>
      {dialog}
    </div>
  );
}
