import { computeEligibleCaseCounts } from "@/lib/findings";
import { formatNumber } from "@/lib/format";
import type { Database, Branch, District, ReportingPeriod, ClassifiedCategory, BranchCoverageNote } from "@/types";

// The 10 named Internal Control Division report templates (see report/*.xlsx,
// already relabeled with these exact names) as pure aggregation functions
// over the existing Finding/District/Branch data - nothing here is stored
// separately (aside from BranchCoverageNote, the one genuinely writable
// piece - see #1), so every number is always live and can never drift from
// what the Findings list itself shows.

// Single source of truth for slug <-> permission action <-> display copy,
// shared by the hub page, each template page, and the CSV export route -
// so there's exactly one place that needs updating if a template's slug,
// permission, or description ever changes.
export interface ReportTemplateMeta {
  slug: string;
  action: string;
  label: string;
  description: string;
}

export const REPORT_TEMPLATES: ReportTemplateMeta[] = [
  { slug: "uncovered-branches", action: "uncovered-branches", label: "Uncovered Branches", description: "Branches with no findings submitted this period, and why." },
  { slug: "category-detail-by-district", action: "category-detail-by-district", label: "Category Detail by District", description: "Every district x classified-case category, Unrectified/Rectified." },
  { slug: "monthly-summary", action: "monthly-summary", label: "Monthly Summary Report", description: "Category detail plus amount involved and branch dispatch coverage." },
  { slug: "monthly-district-history", action: "monthly-district-history", label: "Monthly District History", description: "Other-Case performance by district, one block per reporting period." },
  { slug: "monthly-district-detail", action: "monthly-district-detail", label: "Monthly District Detail", description: "The same district/period history as a flat, long-format table." },
  { slug: "district-ranking-other-cases", action: "district-ranking-other-cases", label: "District Ranking - Other Cases", description: "Cumulative district ranking on the official scored category." },
  { slug: "weekly-executive-summary", action: "weekly-executive-summary", label: "Weekly Executive Summary", description: "Every classified category x district, balance carried forward this week vs. last week." },
  { slug: "district-ranking-all-cases", action: "district-ranking-all-cases", label: "District Ranking - All Cases", description: "District ranking across every classified-case category." },
  { slug: "category-performance-summary", action: "category-performance-summary", label: "Category Performance Summary", description: "Bank-wide rectification rate per category, with the district range." },
  { slug: "mid-month-district-snapshot", action: "mid-month-district-snapshot", label: "Mid-Month District Snapshot", description: "District performance as of any chosen cutoff date within a period." },
];

function activeBranches(db: Database): Branch[] {
  return db.branches.filter((b) => b.status === "ACTIVE");
}
function activeDistricts(db: Database): District[] {
  return db.districts.filter((d) => d.status === "ACTIVE");
}

// The bank's own Excel column order (see report/*.xlsx's "Category Detail
// by District"/"Monthly Summary Report" sheets) - Zero Balance comes
// before Dormant Account there, unlike db.categories' own creation order
// (which follows master.txt §25's reference list instead). This reorders
// only how these report templates *display* categories, not db.categories
// itself - finding registration forms etc. are unaffected.
const REPORT_CATEGORY_ORDER = ["ATM_MISMATCH", "ATM_LONG_OS", "IT", "ZERO_BALANCE", "DORMANT", "CK_BOOK", "OTHER_CASE"];

function activeCategories(db: Database): ClassifiedCategory[] {
  const rank = new Map(REPORT_CATEGORY_ORDER.map((code, i) => [code, i]));
  return db.categories
    .filter((c) => c.active)
    .sort((a, b) => (rank.get(a.code) ?? REPORT_CATEGORY_ORDER.length) - (rank.get(b.code) ?? REPORT_CATEGORY_ORDER.length));
}

/** "Total No. of Branches" - present on most of the bank's district-level sheets, next to SN/District. */
function districtBranchCount(db: Database, districtId: string): number {
  return activeBranches(db).filter((b) => b.districtId === districtId).length;
}

// ---------------------------------------------------------------------------
// 1. Uncovered Branches - every ACTIVE branch with zero findings in the
// given period, joined with an optional recorded reason.
// ---------------------------------------------------------------------------

