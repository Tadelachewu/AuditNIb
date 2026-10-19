import { ALL_PERIODS_VALUE } from "@/lib/dashboardFilters";
import { appNow } from "@/lib/clock";

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
 * The current reporting period: the one of the PREVIOUS calendar month
 * (local time). During October it is 2026-09; on 1 November it becomes
 * 2026-10, and the automatic transfer carries what is still outstanding in
 * 2026-09 into it (src/lib/autoTransfer).
 * When that period doesn't exist (a gap, or the system's first month), the
 * most recent period that started before this calendar month; failing that,
 * the earliest one.
 */
export function currentPeriod<T extends PeriodLike>(periods: readonly T[], now: number = appNow()): T | undefined {
  const today = new Date(now);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const code = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;
  const previous = periods.find((p) => p.code === code);
  if (previous) return previous;
  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const sorted = sortPeriods(periods);
  return sorted.find((p) => new Date(p.startsAt).getTime() < thisMonthStart) ?? sorted.at(-1);
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
