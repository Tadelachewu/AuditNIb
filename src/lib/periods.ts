import { ALL_PERIODS_VALUE } from "@/lib/dashboardFilters";

/**
 * Reporting-period helpers shared by every period filter (dashboards,
 * Findings, Reports, report templates, Register Finding) so they all default
 * to the same "current period" and list periods in the same order.
 * Client-safe.
 */
type PeriodLike = { id: string; code: string; startsAt: string; endsAt: string };

/** Newest first (by start date) - the order every period dropdown uses. */
export function sortPeriods<T extends PeriodLike>(periods: readonly T[]): T[] {
  return [...periods].sort((a, b) => b.startsAt.localeCompare(a.startsAt) || b.code.localeCompare(a.code));
}

/**
 * The current reporting period: the one whose date range contains today.
 * When none does (a gap, or no period created for this month yet), the most
 * recent period that has already started; failing that, the earliest one.
 */
export function currentPeriod<T extends PeriodLike>(periods: readonly T[], now: number = Date.now()): T | undefined {
  const containing = periods.find((p) => new Date(p.startsAt).getTime() <= now && now <= new Date(p.endsAt).getTime());
  if (containing) return containing;
  const started = sortPeriods(periods).find((p) => new Date(p.startsAt).getTime() <= now);
  return started ?? sortPeriods(periods).at(-1);
}

/**
 * The period a list page should show for its `periodId` URL parameter:
 * no parameter -> the current period; "ALL" -> every period (""); anything
 * else -> that period. Pages and their CSV exports both use this, so an
 * export always matches what's on screen.
 */
export function resolvePeriodFilter<T extends PeriodLike>(periods: readonly T[], raw: string | null | undefined): string {
  if (!raw) return currentPeriod(periods)?.id ?? "";
  if (raw === ALL_PERIODS_VALUE) return "";
  return raw;
}
