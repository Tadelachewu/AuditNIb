import type { Database, Finding, SimilarFindingField } from "@/types";

/**
 * The admin-configured duplicate rule (Settings → Similar Findings,
 * Settings.similarFindingFields): two findings are duplicates when EVERY
 * configured field has a value and is exactly equal. One implementation,
 * used by the Register Finding form's suggestions (/api/findings/similar)
 * and by the Excel import's duplicate check (src/lib/import.ts).
 */
export const SIMILAR_FIELD_ACCESSORS: Record<SimilarFindingField, (f: Finding) => string> = {
  districtId: (f) => f.districtId,
  branchId: (f) => f.branchId,
  sourceId: (f) => f.sourceId,
  departmentId: (f) => f.departmentId,
  categoryId: (f) => f.categoryId,
  periodId: (f) => f.periodId,
  findingDate: (f) => f.findingDate,
  operationArea: (f) => f.operationArea,
  irregularityType: (f) => f.irregularityType,
  amount: (f) => String(f.amount),
  currency: (f) => f.currency,
  caseCount: (f) => String(f.caseCount),
  riskLevel: (f) => f.riskLevel,
  priority: (f) => f.priority,
  title: (f) => f.title,
  description: (f) => f.description,
  recommendation: (f) => f.recommendation ?? "",
  rootCause: (f) => f.rootCause ?? "",
  evidenceNote: (f) => f.evidenceNote ?? "",
};

/**
 * The comparison key of a finding under the configured rule, or null when
 * the rule is off (no fields configured) or the finding is missing a
 * configured field (a blank value never counts as a match - same as the
 * form, which suggests nothing until every configured field is filled).
 * Text is compared trimmed.
 */
export function similarityKey(fields: readonly SimilarFindingField[], f: Finding): string | null {
  if (fields.length === 0) return null;
  const parts: string[] = [];
  for (const field of fields) {
    const v = SIMILAR_FIELD_ACCESSORS[field](f).trim();
    if (!v) return null;
    parts.push(v);
  }
  return parts.join("\u0001");
}

/** Key -> reference of every existing finding, for the import's duplicate check. */
export function existingSimilarityKeys(db: Database): Map<string, string> {
  const fields = db.settings.similarFindingFields ?? [];
  const map = new Map<string, string>();
  for (const f of db.findings) {
    const key = similarityKey(fields, f);
    if (key && !map.has(key)) map.set(key, f.reference);
  }
  return map;
}
