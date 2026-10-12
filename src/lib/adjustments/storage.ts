import type { FindingAdjustment } from "./types";

/**
 * How an adjustment's case detail is stored. It lives in ONE JSON column
 * (case_amount_changes): the changes to existing cases and the names of the
 * added cases - { changes: [...], newCaseDescriptions: [...] }. Rows written
 * before added cases could be named hold just the array of changes; both
 * shapes are read. Pure - used by src/lib/db.ts.
 */
export function unpackCaseDetail(raw: unknown, addedCount: number): Pick<FindingAdjustment, "caseAmountChanges" | "newCaseDescriptions"> {
  const packed = raw && !Array.isArray(raw) && typeof raw === "object" ? (raw as { changes?: unknown; newCaseDescriptions?: unknown }) : null;
  const changes = (packed ? packed.changes : raw) ?? [];
  const names = Array.isArray(packed?.newCaseDescriptions) ? (packed.newCaseDescriptions as unknown[]).map((d) => (typeof d === "string" ? d : "")) : [];
  return {
    caseAmountChanges: (Array.isArray(changes) ? changes : []) as FindingAdjustment["caseAmountChanges"],
    // Always one entry per added case.
    newCaseDescriptions: Array.from({ length: addedCount }, (_, i) => names[i] ?? ""),
  };
}

export function packCaseDetail(a: Pick<FindingAdjustment, "caseAmountChanges" | "newCaseDescriptions">): object {
  return { changes: a.caseAmountChanges ?? [], newCaseDescriptions: a.newCaseDescriptions ?? [] };
}