export interface UncoveredBranchRow {
  branch: Branch;
  district: District | undefined;
  note: BranchCoverageNote | null;
}

export function getUncoveredBranches(db: Database, periodId: string): UncoveredBranchRow[] {
  return activeBranches(db)
    .filter((b) => !db.findings.some((f) => f.branchId === b.id && f.periodId === periodId))
    .map((b) => ({
      branch: b,
      district: db.districts.find((d) => d.id === b.districtId),
      note: db.branchCoverageNotes.find((n) => n.branchId === b.id && n.periodId === periodId) ?? null,
    }))
    .sort((a, b) => (a.district?.name ?? "").localeCompare(b.district?.name ?? "", "en-US") || a.branch.name.localeCompare(b.branch.name, "en-US"));
}

// ---------------------------------------------------------------------------
// 2. Category Detail by District - District x active-Category grid of
// Unrectified/Rectified case counts, plus a TOTAL row.
// ---------------------------------------------------------------------------

export interface CategoryDetailCell {
  category: ClassifiedCategory;
  total: number;
  rectified: number;
  outstanding: number;
}

export interface CategoryDetailRow {
  district: District;
  totalBranches: number;
  perCategory: CategoryDetailCell[];
  totalCases: number;
  totalRectified: number;
  totalOutstanding: number;
  rectifiedPct: number | null;
}

export function getCategoryDetailByDistrict(
  db: Database,
  periodId: string
): {
  rows: CategoryDetailRow[];
  categories: ClassifiedCategory[];
  totalRow: { totalCases: number; totalRectified: number; totalOutstanding: number; rectifiedPct: number | null };
} {
  const categories = activeCategories(db);
  const rows: CategoryDetailRow[] = activeDistricts(db).map((district) => {
    const perCategory = categories.map((category) => {
      const findings = db.findings.filter((f) => f.districtId === district.id && f.periodId === periodId && f.categoryId === category.id);
      const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
      const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
      return { category, total, rectified, outstanding: total - rectified };
    });
    const totalCases = perCategory.reduce((sum, c) => sum + c.total, 0);
    const totalRectified = perCategory.reduce((sum, c) => sum + c.rectified, 0);
    return {
      district,
      totalBranches: districtBranchCount(db, district.id),
      perCategory,
      totalCases,
      totalRectified,
      totalOutstanding: totalCases - totalRectified,
      rectifiedPct: totalCases > 0 ? (totalRectified / totalCases) * 100 : null,
    };
  });
  const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
  const totalRectified = rows.reduce((sum, r) => sum + r.totalRectified, 0);
  return {
    rows,
    categories,
    totalRow: { totalCases, totalRectified, totalOutstanding: totalCases - totalRectified, rectifiedPct: totalCases > 0 ? (totalRectified / totalCases) * 100 : null },
  };
}

// ---------------------------------------------------------------------------
// 3. Monthly Summary Report - one outstanding-case count per category (the
// Excel condenses #2's Unrectified/Rectified pair down to a single number
// per category here - see the sheet's own formulas, which pull just the
// Unrectified half of each pair), plus amount involved, branch dispatch
// coverage from #1, and the district's official BRD score (computePerformance
// - the Other Case category is the only one the bank's own workflow ever
// tracks rectification against, so "Rectified"/"Rectified %" here are that
// same official score, not a second, informal tally). "Total No. of cases"
// is the true unrectified+rectified total - the source workbook's own
// formula for that cell was byte-identical to "Unrectified" (a copy-paste
// bug, confirmed by comparing the two cells' formulas), which this
// deliberately does not reproduce.
// ---------------------------------------------------------------------------

export interface MonthlySummaryCell {
  category: ClassifiedCategory;
  outstanding: number;
}

export interface MonthlySummaryRow {
  district: District;
  totalBranches: number;
  perCategory: MonthlySummaryCell[];
  amountInvolved: number;
  totalOutstanding: number;
  officialRectified: number;
  officialPerformance: number | null;
  branchesDispatched: number;
  branchesNotDispatched: number;
  totalCases: number;
}

