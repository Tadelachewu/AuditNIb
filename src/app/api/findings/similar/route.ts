import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { SIMILAR_FINDING_FIELDS, type Finding, type SimilarFindingField } from "@/types";

const FIELD_ACCESSORS: Record<SimilarFindingField, (f: Finding) => string> = {
  branchId: (f) => f.branchId,
  categoryId: (f) => f.categoryId,
  operationArea: (f) => f.operationArea,
  irregularityType: (f) => f.irregularityType,
  periodId: (f) => f.periodId,
  sourceId: (f) => f.sourceId,
  departmentId: (f) => f.departmentId,
  riskLevel: (f) => f.riskLevel,
};

/**
 * Non-blocking duplicate-suggestion lookup for the Register Finding form -
 * "suggest the most likely existing registered finding... let the
 * registrar check" (as opposed to bulk import's dedupeKey() in
 * src/lib/import.ts, which hard-rejects an exact-match row; this is
 * deliberately a looser, softer match since it's a human prompt, not a
 * validation gate). Which fields count toward "similar" is admin-
 * configurable (Settings.similarFindingFields, edited at /admin/settings) -
 * every configured field must match exactly (AND, not OR), and every one
 * of them must actually have a value on the in-progress form, or nothing
 * is suggested at all. Amount/case count are deliberately never candidates
 * (see SIMILAR_FINDING_FIELDS's own doc comment) - only SIMILAR_FINDING_
 * FIELDS' exact-equality-comparable set is. Scoped the same way the
 * Findings list itself is (findingsInScope), so this never surfaces a
 * finding outside the caller's own organization.
 */
export async function GET(request: Request) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;

  const db = readDb();
  const fields = db.settings.similarFindingFields;
  if (fields.length === 0) return NextResponse.json({ matches: [] });

  const url = new URL(request.url);
  const excludeId = url.searchParams.get("excludeId");
  const candidateValues: Partial<Record<SimilarFindingField, string>> = {};
  for (const { key } of SIMILAR_FINDING_FIELDS) {
    candidateValues[key] = url.searchParams.get(key) ?? undefined;
  }

  // Every configured field must actually have a value from the caller -
  // otherwise "similar" would silently degrade to matching on whatever
  // subset happened to be filled in, rather than what the admin configured.
  if (fields.some((field) => !candidateValues[field])) {
    return NextResponse.json({ matches: [] });
  }

  const matches = findingsInScope(db, auth.session)
    .filter((f) => f.id !== excludeId && fields.every((field) => FIELD_ACCESSORS[field](f) === candidateValues[field]))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((f) => ({ id: f.id, reference: f.reference, title: f.title, status: f.status, createdAt: f.createdAt }));

  return NextResponse.json({ matches });
}
