"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime, formatNumber } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label, Textarea } from "@/components/ui/Field";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import type { Source, Department, ClassifiedCategory, ReportingPeriod, District, Branch, Finding, FindingStatus } from "@/types";

interface SimilarFindingMatch {
  id: string;
  reference: string;
  title: string;
  status: FindingStatus;
  createdAt: string;
}

interface Props {
  sources: Source[];
  departments: Department[];
  categories: ClassifiedCategory[];
  periods: ReportingPeriod[];
  districts: District[];
  branches: Branch[];
  currencies: string[];
  riskLevels: string[];
  operationAreas: string[];
  priorityLevels: string[];
  irregularityTypes: string[];
  fixedDistrict?: { id: string; name: string };
  fixedBranch?: { id: string; name: string };
  // Edit mode: every field prefilled from this finding, PATCHing it in
  // place instead of POSTing a new one - the only field never offered
  // here is `reference` itself (always system-generated, and regenerated
  // server-side if branch/period change - see PATCH .../findings/[id]).
  // Rendered inline (no card/page nav) inside FindingDetailClient's own
  // "Finding Details" card.
  finding?: Finding;
  onSaved?: () => void;
  onCancel?: () => void;
}

const emptyForm = {
  title: "",
  sourceId: "",
  departmentId: "",
  periodId: "",
  districtId: "",
  branchId: "",
  findingDate: new Date().toISOString().slice(0, 10),
  operationArea: "",
  irregularityType: "",
  categoryId: "",
  amount: "",
  currency: "",
  caseCount: "1",
  riskLevel: "",
  priority: "",
  description: "",
  recommendation: "",
  rootCause: "",
  evidenceNote: "",
};

