"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label, Textarea } from "@/components/ui/Field";
import type { Source, ClassifiedCategory, ReportingPeriod, District, Branch, Finding } from "@/types";

interface Props {
  sources: Source[];
  categories: ClassifiedCategory[];
  periods: ReportingPeriod[];
  districts: District[];
  branches: Branch[];
  currencies: string[];
  riskLevels: string[];
  fixedDistrict?: { id: string; name: string };
  fixedBranch?: { id: string; name: string };
}

const emptyForm = {
  sourceId: "",
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
  description: "",
  recommendation: "",
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
  categories,
  periods,
  districts,
  branches,
  currencies,
  riskLevels,
  fixedDistrict,
  fixedBranch,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    ...emptyForm,
    districtId: fixedDistrict?.id ?? "",
    branchId: fixedBranch?.id ?? "",
    currency: currencies[0] ?? "",
    riskLevel: riskLevels[0] ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"draft" | "submit" | null>(null);

  const branchOptions = useMemo(
    () => (form.districtId ? branches.filter((b) => b.districtId === form.districtId) : branches),
    [branches, form.districtId]
  );

  async function save(submit: boolean) {
    setError(null);
    setSubmitting(submit ? "submit" : "draft");
    try {
      const payload = {
        sourceId: form.sourceId,
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
        description: form.description,
        recommendation: form.recommendation || undefined,
        evidenceNote: form.evidenceNote || undefined,
        submit,
      };
      const res = await apiSend<{ finding: Finding }>("/api/findings", "POST", payload);
      router.push(`/findings/${res.finding.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save finding");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card className="mt-5 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        className="flex flex-col gap-4"
      >
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
            <Label htmlFor="periodId">Reporting period</Label>
            <Select id="periodId" required value={form.periodId} onChange={(e) => setForm({ ...form, periodId: e.target.value })}>
              <option value="">Select period</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
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
                onChange={(e) => setForm({ ...form, districtId: e.target.value, branchId: "" })}
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
              <Select id="branchId" required value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
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
            <Input
              id="operationArea"
              required
              placeholder="e.g. Teller operations, ATM channel"
              value={form.operationArea}
              onChange={(e) => setForm({ ...form, operationArea: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="irregularityType">Type of irregularity</Label>
            <Input
              id="irregularityType"
              required
              value={form.irregularityType}
              onChange={(e) => setForm({ ...form, irregularityType: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="amount">Amount</Label>
            <div className="flex gap-2">
              <Select
                className="w-24 shrink-0"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
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
              onChange={(e) => setForm({ ...form, caseCount: e.target.value })}
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
        </div>

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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" variant="secondary" disabled={submitting !== null}>
            {submitting === "draft" ? "Saving..." : "Save Draft"}
          </Button>
          <Button type="button" disabled={submitting !== null} onClick={() => save(true)}>
            {submitting === "submit" ? "Submitting..." : "Save & Submit"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