export function getMonthlySummaryReport(
  db: Database,
  periodId: string
): {
  rows: MonthlySummaryRow[];
  categories: ClassifiedCategory[];
  totalRow: { totalOutstanding: number; officialRectified: number; totalAmount: number; totalCases: number };
} {
  const categories = activeCategories(db);
  const uncovered = getUncoveredBranches(db, periodId);
  const rows: MonthlySummaryRow[] = activeDistricts(db).map((district) => {
    const districtFindings = db.findings.filter((f) => f.districtId === district.id && f.periodId === periodId);
    const perCategory = categories.map((category) => {
      const findings = districtFindings.filter((f) => f.categoryId === category.id);
      const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
      const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
      return { category, outstanding: total - rectified };
    });
    const totalOutstanding = perCategory.reduce((sum, c) => sum + c.outstanding, 0);
    const totalCases = districtFindings.reduce((sum, f) => sum + f.caseCount, 0);
    const officialCounts = computeEligibleCaseCounts(db, { districtId: district.id, periodId });
    const totalBranches = districtBranchCount(db, district.id);
    const notDispatched = uncovered.filter((u) => u.district?.id === district.id).length;
    const amountInvolved = districtFindings.reduce((sum, f) => sum + f.amount, 0);
    return {
      district,
      totalBranches,
      perCategory,
      amountInvolved,
      totalOutstanding,
      officialRectified: officialCounts?.rectifiedCases ?? 0,
      officialPerformance: officialCounts ? (officialCounts.rectifiedCases / officialCounts.totalCases) * 100 : null,
      branchesDispatched: totalBranches - notDispatched,
      branchesNotDispatched: notDispatched,
      totalCases,
    };
  });
  const totalOutstanding = rows.reduce((sum, r) => sum + r.totalOutstanding, 0);
  const officialRectified = rows.reduce((sum, r) => sum + r.officialRectified, 0);
  const totalAmount = rows.reduce((sum, r) => sum + r.amountInvolved, 0);
  const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
  return { rows, categories, totalRow: { totalOutstanding, officialRectified, totalAmount, totalCases } };
}

// ---------------------------------------------------------------------------
// 4/5. Monthly District History / Monthly District Detail.
//
// Two distinct kinds of rows per district/period:
//
//   (a) "Other Cases" — the official scored metric, matching what #6, #4,
//       the BRD, and computeEligibleCaseCounts() track. This is the same
//       series Monthly District History uses.
//   (b) "Various internal Audit report" — a catch-all bucket in the source
//       Excel's "Detail monthly summaryBD" sheet for every *other*
//       classified category (ATM Mismatch, IT, Zero Balance, Dormant,
//       Cheque Book, … — anything NOT the official "Other Cases" scoring
//       category). Row kind is tagged with `.rowKind` on each flat
//       DistrictPeriodRow so the UI / CSV can render them distinctly and
//       add them separately into each district's subtotal row.
//
// #4 groups the flat series by period (stacked blocks); #5 groups it by
// district with a subtotal per district and a grand TOTAL at the end.
// ---------------------------------------------------------------------------

export type DistrictPeriodRowKind = "OTHER_CASES" | "VARIOUS_INTERNAL_AUDIT";

export interface DistrictPeriodRow {
  period: ReportingPeriod;
  district: District;
  rowKind: DistrictPeriodRowKind;
  totalBranches: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
}

