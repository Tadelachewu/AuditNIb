import { findingStatusLabel, type Finding } from "@/types";
import { ALL_ROWS } from "@/lib/pagination";
import { registeredAmountOf, registeredCasesOf } from "@/lib/findings";

/**
 * Text search + column sort for the Findings list (src/app/(app)/findings)
 * and its CSV export (/api/findings/export) - one implementation, so the
 * export always contains exactly what the list shows. Both run server-side
 * over every matching finding (not just the visible page).
 */

export interface FindingNames {
  /** For the Period column's sort (optional: the code is compared when given). */
  periodCode?: (id: string) => string;
  districtName: (id: string) => string;
  branchName: (id: string) => string;
  departmentName: (id: string) => string;
  categoryName: (id: string) => string;
  sourceName: (id: string) => string;
}

export const FINDING_SORT_KEYS = [
  "reference", "title", "district", "branch", "department", "category", "source", "risk", "amount", "reportedCases", "cases", "status", "updatedAt",
  // Optional columns (hidden until shown with Show / hide columns).
  "casesIn", "casesOut", "period", "findingDate", "operationArea", "irregularityType", "priority", "reportedAmount",
  "rectifiedCases", "verifiedCases", "closedCases", "outstandingCases", "outstandingAmount", "externalReference", "createdAt",
] as const;
export type FindingSortKey = (typeof FINDING_SORT_KEYS)[number];

export function parseFindingSort(sort: string | null | undefined, dir: string | null | undefined): { key: FindingSortKey; desc: boolean } {
  const key = (FINDING_SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as FindingSortKey) : "updatedAt";
  // Default: newest update first; any other column defaults to ascending.
  const desc = dir === "desc" ? true : dir === "asc" ? false : key === "updatedAt";
  return { key, desc };
}

/** Every word must appear in reference, title, branch, department, category, source, risk or status. */
export function filterFindingsByText<T extends { finding: Finding }>(rows: T[], q: string, names: FindingNames): T[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter(({ finding: f }) => {
    const hay = [
      f.reference,
      f.title,
      names.districtName(f.districtId),
      names.branchName(f.branchId),
      names.departmentName(f.departmentId),
      names.categoryName(f.categoryId),
      names.sourceName(f.sourceId),
      f.riskLevel,
      f.status,
      findingStatusLabel(f.status),
      f.operationArea,
      f.irregularityType,
      f.priority,
      f.externalReference ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

type SliceLike = { eligibleCases: number; reportedCases: number; casesIn: number; casesOut: number; closedCases: number; closedAmount: number; eligibleAmount: number } | null;

export function sortFindings<T extends { finding: Finding; amount?: number }>(
  rows: T[],
  sort: { key: FindingSortKey; desc: boolean },
  names: FindingNames,
  amountOf: (row: T) => number = (r) => r.finding.amount
): T[] {
  const value = (r: T): string | number => {
    const f = r.finding;
    // The filtered period's own share when there's a period filter.
    const slice = (r as { slice?: SliceLike }).slice ?? null;
    switch (sort.key) {
      case "reference":
        return f.reference;
      case "title":
        return f.title;
      case "district":
        return names.districtName(f.districtId);
      case "branch":
        return names.branchName(f.branchId);
      case "department":
        return names.departmentName(f.departmentId);
      case "category":
        return names.categoryName(f.categoryId);
      case "source":
        return names.sourceName(f.sourceId);
      case "risk":
        return f.riskLevel;
      case "amount":
        return amountOf(r);
      // Registered in the filtered period (0 where it was transferred in).
      case "reportedCases":
        return slice ? slice.reportedCases : registeredCasesOf(f);
      // This period's share after transfers (the whole count with no period filter).
      case "cases":
        return slice?.eligibleCases ?? f.caseCount;
      case "casesIn":
        return slice?.casesIn ?? 0;
      case "casesOut":
        return slice?.casesOut ?? 0;
      case "period":
        return names.periodCode ? names.periodCode(f.periodId) : f.periodId;
      case "findingDate":
        return f.findingDate ?? "";
      case "operationArea":
        return f.operationArea ?? "";
      case "irregularityType":
        return f.irregularityType ?? "";
      case "priority":
        return f.priority ?? "";
      case "reportedAmount":
        return registeredAmountOf(f);
      case "rectifiedCases":
        return f.rectifiedCases;
      case "verifiedCases":
        return f.districtVerifiedCases;
      case "closedCases":
        return slice ? slice.closedCases : f.closedCases;
      case "outstandingCases":
        return slice ? slice.eligibleCases - slice.closedCases : f.caseCount - f.closedCases;
      case "outstandingAmount":
        return slice ? slice.eligibleAmount - slice.closedAmount : f.amount - f.closedAmount;
      case "externalReference":
        return f.externalReference ?? "";
      case "createdAt":
        return f.createdAt;
      case "status":
        return f.status;
      case "updatedAt":
        return f.updatedAt;
    }
  };
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
    // Stable tie-break: newest update first.
    return cmp !== 0 ? cmp * dir : b.finding.updatedAt.localeCompare(a.finding.updatedAt);
  });
}

/** Allowed page sizes for the Findings list ("all" = every row on one page). */
export function parsePageSize(v: string | null | undefined): number {
  if (v === "all") return ALL_ROWS;
  const n = Number(v);
  return [10, 25, 50, 100].includes(n) ? n : 25;
}
