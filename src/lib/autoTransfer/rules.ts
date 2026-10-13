import { matchesListValue } from "@/lib/dashboardFilters";
import { AUTO_TRANSFERABLE_STATUSES } from "@/lib/findings";
import type { Database, Finding, ReportingPeriod } from "@/types";
import { isHandled, type AutoTransferConfig, type AutoTransferRun } from "./types";

/**
 * Pure rules of the automatic transfer (no storage, no side effects), so
 * they can be tested and reused on their own.
 */

/**
 * When a period's sweep becomes due: 00:00 (local time) on the 1st of the
 * month after next - the moment it stops being the current period
 * (src/lib/periods.ts: the current period is the previous calendar month's)
 * and the next one takes over. 2026-09 is swept into 2026-10 on 1 November.
 * Plus the configured delay.
 */
export function sweepDueAt(period: Pick<ReportingPeriod, "year" | "month">, config: Pick<AutoTransferConfig, "delayHours">): number {
  const noLongerCurrent = new Date(period.year, period.month + 1, 1).getTime();
  return noLongerCurrent + Math.max(0, config.delayHours) * 60 * 60 * 1000;
}

/** The period right after this one by calendar (year/month + 1), whatever its status - one step. */
export function nextPeriod(periods: readonly ReportingPeriod[], period: ReportingPeriod): ReportingPeriod | undefined {
  const year = period.month === 12 ? period.year + 1 : period.year;
  const month = period.month === 12 ? 1 : period.month + 1;
  return periods.find((p) => p.year === year && p.month === month);
}

/**
 * Periods whose sweep is due and not yet handled, oldest first (so several
 * missed months cascade in order). Locked periods are swept too - a lock
 * only blocks submission.
 */
export function dueSweeps(periods: readonly ReportingPeriod[], runs: readonly AutoTransferRun[], config: AutoTransferConfig, now: number): ReportingPeriod[] {
  if (!config.enabled) return [];
  const runByPeriod = new Map(runs.map((r) => [r.periodId, r]));
  return periods
    .filter((p) => !isHandled(runByPeriod.get(p.id)) && sweepDueAt(p, config) <= now)
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

/** Transferred automatically: its source is ticked for its operation area. */
export function isIncluded(
  finding: Pick<Finding, "operationArea" | "sourceId">,
  config: Pick<AutoTransferConfig, "includedAreaSources" | "legacy">
): boolean {
  const listed = (areas: string[]) => areas.some((area) => area.trim() && matchesListValue(area, finding.operationArea));
  // Database behind on migrations: the older list still decides.
  if (config.legacy?.excludedOperationAreas) return !listed(config.legacy.excludedOperationAreas);
  if (config.legacy?.includedOperationAreas) return listed(config.legacy.includedOperationAreas);
  return config.includedAreaSources.some(
    (row) => row.operationArea.trim() && matchesListValue(row.operationArea, finding.operationArea) && row.sourceIds.includes(finding.sourceId)
  );
}

/** Still outstanding in the period: a transferable status, with something not closed. */
export function isOutstandingIn(finding: Finding, periodId: string): boolean {
  return (
    finding.periodId === periodId &&
    AUTO_TRANSFERABLE_STATUSES.includes(finding.status) &&
    (finding.closedCases < finding.caseCount || finding.closedAmount < finding.amount)
  );
}

/** What a sweep of `period` would do. */
export function planSweep(
  db: Pick<Database, "findings" | "reportingPeriods">,
  period: ReportingPeriod,
  config: AutoTransferConfig
): { destination: ReportingPeriod | undefined; toMove: Finding[]; kept: Finding[] } {
  const outstanding = db.findings.filter((f) => isOutstandingIn(f, period.id));
  return {
    destination: nextPeriod(db.reportingPeriods, period),
    toMove: outstanding.filter((f) => isIncluded(f, config)),
    kept: outstanding.filter((f) => !isIncluded(f, config)),
  };
}
