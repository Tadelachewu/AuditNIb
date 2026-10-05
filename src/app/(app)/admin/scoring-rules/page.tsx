"use client";

import { useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/api-client";
import { useServerPager } from "@/lib/useServerList";
import { formatDate } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { Input, Label } from "@/components/ui/Field";
import { entityNameError, LIMITS } from "@/lib/inputRules";
import { RuleInput } from "@/components/ui/RuleInput";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AddDialog, Modal } from "@/components/ui/AddDialog";
import { RowAction, RowActions, StatusToggleAction } from "@/components/ui/RowActions";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import type { ScoringRule, ClassifiedCategory, Source } from "@/types";
import { notify, notifications } from "@/lib/notify";

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
  const [categories, setCategories] = useState<ClassifiedCategory[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
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
  const permissions = usePermissions();
  const canCreate = hasPermission(permissions, "scoring-rules.create");
  const canEdit = hasPermission(permissions, "scoring-rules.edit");
  const canDelete = hasPermission(permissions, "scoring-rules.delete");
  const canActivate = hasPermission(permissions, "scoring-rules.activate");
  // Server-paged rule history (newest version first).
  const pager = useServerPager<ScoringRule>("/api/admin/scoring-rules", "scoringRules");
  const rules = pager.pageItems;
  const loading = pager.loading;
  const activeRule = (pager.meta.activeRule as ScoringRule | null | undefined) ?? null;
  const maxVersion = (pager.meta.maxVersion as number | undefined) ?? 0;
  const load = pager.reload;

  // The category / source pickers need the whole lists.
  useEffect(() => {
    void Promise.all([
      apiGet<{ categories: ClassifiedCategory[] }>("/api/admin/categories"),
      apiGet<{ sources: Source[] }>("/api/admin/sources"),
    ]).then(([c, s]) => {
      setCategories(c.categories);
      setSources(s.sources);
    });
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

  async function handleCreate(e: React.FormEvent, close: () => void) {
    e.preventDefault();
    setFormError(null);

    if (form.activateNow) {
      const currentlyActive = activeRule;
      const result = await confirm({
        title: "Activate this rule immediately?",
        message: currentlyActive
          ? `This creates v${maxVersion + 1} and makes it the live scoring rule, replacing "v${currentlyActive.version} — ${currentlyActive.name}". Performance figures calculated from this point on will use the new rule.`
          : "This creates the rule and makes it the live scoring rule immediately.",
        confirmLabel: "Create & Activate",
        tone: "danger",
      });
      if (result === false) return;
    }

    setSubmitting(true);
    try {
      await apiSend("/api/admin/scoring-rules", "POST", form);
      notify.success(notifications.scoringRule.created);
      setForm(emptyForm);
      close();
      setBasisEditedManually(false);
      await load();
    } catch (err) {
      setFormError(notify.formError(err, notifications.scoringRule.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  const editingRule = rules.find((x) => x.id === editingRuleId) ?? null;

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
    if (rule.active) {
      const ok = await confirm({
        title: "Change the active scoring rule?",
        message: `"v${rule.version} — ${rule.name}" is the active rule. Saving changes every Performance % in the system straight away, for all periods. The audit log keeps the previous version.`,
        confirmLabel: "Save Changes",
      });
      if (ok === false) return;
    }
    setRowBusy(rule.id);
    setEditError(null);
    try {
      await apiSend(`/api/admin/scoring-rules/${rule.id}`, "PATCH", editDraft);
      notify.success(notifications.scoringRule.updated);
      setEditingRuleId(null);
      await load();
    } catch (err) {
      setEditError(notify.formError(err, notifications.scoringRule.updateFailed));
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteRule(rule: ScoringRule) {
    const result = await confirm({
      title: "Delete this scoring rule version?",
      message: rule.everActivated
        ? `"v${rule.version} — ${rule.name}" was active before. It is not active now, so deleting it doesn't change any Performance % (always calculated from the active rule). The audit log keeps a copy. This cannot be undone.`
        : `"v${rule.version} — ${rule.name}" has never gone live, so deleting it doesn't affect any figures. This cannot be undone.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setRowBusy(rule.id);
    try {
      await apiSend(`/api/admin/scoring-rules/${rule.id}`, "DELETE");
      notify.success(notifications.scoringRule.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.scoringRule.deleteFailed);
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
      notify.success(active ? notifications.scoringRule.activated : notifications.scoringRule.deactivated);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.scoringRule.statusFailed);
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">Scoring Rules</h1>
      <p className="mt-1 text-sm text-slate-600">
        Versioned and admin-only. Creating a rule never edits a past version — it adds a new one, so historical
        periods keep reconciling against the rule that was live when they ran. Only one rule can be active at a
        time.
      </p>

      <Card className="mt-5">
        <CardHeader title="Rule History" description={`${pager.total} version(s)`}
          action={canCreate && (
            <AddDialog title="New Scoring Rule Version">
              {({ close }) => (
              <form onSubmit={(e) => handleCreate(e, close)} className="grid grid-cols-1 gap-4 p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="name">Name</Label>
                    <RuleInput id="name" required maxLength={LIMITS.entityName.max} check={(v) => entityNameError(v)} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
                            ? "bg-[#1e3a8a] text-on-dark ring-[#1e3a8a]"
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
                            ? "bg-[#1e3a8a] text-on-dark ring-[#1e3a8a]"
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
                  <p className="mt-1 text-xs text-slate-500">
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

                <StickyActions error={formError}>
                  <Button type="button" variant="cancel" onClick={close}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting || !!entityNameError(form.name)}>
                    {submitting ? "Saving..." : "Create Version"}
                  </Button>
                </StickyActions>
              </form>
              )}
            </AddDialog>
          )}
        />
        <div className="divide-y divide-slate-100">
          {loading && <ListSkeleton rows={4} />}
          {!loading &&
            pager.pageItems.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium text-slate-900">
                      v{r.version} — {r.name}
                    </span>{" "}
                    {r.active && <Badge tone="green">Active</Badge>}
                    {!r.everActivated && <Badge tone="gray">Draft — never activated</Badge>}
                  </div>
                  <RowActions>
                    {canEdit && <RowAction kind="edit" disabled={rowBusy === r.id} onClick={() => startEditRule(r)} />}
                    {canActivate && (
                      <StatusToggleAction active={r.active} busy={rowBusy === r.id} onClick={() => setActive(r, !r.active)} />
                    )}
                    {canDelete && (
                      <RowAction
                        kind="delete"
                        busy={rowBusy === r.id}
                        disabled={r.active}
                        title={r.active ? "The active rule can't be deleted - activate another version (or deactivate this one) first" : "Delete"}
                        onClick={() => deleteRule(r)}
                      />
                    )}
                  </RowActions>
                </div>

                  <>
                    <p className="mt-1 text-xs text-slate-500">{r.basis}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Effective {formatDate(r.effectiveFrom)} · Categories:{" "}
                      {r.categories.map((id) => nameFor(categories, id)).join(", ") || "—"} · Sources:{" "}
                      {r.sources.map((id) => nameFor(sources, id)).join(", ") || "—"}
                    </p>
                  </>
              </div>
            ))}
        </div>
        <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} pageSize={pager.pageSize} onPageChange={pager.setPage} />
      </Card>
      {editingRule && (
        <Modal title={`Edit ${editingRule.name}`} description={`v${editingRule.version}`} onClose={() => setEditingRuleId(null)}>
          <form
            className="grid grid-cols-1 gap-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void saveRuleEdit(editingRule);
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`edit-name-${editingRule.id}`}>Name</Label>
                <RuleInput
                  id={`edit-name-${editingRule.id}`}
                  maxLength={LIMITS.entityName.max}
                  check={(v) => entityNameError(v)}
                  value={editDraft.name}
                  onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`edit-effectiveFrom-${editingRule.id}`}>Effective from</Label>
                <Input
                  id={`edit-effectiveFrom-${editingRule.id}`}
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
                      editDraft.categories.includes(c.id) ? "bg-[#1e3a8a] text-on-dark ring-[#1e3a8a]" : "bg-white text-slate-600 ring-slate-300"
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
                      editDraft.sources.includes(s.id) ? "bg-[#1e3a8a] text-on-dark ring-[#1e3a8a]" : "bg-white text-slate-600 ring-slate-300"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor={`edit-basis-${editingRule.id}`}>Calculation basis</Label>
              <Input
                id={`edit-basis-${editingRule.id}`}
                value={editDraft.basis}
                onChange={(e) => {
                  setEditBasisEditedManually(true);
                  setEditDraft({ ...editDraft, basis: e.target.value });
                }}
              />
              <p className="mt-1 text-xs text-slate-500">
                Auto-fills from the categories selected above - edit it directly to override.
              </p>
            </div>
            <StickyActions error={editError}>
              <Button type="button" variant="cancel" onClick={() => setEditingRuleId(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={rowBusy === editingRule.id || !!entityNameError(editDraft.name)}>
                {rowBusy === editingRule.id ? "Saving..." : "Save Changes"}
              </Button>
            </StickyActions>
          </form>
        </Modal>
      )}
      {dialog}
    </div>
  );
}