// Per plan doc §3.3: "Finding creation form: source, period, district/
// branch (auto-scoped), date, operation area, irregularity type,
// classified case, amount+currency, case count, risk level, description,
// recommendation, optional evidence." District/branch are locked (not
// shown as pickable fields) for branch-scoped roles - `fixedDistrict`/
// `fixedBranch` being set is what signals that, same convention as
// FilterBar.
export function NewFindingForm({
  sources,
  departments,
  categories,
  periods,
  districts,
  branches,
  currencies,
  riskLevels,
  operationAreas,
  priorityLevels,
  irregularityTypes,
  fixedDistrict,
  fixedBranch,
  finding,
  onSaved,
  onCancel,
}: Props) {
  const router = useRouter();
  const isEditing = Boolean(finding);
  const [form, setForm] = useState(() =>
    finding
      ? {
          title: finding.title,
          sourceId: finding.sourceId,
          departmentId: finding.departmentId,
          periodId: finding.periodId,
          districtId: finding.districtId,
          branchId: finding.branchId,
          findingDate: finding.findingDate.slice(0, 10),
          operationArea: finding.operationArea,
          irregularityType: finding.irregularityType,
          categoryId: finding.categoryId,
          amount: String(finding.amount),
          currency: finding.currency,
          caseCount: String(finding.caseCount),
          riskLevel: finding.riskLevel,
          priority: finding.priority,
          description: finding.description,
          recommendation: finding.recommendation ?? "",
          rootCause: finding.rootCause ?? "",
          evidenceNote: finding.evidenceNote ?? "",
        }
      : {
          ...emptyForm,
          districtId: fixedDistrict?.id ?? "",
          branchId: fixedBranch?.id ?? "",
          // Not auto-selected like currency/riskLevel below - which
          // department is even valid depends on district/branch, so this
          // starts unset rather than risk defaulting to one that's
          // actually out of scope.
          departmentId: "",
          currency: currencies[0] ?? "",
          riskLevel: riskLevels[0] ?? "",
          operationArea: operationAreas[0] ?? "",
          priority: priorityLevels[0] ?? "",
          irregularityType: irregularityTypes[0] ?? "",
        }
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"draft" | "submit" | null>(null);

  // Document_3 §12/§34: optional per-case breakdown instead of just a
  // total (create-only - there's no case-breakdown-edit flow yet, and an
  // already-itemized finding can't have its totals changed via edit at
  // all, so offering this toggle there would be misleading).
  const [itemizeCases, setItemizeCases] = useState(false);
  const [caseAmounts, setCaseAmounts] = useState<string[]>([]);

  function setCaseCount(value: string) {
    setForm((f) => ({ ...f, caseCount: value }));
    const n = Math.max(0, Math.min(500, Number(value) || 0));
    setCaseAmounts((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
  }

  const caseAmountsSum = caseAmounts.reduce((sum, a) => sum + (Number(a) || 0), 0);
  const caseAmountsMatch = Math.abs(caseAmountsSum - (Number(form.amount) || 0)) < 0.01;

  // Non-blocking duplicate suggestion (create mode only) - sends every
  // candidate field the form currently has a value for (see
  // SIMILAR_FINDING_FIELDS in src/types/index.ts); the API route itself
  // decides which of those actually matter, per Settings.similarFindingFields
  // (admin-configurable at /admin/settings), and only returns matches once
  // every one of the *configured* fields has a value here - so this effect
  // doesn't need to know the admin's configuration itself, just keep
  // sending what it has. Debounced since it fires on every field changing;
  // dismissible per distinct field-combination rather than globally, so
  // changing something re-checks instead of staying silently dismissed.
  const [similarMatches, setSimilarMatches] = useState<SimilarFindingMatch[]>([]);
  const [similarDismissed, setSimilarDismissed] = useState(false);
  const similarCandidates = {
    branchId: form.branchId,
    categoryId: form.categoryId,
    operationArea: form.operationArea,
    irregularityType: form.irregularityType,
    periodId: form.periodId,
    sourceId: form.sourceId,
    departmentId: form.departmentId,
    riskLevel: form.riskLevel,
  };
  const similarKey = Object.values(similarCandidates).join("|");
  useEffect(() => {
    setSimilarDismissed(false);
    if (isEditing) {
      setSimilarMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(similarCandidates)) {
        if (value) params.set(key, value);
      }
      fetch(`/api/findings/similar?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
        .then((res) => (res.ok ? res.json() : { matches: [] }))
        .then((data: { matches: SimilarFindingMatch[] }) => setSimilarMatches(data.matches ?? []))
        .catch(() => {});
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarKey, isEditing]);

  // The period list already excludes anything that can't take even a
  // DRAFT (see findings/new/page.tsx) - but a LOCKED-drafts-allowed period
  // still can't take a submit, so that half of the choice is disabled
  // here rather than hidden, with a reason shown next to the button.
  const selectedPeriod = periods.find((p) => p.id === form.periodId);
  const periodBlocksSubmit = selectedPeriod?.status === "LOCKED";

  const branchOptions = useMemo(
    () => (form.districtId ? branches.filter((b) => b.districtId === form.districtId) : branches),
    [branches, form.districtId]
  );

  // A department is selectable when it's bank-wide, or scoped to whichever
  // district/branch this finding is currently set to - same narrowing
  // relationship branchOptions has with districtId, just against
  // Department.orgScope instead of Branch.districtId.
  const departmentOptions = useMemo(
    () =>
      departments.filter(
        (d) =>
          d.orgScope === "BANK" ||
          (d.orgScope === "DISTRICT" && d.districtId === form.districtId) ||
          (d.orgScope === "BRANCH" && d.branchId === form.branchId)
      ),
    [departments, form.districtId, form.branchId]
  );

  async function save(submit: boolean) {
    setError(null);
    if (!isEditing && itemizeCases && !caseAmountsMatch) {
      setError("Case breakdown must add up to the amount involved before saving");
      return;
    }
    setSubmitting(submit ? "submit" : "draft");
    try {
      const payload = {
        title: form.title,
        sourceId: form.sourceId,
        departmentId: form.departmentId,
        periodId: form.periodId,
        districtId: fixedDistrict ? undefined : form.districtId || undefined,
        branchId: fixedBranch ? undefined : form.branchId || undefined,
        findingDate: form.findingDate,
        operationArea: form.operationArea,
        irregularityType: form.irregularityType,
        categoryId: form.categoryId,
        amount: Number(form.amount),
        currency: form.currency,
        caseCount: Number(form.caseCount),
        riskLevel: form.riskLevel,
        priority: form.priority,
        description: form.description,
        recommendation: form.recommendation || undefined,
        rootCause: form.rootCause || undefined,
        evidenceNote: form.evidenceNote || undefined,
        caseAmounts: !isEditing && itemizeCases ? caseAmounts.map((a) => Number(a) || 0) : undefined,
      };
      if (finding) {
        await apiSend<{ finding: Finding }>(`/api/findings/${finding.id}`, "PATCH", payload);
        router.refresh();
        onSaved?.();
      } else {
        const res = await apiSend<{ finding: Finding }>("/api/findings", "POST", { ...payload, submit });
        router.push(`/findings/${res.finding.id}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save finding");
    } finally {
      setSubmitting(null);
    }
  }

  const formEl = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
      className="flex flex-col gap-4"
    >
        <div>
          <Label htmlFor="title">Finding title</Label>
          <Input
            id="title"
            required
            placeholder="A short, descriptive title for this finding"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="sourceId">Source</Label>
            <Select id="sourceId" required value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })}>
              <option value="">Select source</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="departmentId">Department</Label>
            <Select
              id="departmentId"
              required
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            >
              <option value="">Select department</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-400">Bank-wide departments, plus any scoped to the district/branch below.</p>
          </div>
          <div>
            <Label htmlFor="periodId">Reporting period</Label>
            <Select id="periodId" required value={form.periodId} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
              <option value="">Select period</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                  {p.status === "LOCKED" ? " (locked - drafts only)" : ""}
                </option>
              ))}
            </Select>
          </div>

          {fixedDistrict ? (
            <div>
              <Label>District</Label>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500">
                {fixedDistrict.name}
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="districtId">District</Label>
              <Select
                id="districtId"
                required
                value={form.districtId}
                onChange={(e) => setForm({ ...form, districtId: e.target.value, branchId: "", departmentId: "" })}
              >
                <option value="">Select district</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {fixedBranch ? (
            <div>
              <Label>Branch</Label>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500">
                {fixedBranch.name}
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="branchId">Branch</Label>
              <Select id="branchId" required value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value, departmentId: "" })}>
                <option value="">Select branch</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <Label htmlFor="findingDate">Finding date</Label>
            <Input
              id="findingDate"
              type="date"
              required
              value={form.findingDate}
              onChange={(e) => setForm({ ...form, findingDate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="categoryId">Classified case</Label>
            <Select id="categoryId" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Select classified case</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="operationArea">Operation area</Label>
            <Select
              id="operationArea"
              required
              value={form.operationArea}
              onChange={(e) => setForm({ ...form, operationArea: e.target.value })}
            >
              <option value="">Select operation area</option>
              {operationAreas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="irregularityType">Type of irregularity</Label>
            <Select
              id="irregularityType"
              required
              value={form.irregularityType}
              onChange={(e) => setForm({ ...form, irregularityType: e.target.value })}
            >
              <option value="">Select irregularity type</option>
              {irregularityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="currency">Currency</Label>
            <Select id="currency" required value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="amount">Amount involved</Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="caseCount">Number of cases</Label>
            <Input
              id="caseCount"
              type="number"
              min="1"
              step="1"
              required
              value={form.caseCount}
              onChange={(e) => setCaseCount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="riskLevel">Risk level</Label>
            <Select id="riskLevel" required value={form.riskLevel} onChange={(e) => setForm({ ...form, riskLevel: e.target.value })}>
              {riskLevels.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="priority">Priority</Label>
            <Select id="priority" required value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {priorityLevels.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {!isEditing && Number(form.caseCount) > 1 && (
          <div className="rounded-md border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={itemizeCases}
                onChange={(e) => setItemizeCases(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Track individual case amounts (optional)
            </label>
            <p className="mt-1 text-xs text-slate-400">
              Lets a future rectification pick specific cases (e.g. &quot;only Case 2&quot;) instead of just a
              count/amount that happens to add up.
            </p>
            {itemizeCases && (
              <div className="mt-3 flex flex-col gap-2">
                {caseAmounts.map((value, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs text-slate-500">Case {i + 1}</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={value}
                      onChange={(e) =>
                        setCaseAmounts((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                      }
                    />
                  </div>
                ))}
                <p className={`text-xs ${caseAmountsMatch ? "text-slate-500" : "text-red-600"}`}>
                  Case total: {formatNumber(caseAmountsSum)} / Amount involved: {formatNumber(Number(form.amount) || 0)}
                  {!caseAmountsMatch && " — these must match"}
                </p>
              </div>
            )}
          </div>
        )}

        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            required
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="rootCause">Root cause (optional)</Label>
          <Textarea
            id="rootCause"
            rows={2}
            placeholder="Why did this happen? - distinct from the description of what happened"
            value={form.rootCause}
            onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="recommendation">Recommendation (optional)</Label>
          <Textarea
            id="recommendation"
            rows={2}
            value={form.recommendation}
            onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="evidenceNote">Evidence note (optional)</Label>
          <Input
            id="evidenceNote"
            placeholder="e.g. filed in branch cabinet, ref #4 - no file upload yet"
            value={form.evidenceNote}
            onChange={(e) => setForm({ ...form, evidenceNote: e.target.value })}
          />
        </div>

        {!similarDismissed && similarMatches.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-amber-900">
                {similarMatches.length} similar finding{similarMatches.length > 1 ? "s" : ""} already on record - double-check this isn&apos;t a
                duplicate before continuing.
              </p>
              <button type="button" onClick={() => setSimilarDismissed(true)} className="shrink-0 text-xs text-amber-700 hover:underline">
                Dismiss
              </button>
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {similarMatches.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-xs text-amber-800">
                  <Link href={`/findings/${m.id}`} target="_blank" className="font-medium hover:underline">
                    {m.reference}
                  </Link>
                  <span className="truncate">{m.title}</span>
                  <FindingStatusBadge status={m.status} />
                  <span className="text-amber-600">{formatDateTime(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button type="button" variant="secondary" disabled={submitting !== null} onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting !== null}>
                {submitting === "draft" ? "Saving..." : "Save Changes"}
              </Button>
            </>
          ) : (
            <>
              <Button type="submit" variant="secondary" disabled={submitting !== null}>
                {submitting === "draft" ? "Saving..." : "Save Draft"}
              </Button>
              <Button type="button" disabled={submitting !== null || periodBlocksSubmit} onClick={() => save(true)}>
                {submitting === "submit" ? "Submitting..." : "Save & Submit"}
              </Button>
              {periodBlocksSubmit && (
                <p className="self-center text-xs text-slate-500">
                  {selectedPeriod?.code} is locked - only a draft can be saved against it until it&apos;s open.
                </p>
              )}
            </>
          )}
        </div>
    </form>
  );

  return isEditing ? formEl : <Card className="mt-5 p-4">{formEl}</Card>;
}
