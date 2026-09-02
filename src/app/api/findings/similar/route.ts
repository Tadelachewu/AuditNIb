import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";

/**
 * Non-blocking duplicate-suggestion lookup for the Register Finding form -
 * "suggest the most likely existing registered finding... let the
 * registrar check" (as opposed to bulk import's dedupeKey() in
 * src/lib/import.ts, which hard-rejects an exact-match row; this is
 * deliberately a looser, softer match since it's a human prompt, not a
 * validation gate). Matches on branch + category + operation area +
 * irregularity type + period - the fields most indicative of "same
 * underlying issue" - dropping exact amount/case-count equality, which
 * often differs between a near-duplicate and the real entry. Scoped the
 * same way the Findings list itself is (findingsInScope), so this never
 * surfaces a finding outside the caller's own organization.
 */
export async function GET(request: Request) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const categoryId = url.searchParams.get("categoryId");
  const operationArea = url.searchParams.get("operationArea");
  const irregularityType = url.searchParams.get("irregularityType");
  const periodId = url.searchParams.get("periodId");
  const excludeId = url.searchParams.get("excludeId");

  if (!branchId || !categoryId || !operationArea || !irregularityType || !periodId) {
    return NextResponse.json({ matches: [] });
  }

  const db = readDb();
  const matches = findingsInScope(db, auth.session)
    .filter(
      (f) =>
        f.id !== excludeId &&
        f.branchId === branchId &&
        f.categoryId === categoryId &&
        f.operationArea === operationArea &&
        f.irregularityType === irregularityType &&
        f.periodId === periodId
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((f) => ({ id: f.id, reference: f.reference, title: f.title, status: f.status, createdAt: f.createdAt }));

  return NextResponse.json({ matches });
}
