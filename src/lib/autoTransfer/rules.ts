import { matchesListValue } from "@/lib/dashboardFilters";
import { AUTO_TRANSFERABLE_STATUSES } from "@/lib/findings";
import type { Database, Finding, ReportingPeriod } from "@/types";
import { isHandled, type AutoTransferConfig, type AutoTransferRun } from "./types";

/**
 * Pure rules of the automatic transfer (no storage, no side effects), so
 * they can be tested and reused on their own.
 */

/**
 * When a period's sweep becomes due: the LATER of its end and its
 * submission window's end (a grace window can run past the period end -
 * moving findings while people may still submit into the period would pull
 * work out from under them), plus the configured delay.
 */
export function sweepDueAt(period: Pick<ReportingPeriod, "endsAt" | "submissionEndsAt">, config: Pick<AutoTransferConfig, "delayHours">): number {
  const end = Math.max(new Date(period.endsAt).getTime(), new Date(period.submissionEndsAt).getTime());
  return end + Math.max(0, config.delayHours) * 60 * 60 * 1000;
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

/** Excluded from automatic transfer by its operation area. */
export function isExcluded(finding: Pick<Finding, "operationArea">, config: Pick<AutoTransferConfig, "excludedOperationAreas">): boolean {
  return config.excludedOperationAreas.some((area) => area.trim() && matchesListValue(area, finding.operationArea));
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
    toMove: outstanding.filter((f) => !isExcluded(f, config)),
    kept: outstanding.filter((f) => isExcluded(f, config)),
  };
}