export function getMonthlyDistrictSeries(db: Database): DistrictPeriodRow[] {
  const rule = db.scoringRules.find((r) => r.active);
  const periods = [...db.reportingPeriods].sort((a, b) => a.year - b.year || a.month - b.month);
  const districts = activeDistricts(db);
  const rows: DistrictPeriodRow[] = [];
  for (const period of periods) {
    for (const district of districts) {
      // (a) Official "Other Cases" bucket — ScoringRule gated, exactly the
      // same series the history/ranking pages show.
      const eligible = computeEligibleCaseCounts(db, { districtId: district.id, periodId: period.id });
      const otherTotal = eligible?.totalCases ?? 0;
      const otherRectified = eligible?.rectifiedCases ?? 0;
      rows.push({
        period,
        district,
        rowKind: "OTHER_CASES",
        totalBranches: districtBranchCount(db, district.id),
        totalCases: otherTotal,
        rectifiedCases: otherRectified,
        outstandingCases: otherTotal - otherRectified,
        performance: eligible && eligible.totalCases > 0 ? (eligible.rectifiedCases / eligible.totalCases) * 100 : null,
      });

      // (b) "Various internal Audit report" catch-all — every finding in
      // this district/period that is NOT REJECTED and does NOT fall into
      // the official ScoringRule's category+source bucket. If no active
      // ScoringRule exists, this bucket defaults to ALL findings (all of
      // them are "various" in that case, since nothing is official).
      const allFindings = db.findings.filter(
        (f) => f.districtId === district.id && f.periodId === period.id && f.status !== "REJECTED"
      );
      let variousTotal = 0;
      let variousRectified = 0;
      if (!rule) {
        variousTotal = allFindings.reduce((s, f) => s + f.caseCount, 0);
        variousRectified = allFindings.reduce((s, f) => s + f.rectifiedCases, 0);
      } else {
        for (const f of allFindings) {
          const inOfficial = rule.categories.includes(f.categoryId) && rule.sources.includes(f.sourceId);
          if (!inOfficial) {
            variousTotal += f.caseCount;
            variousRectified += f.rectifiedCases;
          }
        }
      }
      rows.push({
        period,
        district,
        rowKind: "VARIOUS_INTERNAL_AUDIT",
        totalBranches: districtBranchCount(db, district.id),
        totalCases: variousTotal,
        rectifiedCases: variousRectified,
        outstandingCases: variousTotal - variousRectified,
        performance: variousTotal > 0 ? (variousRectified / variousTotal) * 100 : null,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 6. District Ranking - Other Cases - cumulative (a period-ID list, or every
// period when omitted) ranking by the official Other-Case rectification %,
// plus an auto-written narrative summary line.
// ---------------------------------------------------------------------------

export interface DistrictRankingRow {
  district: District;
  totalBranches: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
}

/** Bank-wide TOTAL row for any per-district ranking table - present at the bottom of every such sheet in the source workbook. */
function districtRankingTotalRow(rows: DistrictRankingRow[]): Omit<DistrictRankingRow, "district"> {
  const totalBranches = rows.reduce((sum, r) => sum + r.totalBranches, 0);
  const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
  const rectifiedCases = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);
  return {
    totalBranches,
    totalCases,
    rectifiedCases,
    outstandingCases: totalCases - rectifiedCases,
    performance: totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null,
  };
}

export function getDistrictRankingOtherCases(
  db: Database,
  periodIds?: string[]
): { rows: DistrictRankingRow[]; totalRow: Omit<DistrictRankingRow, "district">; narrative: string } {
  const rows: DistrictRankingRow[] = activeDistricts(db)
    .map((district) => {
      let totalCases = 0;
      let rectifiedCases = 0;
      if (periodIds && periodIds.length > 0) {
        for (const periodId of periodIds) {
          const counts = computeEligibleCaseCounts(db, { districtId: district.id, periodId });
          if (counts) {
            totalCases += counts.totalCases;
            rectifiedCases += counts.rectifiedCases;
          }
        }
      } else {
        // No period filter - lifetime totals (every eligible finding
        // currently sitting under this district, regardless of which
        // period it's in today), matching computePerformance()'s own
        // "no periodId" mode.
        const counts = computeEligibleCaseCounts(db, { districtId: district.id });
        if (counts) {
          totalCases = counts.totalCases;
          rectifiedCases = counts.rectifiedCases;
        }
      }
      return {
        district,
        totalBranches: districtBranchCount(db, district.id),
        totalCases,
        rectifiedCases,
        outstandingCases: totalCases - rectifiedCases,
        performance: totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null,
      };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));

  const grandTotal = rows.reduce((sum, r) => sum + r.totalCases, 0);
  const grandRectified = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);
  const pct = grandTotal > 0 ? (grandRectified / grandTotal) * 100 : 0;
  const narrative =
    grandTotal > 0
      ? `Out of the total ${formatNumber(grandTotal)} cases, ${formatNumber(grandRectified)} have been rectified, representing ${pct.toFixed(0)}% of the total cases. Accordingly, ${(100 - pct).toFixed(0)}% of the cases remain unrectified.`
      : "No eligible cases recorded yet.";
  return { rows, totalRow: districtRankingTotalRow(rows), narrative };
}

// ---------------------------------------------------------------------------
// 7. Weekly Executive Summary - NOT "cases logged this week", and NOT
// scoped to Other Case alone (both true of this function's first
// implementation, before cross-checking the full 136-row sheet against
// report/*.xlsx's "executive summary-edited", not just its first 15 rows).
// The real sheet is six numbered sections - "1. Monthly rectification on
// Other Cases", "2. ...ATM-related...", "3. ...IT-related...", "4. ...Zero
// balance...", "5. ...Inactive balance...", "6. ...Cheque book..." - one
// per classified category, each with its own district breakdown and a
// TOTAL row. So this covers every ACTIVE category dynamically (whatever
// currently exists in db.categories, in REPORT_CATEGORY_ORDER - not a
// hardcoded list of six), not just the one officially-scored category.
//
// Section 1 (Other Case) and sections 2-6 actually use two *different*
// column layouts in the source file: section 1 has a simple this-week vs
// last-week rectified-% comparison, while 2-6 use a "Previous Balance /
// Rectified / Additional / Current Balance" bridge spanning a fixed
// historical baseline ("as of July,2025" ... "as of March,2026") that this
// app has no equivalent fixed anchor for. Rather than special-case one
// category's layout, every category here gets the one bridge shape,
// generalized to a rolling week instead of a fixed historical range:
// previousBalance/currentBalance are outstanding-case counts as of last
// week's / this week's cutoff (findingDate <= cutoff, same convention as
// #10's Mid-Month Snapshot); additional is newly-logged cases this week;
// rectified is derived algebraically (previousBalance + additional -
// currentBalance) since findings don't carry a separate "date rectified"
// to filter by directly. thisWeekPct/lastWeekPct/difference preserve
// section 1's own week-over-week trend, applied uniformly to every
// category. Computed live on every view rather than a persisted snapshot -
// see the plan doc for that tradeoff. Monday-start week, matching
// TimeRangeFilter's own "This Week" preset.
// ---------------------------------------------------------------------------

export interface WeeklyExecutiveRow {
  district: District;
  totalBranches: number;
  previousBalance: number;
  additional: number;
  rectified: number;
  currentBalance: number;
  thisWeekPct: number | null;
  lastWeekPct: number | null;
  difference: number | null;
}

export interface WeeklyCategorySummary {
  category: ClassifiedCategory;
  rows: WeeklyExecutiveRow[];
  totalRow: Omit<WeeklyExecutiveRow, "district" | "totalBranches">;
}

/** ISO date for the Monday-start week ending `weeksAgo` weeks before today (0 = this week). */
function weekEndDate(weeksAgo: number): string {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday - weeksAgo * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday.toISOString().slice(0, 10);
}

export function getWeeklyExecutiveSummary(db: Database): WeeklyCategorySummary[] {
  const thisWeekCutoff = weekEndDate(0);
  const lastWeekCutoff = weekEndDate(1);
  const districts = activeDistricts(db);

  function cumulativeAsOf(categoryId: string, districtId: string, asOfDate: string): { totalCases: number; rectifiedCases: number } {
    const findings = db.findings.filter(
      (f) => f.categoryId === categoryId && f.districtId === districtId && f.status !== "REJECTED" && f.findingDate <= asOfDate
    );
    return {
      totalCases: findings.reduce((sum, f) => sum + f.caseCount, 0),
      rectifiedCases: findings.reduce((sum, f) => sum + f.rectifiedCases, 0),
    };
  }

  function buildRow(previous: { totalCases: number; rectifiedCases: number }, current: { totalCases: number; rectifiedCases: number }) {
    const previousBalance = previous.totalCases - previous.rectifiedCases;
    const currentBalance = current.totalCases - current.rectifiedCases;
    const additional = current.totalCases - previous.totalCases;
    const rectified = previousBalance + additional - currentBalance;
    const thisWeekPct = current.totalCases > 0 ? (current.rectifiedCases / current.totalCases) * 100 : null;
    const lastWeekPct = previous.totalCases > 0 ? (previous.rectifiedCases / previous.totalCases) * 100 : null;
    const difference = thisWeekPct !== null && lastWeekPct !== null ? thisWeekPct - lastWeekPct : null;
    return { previousBalance, additional, rectified, currentBalance, thisWeekPct, lastWeekPct, difference };
  }

  return activeCategories(db).map((category) => {
    const previousTotal = { totalCases: 0, rectifiedCases: 0 };
    const currentTotal = { totalCases: 0, rectifiedCases: 0 };
    const rows: WeeklyExecutiveRow[] = districts.map((district) => {
      const previous = cumulativeAsOf(category.id, district.id, lastWeekCutoff);
      const current = cumulativeAsOf(category.id, district.id, thisWeekCutoff);
      previousTotal.totalCases += previous.totalCases;
      previousTotal.rectifiedCases += previous.rectifiedCases;
      currentTotal.totalCases += current.totalCases;
      currentTotal.rectifiedCases += current.rectifiedCases;
      return { district, totalBranches: districtBranchCount(db, district.id), ...buildRow(previous, current) };
    });
    return { category, rows, totalRow: buildRow(previousTotal, currentTotal) };
  });
}

// ---------------------------------------------------------------------------
// 8. District Ranking - All Cases - same ranking shape as #6, but summing
// every category's cases (not gated by the active ScoringRule) - a
// secondary, broader lens distinct from the official scored metric.
// ---------------------------------------------------------------------------

export function getDistrictRankingAllCases(db: Database, periodIds?: string[]): { rows: DistrictRankingRow[]; totalRow: Omit<DistrictRankingRow, "district"> } {
  const rows = activeDistricts(db)
    .map((district) => {
      const findings = db.findings.filter(
        (f) => f.districtId === district.id && f.status !== "REJECTED" && (!periodIds || periodIds.length === 0 || periodIds.includes(f.periodId))
      );
      const totalCases = findings.reduce((sum, f) => sum + f.caseCount, 0);
      const rectifiedCases = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
      return {
        district,
        totalBranches: districtBranchCount(db, district.id),
        totalCases,
        rectifiedCases,
        outstandingCases: totalCases - rectifiedCases,
        performance: totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null,
      };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  return { rows, totalRow: districtRankingTotalRow(rows) };
}

// ---------------------------------------------------------------------------
// 9. Category Performance Summary - bank-wide Unrectified/Rectified per
// category (all 7, not just the scored one), with the per-district
// percentage range and the bank-wide gross percentage.
// ---------------------------------------------------------------------------

export interface CategoryPerformanceRow {
  category: ClassifiedCategory;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
  minDistrictPct: number | null;
  maxDistrictPct: number | null;
  // The Excel's "Previous week" column - actually the same category's
  // gross percentage for the prior reporting period (chronologically, by
  // year/month), not a literal week. Only meaningful when a specific
  // periodId is given; null in "all periods" mode, or for the very first
  // period on record.
  previousPeriodPerformance: number | null;
}

function previousReportingPeriodId(db: Database, periodId: string): string | null {
  const periods = [...db.reportingPeriods].sort((a, b) => a.year - b.year || a.month - b.month);
  const idx = periods.findIndex((p) => p.id === periodId);
  return idx > 0 ? periods[idx - 1].id : null;
}

/** Renders a min/max district percentage pair the same way the source Excel does, e.g. "50% up to 99%". */
export function formatPercentageRange(minPct: number | null, maxPct: number | null): string {
  if (minPct === null || maxPct === null) return "--";
  return `${minPct.toFixed(0)}% up to ${maxPct.toFixed(0)}%`;
}

export function getCategoryPerformanceSummary(
  db: Database,
  periodId?: string
): { rows: CategoryPerformanceRow[]; totalRow: { totalCases: number; rectifiedCases: number; outstandingCases: number }; grossPercentage: number | null } {
  const districts = activeDistricts(db);
  const previousPeriodId = periodId ? previousReportingPeriodId(db, periodId) : null;

  function grossPercentageFor(categoryId: string, forPeriodId: string | null): number | null {
    const findings = db.findings.filter((f) => f.categoryId === categoryId && f.status !== "REJECTED" && (!forPeriodId || f.periodId === forPeriodId));
    const total = findings.reduce((sum, f) => sum + f.caseCount, 0);
    if (total === 0) return null;
    const rectified = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    return (rectified / total) * 100;
  }

  const rows: CategoryPerformanceRow[] = activeCategories(db).map((category) => {
    const findings = db.findings.filter((f) => f.categoryId === category.id && f.status !== "REJECTED" && (!periodId || f.periodId === periodId));
    const totalCases = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectifiedCases = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    const districtPcts = districts
      .map((d) => {
        const districtFindings = findings.filter((f) => f.districtId === d.id);
        const dTotal = districtFindings.reduce((sum, f) => sum + f.caseCount, 0);
        if (dTotal === 0) return null;
        const dRectified = districtFindings.reduce((sum, f) => sum + f.rectifiedCases, 0);
        return (dRectified / dTotal) * 100;
      })
      .filter((p): p is number => p !== null);
    return {
      category,
      totalCases,
      rectifiedCases,
      outstandingCases: totalCases - rectifiedCases,
      performance: totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null,
      minDistrictPct: districtPcts.length > 0 ? Math.min(...districtPcts) : null,
      maxDistrictPct: districtPcts.length > 0 ? Math.max(...districtPcts) : null,
      previousPeriodPerformance: previousPeriodId ? grossPercentageFor(category.id, previousPeriodId) : null,
    };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.totalCases, 0);
  const grandRectified = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);
  return {
    rows,
    totalRow: { totalCases: grandTotal, rectifiedCases: grandRectified, outstandingCases: grandTotal - grandRectified },
    grossPercentage: grandTotal > 0 ? (grandRectified / grandTotal) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// 10. Mid-Month District Snapshot - #4/#5's per-district Other-Case
// aggregation with an added "as of" cutoff date - a simple findingDate
// filter, deliberately not walking the transfer-eligibility chain
// (findingCasesEligibleInPeriod) since an arbitrary as-of date doesn't
// compose cleanly with that machinery, and the original report is itself
// just a plain date cutoff.
//
// Rectified credit is districtVerifiedCases, same as computeEligibleCaseCounts()
// - this snapshot already restricts to the active ScoringRule's own
// category+source gate below, so it's presenting itself as the official
// scored figure as of a cutoff date, not a broader raw lens (unlike #2/#7/
// #8/#9). A case only counts as rectified once the authorized person
// (District Controller) has accepted it - see computeEligibleCaseCounts()'s
// own doc comment in src/lib/findings.ts.
// ---------------------------------------------------------------------------

export function getDistrictSnapshotAsOf(
  db: Database,
  periodId: string,
  asOfDate: string
): { rows: DistrictRankingRow[]; totalRow: Omit<DistrictRankingRow, "district"> } {
  const rule = db.scoringRules.find((r) => r.active);
  const rows = activeDistricts(db)
    .map((district) => {
      const findings = db.findings.filter(
        (f) =>
          f.districtId === district.id &&
          f.periodId === periodId &&
          f.status !== "REJECTED" &&
          f.findingDate <= asOfDate &&
          (!rule || (rule.categories.includes(f.categoryId) && rule.sources.includes(f.sourceId)))
      );
      const totalCases = findings.reduce((sum, f) => sum + f.caseCount, 0);
      const rectifiedCases = findings.reduce((sum, f) => sum + f.districtVerifiedCases, 0);
      return {
        district,
        totalBranches: districtBranchCount(db, district.id),
        totalCases,
        rectifiedCases,
        outstandingCases: totalCases - rectifiedCases,
        performance: totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null,
      };
    })
    .sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  return { rows, totalRow: districtRankingTotalRow(rows) };
}
