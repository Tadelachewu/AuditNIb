import { computeEligibleCaseCounts, caseAgeDays, findingsResidentInPeriod, isHoApproved } from "@/lib/findings";
import { formatNumber } from "@/lib/format";
import type { Database, Branch, District, ReportingPeriod, ClassifiedCategory, BranchCoverageNote, Finding, Source } from "@/types";

// The 10 named Internal Control Division report templates (see report/*.xlsx,
// already relabeled with these exact names), plus #11 Transferred Findings
// (not sourced from a bank Excel sheet - a bank-wide register of Document_3
// §15's own Transfer Data, requested directly rather than modeled on a
// legacy report) - as pure aggregation functions over the existing
// Finding/District/Branch data - nothing here is stored separately (aside
// from BranchCoverageNote, the one genuinely writable piece - see #1), so
// every number is always live and can never drift from what the Findings
// list itself shows.

// Slug <-> permission action <-> display copy lives in reportTemplateMeta.ts
// (client-safe); re-exported here for existing server-side imports.
export { REPORT_TEMPLATES, type ReportTemplateMeta } from "@/lib/reportTemplateMeta";

function activeBranches(db: Database): Branch[] {
  return db.branches.filter((b) => b.status === "ACTIVE");
}
/**
 * Districts a report lists: every active district, plus any deactivated
 * one that still has findings - deactivating a district must not make its
 * findings vanish from the bank's totals.
 */
function reportDistricts(db: Database): District[] {
  const withFindings = new Set(db.findings.map((f) => f.districtId));
  return db.districts.filter((d) => d.status === "ACTIVE" || withFindings.has(d.id));
}

/** Local calendar date (YYYY-MM-DD) of a timestamp - same basis as findingDate and the period codes. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Cases formally closed on or before `asOfDate` (optionally only closures stamped to one period). */
function closedAsOf(db: Database, findingId: string, asOfDate: string, periodId?: string): number {
  return db.findingClosures
    .filter((c) => c.findingId === findingId && (!periodId || c.periodId === periodId) && localDay(c.createdAt) <= asOfDate)
    .reduce((sum, c) => sum + c.closedCases, 0);
}

/**
 * Case / closed / amount totals for a set of findings: one period's share
 * (residency - a transferred finding counts in exactly one period), or,
 * with no period ("All periods"), the lifetime totals - which equal the
 * sum of every period's share. "Closed" is formal closure, the one
 * "rectified" basis every official figure uses.
 */
function scopedTotals(db: Database, periodId: string | undefined, findings: Finding[]): { cases: number; closed: number; amount: number } {
  if (!periodId) {
    return {
      cases: findings.reduce((s, f) => s + f.caseCount, 0),
      closed: findings.reduce((s, f) => s + f.closedCases, 0),
      amount: findings.reduce((s, f) => s + f.amount, 0),
    };
  }
  const resident = findingsResidentInPeriod(db, periodId, findings);
  return {
    cases: resident.reduce((s, r) => s + r.slice.eligibleCases, 0),
    closed: resident.reduce((s, r) => s + r.slice.closedCases, 0),
    amount: resident.reduce((s, r) => s + r.slice.eligibleAmount, 0),
  };
}

/** Human-readable note of a template's configured source filter, or null when every source is included. */
export function templateSourceNote(db: Database, templateSlug: string): string | null {
  const ids = getTemplateSourceIds(db, templateSlug);
  if (!ids) return null;
  const names = ids.map((id) => {
    const src = db.sources.find((x) => x.id === id);
    return src ? `${src.name} (${src.code})` : id;
  });
  return `Only findings from: ${names.join(", ")} (set in Settings → Report Template Sources). Other sources are not counted in this report.`;
}

// Per-template source inclusion filter: returns the configured source IDs
// for `templateSlug`, or `undefined` when the template has no explicit
// configuration (meaning "include every source" - the backward-compatible
// default). Callers use `appliesSourceFilter` below to narrow a candidate
// finding pool to only the configured sources, or pass the returned IDs
// to computeEligibleCaseCounts via PerformanceScope.sourceIds.
//
// Settings.reportTemplateSources[slug] is either absent (no override) or
// an array of Source IDs. An empty array is treated the same as absent
// (no one configures a template to include zero sources - that would
// zero out the whole report, so we treat it as a no-op instead of
// silently returning an all-empty sheet).
function getTemplateSourceIds(db: Database, templateSlug: string): string[] | undefined {
  const configured = db.settings.reportTemplateSources[templateSlug];
  if (!configured || configured.length === 0) return undefined;
  return configured;
}

// Applies the template's configured source filter (if any) to an in-memory
// finding array. Used by every template that builds its own candidate pool
// with a plain db.findings.filter(...) instead of going through
// computeEligibleCaseCounts - which instead takes sourceIds directly via
// PerformanceScope so the FIFO transfer-case segmentation fix still
// applies to the narrowed population.
function applySourceFilter(db: Database, templateSlug: string, findings: Finding[]): Finding[] {
  const ids = getTemplateSourceIds(db, templateSlug);
  if (!ids) return findings;
  return findings.filter((f) => ids.includes(f.sourceId));
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

export function getUncoveredBranches(db: Database, periodId: string | undefined): UncoveredBranchRow[] {
  // A branch that submitted a finding, part of which was rectified before
  // the rest transferred onward, genuinely was covered this period - a raw
  // f.periodId === periodId check would call it "uncovered" the moment
  // that finding transfers away, which is wrong (see
  // findingsResidentInPeriod()'s own doc comment).
  //
  // Excludes bank-scope-registered and bulk-imported findings from the
  // candidate pool: neither reflects the BRANCH's own live reporting
  // activity this period - a bank-scope finding was registered by HO on
  // the branch's behalf (registeredByBankScope), and an imported row is a
  // historical backfill (importBatchId set), not something the branch
  // itself submitted now. A branch whose only activity this period is one
  // of these should still show up here as not having done its own
  // reporting, even though a Finding row technically exists against it.
  let coverageCandidates = db.findings.filter((f) => !f.registeredByBankScope && !f.importBatchId);
  coverageCandidates = applySourceFilter(db, "uncovered-branches", coverageCandidates);
  // No period ("All periods"): covered if the branch reported in any period.
  const coveredBranchIds = new Set(
    (periodId ? findingsResidentInPeriod(db, periodId, coverageCandidates).map((r) => r.finding) : coverageCandidates).map((f) => f.branchId)
  );
  return activeBranches(db)
    .filter((b) => !coveredBranchIds.has(b.id))
    .map((b) => ({
      branch: b,
      district: db.districts.find((d) => d.id === b.districtId),
      note: periodId ? (db.branchCoverageNotes.find((n) => n.branchId === b.id && n.periodId === periodId) ?? null) : null,
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
  periodId: string | undefined
): {
  rows: CategoryDetailRow[];
  categories: ClassifiedCategory[];
  totalRow: { totalCases: number; totalRectified: number; totalOutstanding: number; rectifiedPct: number | null };
} {
  const categories = activeCategories(db);
  const sourceFilteredFindings = applySourceFilter(db, "category-detail-by-district", db.findings);
  const rows: CategoryDetailRow[] = reportDistricts(db).map((district) => {
    const perCategory = categories.map((category) => {
      // isHoApproved() gate - a finding still in DISTRICT_REVIEW/HO_REVIEW
      // (or REJECTED/RETURNED) isn't official yet and shouldn't count
      // toward a district's reported totals before anyone's actually
      // approved it, same gate every dashboard "official" figure applies.
      const candidates = sourceFilteredFindings.filter((f) => f.districtId === district.id && f.categoryId === category.id && isHoApproved(f));
      // Period-scoped (eligibleCases/closedCases), not the finding's live
      // lifetime caseCount/rectifiedCases - a transferred finding must
      // count toward exactly one period's total, never zero or two (see
      // findingsResidentInPeriod()'s doc comment).
      const { cases: total, closed: rectified } = scopedTotals(db, periodId, candidates);
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
// 3. Monthly Summary Report - one total-case count per category, plus amount
// involved, branch dispatch coverage from #1, and the district's official
// BRD score (computeEligibleCaseCounts - the Other Case category is the
// only one the bank's own workflow ever tracks rectification against).
//
// Unrectified/Rectified/Rectified % are ALL scoped to that same official,
// scored-category population - not summed across every category the way
// the per-category grid is. Rectified was already computeEligibleCaseCounts-
// based; Unrectified was previously a sum of every category's own
// outstanding count (a different, broader scope than Rectified's), which
// made the two figures on the same row not actually comparable to each
// other despite sitting side by side. Both now come from the same
// officialCounts call, so Unrectified + Rectified = officialCounts.totalCases
// exactly, matching what "Rectified %" is already a percentage of.
//
// The per-category grid shows each category's own TOTAL case count (not
// just what's still outstanding in it) - this is what keeps every category
// besides the scored one visible on this sheet at all, now that the row's
// own Unrectified/Rectified no longer aggregate across them.
// ---------------------------------------------------------------------------

export interface MonthlySummaryCell {
  category: ClassifiedCategory;
  total: number;
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
  periodId: string | undefined
): {
  rows: MonthlySummaryRow[];
  categories: ClassifiedCategory[];
  totalRow: { totalOutstanding: number; officialRectified: number; totalAmount: number; totalCases: number };
} {
  const categories = activeCategories(db);
  const uncovered = getUncoveredBranches(db, periodId);
  const templateSourceIds = getTemplateSourceIds(db, "monthly-summary");
  const sourceFilteredFindings = applySourceFilter(db, "monthly-summary", db.findings);
  const rows: MonthlySummaryRow[] = reportDistricts(db).map((district) => {
    // Period-scoped residency (see findingsResidentInPeriod()'s doc
    // comment) - not a raw f.periodId === periodId filter, which would
    // drop a finding's slice of this period the moment it transfers away.
    // isHoApproved() gate on top, same as every other "official" figure.
    const districtFindings = sourceFilteredFindings.filter((f) => f.districtId === district.id && isHoApproved(f));
    const perCategory = categories.map((category) => ({
      category,
      total: scopedTotals(db, periodId, districtFindings.filter((f) => f.categoryId === category.id)).cases,
    }));
    const districtTotals = scopedTotals(db, periodId, districtFindings);
    const totalCases = districtTotals.cases;
    const officialCounts = computeEligibleCaseCounts(db, { districtId: district.id, periodId, sourceIds: templateSourceIds });
    // Same eligible/scored population Rectified already draws from - not
    // a sum across every category the way perCategory is (see this
    // function's own doc comment above).
    const totalOutstanding = officialCounts ? officialCounts.totalCases - officialCounts.rectifiedCases : 0;
    const totalBranches = districtBranchCount(db, district.id);
    const notDispatched = uncovered.filter((u) => u.district?.id === district.id).length;
    const amountInvolved = districtTotals.amount;
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
// Two structurally different series, matching the source Excel's own
// "Detail monthly summaryBD" sheet exactly (cross-checked against
// report/.backup/Summarized unrectified Irreg report-*.xlsx's raw cell
// data, not just its cached-formula values):
//
//   (a) otherCases — one row per district PER PERIOD, the official scored
//       metric (what #6, #9, the BRD, and computeEligibleCaseCounts()
//       track). This is the whole series Monthly District History uses.
//   (b) various ("Various internal Audit report") — exactly ONE row per
//       district, a lifetime/cumulative rollup of the district's Other
//       Case findings that came from the Internal Audit source
//       specifically (source code "IA") - not the per-period Internal
//       Control cadence (a) already tracks. icfms.txt: "Internal Audit
//       findings will initially be entered into the system by Head Office
//       Internal Controllers" - occasional/ad-hoc, not a monthly cadence,
//       hence one cumulative line instead of a row per period. In the
//       source sheet this is literally the last row of each district's
//       block - no Month value at all - and its total/rectified feed
//       straight into that district's subtotal alongside the period rows.
//       "Rectified" here means formally CLOSED (closedCases), the same
//       verified-only basis every other official figure in this file
//       uses - not the branch's raw self-reported rectifiedCases. Monthly
//       District Detail (#5) is the only page that renders it; Monthly
//       District History (#4) has never shown it at all (Other-Case only).
// ---------------------------------------------------------------------------

export interface DistrictPeriodRow {
  period: ReportingPeriod;
  district: District;
  totalBranches: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
}

/**
 * "All periods" view of Monthly District History: each district's rows
 * summed across every period. Each case is counted in exactly one period
 * (a transferred case moves to its destination period), so the sum never
 * double-counts; performance is recomputed from the summed counts, not
 * averaged from the monthly percentages.
 */
export type DistrictTotalRow = Omit<DistrictPeriodRow, "period">;

export function sumDistrictRowsAcrossPeriods(rows: DistrictPeriodRow[]): DistrictTotalRow[] {
  const byDistrict = new Map<string, DistrictTotalRow>();
  for (const r of rows) {
    const t = byDistrict.get(r.district.id) ?? { district: r.district, totalBranches: r.totalBranches, totalCases: 0, rectifiedCases: 0, outstandingCases: 0, performance: null };
    t.totalCases += r.totalCases;
    t.rectifiedCases += r.rectifiedCases;
    t.outstandingCases += r.outstandingCases;
    byDistrict.set(r.district.id, t);
  }
  return [...byDistrict.values()].map((t) => ({ ...t, performance: t.totalCases > 0 ? (t.rectifiedCases / t.totalCases) * 100 : null }));
}

export interface DistrictVariousRow {
  district: District;
  totalBranches: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
}

export function getMonthlyDistrictSeries(
  db: Database,
  templateSlug: "monthly-district-history" | "monthly-district-detail" = "monthly-district-detail"
): { otherCases: DistrictPeriodRow[]; various: DistrictVariousRow[] } {
  const rule = db.scoringRules.find((r) => r.active);
  const periods = [...db.reportingPeriods].sort((a, b) => a.year - b.year || a.month - b.month);
  const districts = reportDistricts(db);
  const templateSourceIds = getTemplateSourceIds(db, templateSlug);
  const sourceFilteredFindings = applySourceFilter(db, templateSlug, db.findings);

  const otherCases: DistrictPeriodRow[] = [];
  for (const period of periods) {
    for (const district of districts) {
      // Official "Other Cases" bucket — ScoringRule gated, exactly the
      // same series the history/ranking pages show.
      const eligible = computeEligibleCaseCounts(db, { districtId: district.id, periodId: period.id, sourceIds: templateSourceIds });
      const otherTotal = eligible?.totalCases ?? 0;
      const otherRectified = eligible?.rectifiedCases ?? 0;
      otherCases.push({
        period,
        district,
        totalBranches: districtBranchCount(db, district.id),
        totalCases: otherTotal,
        rectifiedCases: otherRectified,
        outstandingCases: otherTotal - otherRectified,
        performance: eligible && eligible.totalCases > 0 ? (eligible.rectifiedCases / eligible.totalCases) * 100 : null,
      });
    }
  }

  // "Various internal Audit report" — the district's Other Case findings
  // that came from the Internal Audit source specifically, lifetime (see
  // this block's own doc comment above for why it's not period-scoped).
  // Requires both an active ScoringRule (to know which category is
  // "Other Case") and a Source coded "IA" to exist at all - with either
  // missing there's no "eligible, Internal-Audit-sourced Other Case"
  // population to report, so every district shows zero rather than
  // falling back to some broader, less precise population.
  //
  // The template's configured source filter also applies here: if the
  // admin excluded the IA source from this template's scope, the various
  // row naturally stays all-zero rather than sneaking in a source the
  // template was meant to omit entirely.
  const iaSource = db.sources.find((s) => s.code.toUpperCase() === "IA");
  const various: DistrictVariousRow[] = districts.map((district) => {
    let variousTotal = 0;
    let variousRectified = 0;
    if (rule && iaSource && (!templateSourceIds || templateSourceIds.includes(iaSource.id))) {
      const findings = sourceFilteredFindings.filter(
        (f) => f.districtId === district.id && isHoApproved(f) && rule.categories.includes(f.categoryId) && f.sourceId === iaSource.id
      );
      variousTotal = findings.reduce((s, f) => s + f.caseCount, 0);
      variousRectified = findings.reduce((s, f) => s + f.closedCases, 0);
    }
    return {
      district,
      totalBranches: districtBranchCount(db, district.id),
      totalCases: variousTotal,
      rectifiedCases: variousRectified,
      outstandingCases: variousTotal - variousRectified,
      performance: variousTotal > 0 ? (variousRectified / variousTotal) * 100 : null,
    };
  });

  return { otherCases, various };
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
  const templateSourceIds = getTemplateSourceIds(db, "district-ranking-other-cases");
  const rows: DistrictRankingRow[] = reportDistricts(db)
    .map((district) => {
      let totalCases = 0;
      let rectifiedCases = 0;
      if (periodIds && periodIds.length > 0) {
        for (const periodId of periodIds) {
          const counts = computeEligibleCaseCounts(db, { districtId: district.id, periodId, sourceIds: templateSourceIds });
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
        const counts = computeEligibleCaseCounts(db, { districtId: district.id, sourceIds: templateSourceIds });
        if (counts) {
          totalCases = counts.totalCases;
          rectifiedCases = counts.rectifiedCases;
        }
      }
      const formula = totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null;
      return {
        district,
        totalBranches: districtBranchCount(db, district.id),
        totalCases,
        rectifiedCases,
        outstandingCases: totalCases - rectifiedCases,
        performance: formula,
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
// see the plan doc for that tradeoff.
//
// Both cutoff dates are caller-overridable (the page offers two date
// pickers) - defaulting to the real Monday-start current/last calendar
// week (matching TimeRangeFilter's own "This Week" preset) when omitted,
// but a reviewer can point either cutoff at any date to reproduce a past
// week-over-week comparison, not just the live rolling one.
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

/** ISO date for the Monday-start week ending `weeksAgo` weeks before today (0 = this week). Exported so the page can default its two date pickers to the same real calendar week this function itself defaults to. */
export function weekEndDate(weeksAgo: number): string {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday - weeksAgo * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday.toISOString().slice(0, 10);
}

export function getWeeklyExecutiveSummary(
  db: Database,
  thisWeekCutoff: string = weekEndDate(0),
  lastWeekCutoff: string = weekEndDate(1)
): WeeklyCategorySummary[] {
  const districts = reportDistricts(db);
  const sourceFilteredFindings = applySourceFilter(db, "weekly-executive-summary", db.findings);

  function cumulativeAsOf(categoryId: string, districtId: string, asOfDate: string): { totalCases: number; rectifiedCases: number } {
    // isHoApproved() gate, same as every other "official" figure - a
    // still-in-review or rejected finding shouldn't move this week's
    // reported balance before it's actually cleared approval.
    const findings = sourceFilteredFindings.filter(
      (f) => f.categoryId === categoryId && f.districtId === districtId && isHoApproved(f) && f.findingDate <= asOfDate
    );
    // Rectified = formally closed on or before the cutoff, so last week's
    // column isn't inflated by closures that happened this week.
    return {
      totalCases: findings.reduce((sum, f) => sum + f.caseCount, 0),
      rectifiedCases: findings.reduce((sum, f) => sum + closedAsOf(db, f.id, asOfDate), 0),
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
  const sourceFilteredFindings = applySourceFilter(db, "district-ranking-all-cases", db.findings);
  const rows = reportDistricts(db)
    .map((district) => {
      // isHoApproved() gate - a finding still short of HO approval (or
      // rejected/returned) isn't official yet and shouldn't count toward
      // this ranking, same gate #6/every dashboard "official" figure uses.
      const candidates = sourceFilteredFindings.filter((f) => f.districtId === district.id && isHoApproved(f));
      let totalCases: number;
      let rectifiedCases: number;
      if (periodIds && periodIds.length > 0) {
        // Sum each selected period's own residency slice (see
        // findingsResidentInPeriod()'s doc comment) rather than a raw
        // periodIds.includes(f.periodId) filter, so a finding that
        // transferred between two selected periods is credited to each
        // one's own share, not dropped from the one it left.
        totalCases = 0;
        rectifiedCases = 0;
        for (const pid of periodIds) {
          const resident = findingsResidentInPeriod(db, pid, candidates);
          totalCases += resident.reduce((sum, r) => sum + r.slice.eligibleCases, 0);
          rectifiedCases += resident.reduce((sum, r) => sum + r.slice.closedCases, 0);
        }
      } else {
        // No period filter - lifetime totals, unchanged from before.
        // No period filter - lifetime totals; rectified = formally closed.
        const t = scopedTotals(db, undefined, candidates);
        totalCases = t.cases;
        rectifiedCases = t.closed;
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
  const districts = reportDistricts(db);
  const previousPeriodId = periodId ? previousReportingPeriodId(db, periodId) : null;
  const sourceFilteredFindings = applySourceFilter(db, "category-performance-summary", db.findings);

  // Period-scoped residency (see findingsResidentInPeriod()'s doc comment)
  // when a period is given, so a transferred finding counts toward exactly
  // one period's total here too - unchanged (live caseCount/rectifiedCases)
  // in "all periods" mode, same as before this fix.
  function periodTotals(candidates: Finding[], forPeriodId: string | null): { total: number; rectified: number } {
    const t = scopedTotals(db, forPeriodId ?? undefined, candidates);
    return { total: t.cases, rectified: t.closed };
  }

  function grossPercentageFor(categoryId: string, forPeriodId: string | null): number | null {
    // isHoApproved() gate, same as every other "official" figure here.
    const candidates = sourceFilteredFindings.filter((f) => f.categoryId === categoryId && isHoApproved(f));
    const { total, rectified } = periodTotals(candidates, forPeriodId);
    if (total === 0) return null;
    return (rectified / total) * 100;
  }

  const rows: CategoryPerformanceRow[] = activeCategories(db).map((category) => {
    const candidates = sourceFilteredFindings.filter((f) => f.categoryId === category.id && isHoApproved(f));
    const { total: totalCases, rectified: rectifiedCases } = periodTotals(candidates, periodId ?? null);
    const districtPcts = districts
      .map((d) => {
        const { total: dTotal, rectified: dRectified } = periodTotals(
          candidates.filter((f) => f.districtId === d.id),
          periodId ?? null
        );
        if (dTotal === 0) return null;
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
// Rectified credit is closedCases, same as computeEligibleCaseCounts() -
// this snapshot already restricts to the active ScoringRule's own
// category+source gate below, so it's presenting itself as the official
// scored figure as of a cutoff date, not a broader raw lens (unlike #2/#7/
// #8/#9). A case only counts as rectified once it's formally closed, not
// merely district-verified - see computeEligibleCaseCounts()'s own doc
// comment in src/lib/findings.ts.
// ---------------------------------------------------------------------------

export function getDistrictSnapshotAsOf(
  db: Database,
  periodId: string,
  asOfDate: string
): { rows: DistrictRankingRow[]; totalRow: Omit<DistrictRankingRow, "district"> } {
  const rule = db.scoringRules.find((r) => r.active);
  const templateSourceIds = getTemplateSourceIds(db, "mid-month-district-snapshot");
  const rows = reportDistricts(db)
    .map((district) => {
      // isHoApproved() gate - this snapshot presents itself as the official
      // scored figure as of a cutoff date (see this function's own doc
      // comment), so it needs the same gate computeEligibleCaseCounts()
      // itself applies, not just a REJECTED exclusion.
      // This period's own share of each finding (residency - so a finding
      // that later transferred on still counts here for what stayed), only
      // findings dated on/before the cutoff, and only closures made in this
      // period on/before the cutoff. With a cutoff at or after today this
      // equals the official period figure (computeEligibleCaseCounts).
      const candidates = db.findings.filter(
        (f) =>
          f.districtId === district.id &&
          isHoApproved(f) &&
          f.findingDate <= asOfDate &&
          (!rule || (rule.categories.includes(f.categoryId) && rule.sources.includes(f.sourceId))) &&
          (!templateSourceIds || templateSourceIds.includes(f.sourceId))
      );
      const resident = findingsResidentInPeriod(db, periodId, candidates);
      const totalCases = resident.reduce((sum, r) => sum + r.slice.eligibleCases, 0);
      const rectifiedCases = resident.reduce((sum, r) => sum + closedAsOf(db, r.finding.id, asOfDate, periodId), 0);
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
// 11. Transferred Findings - a bank-wide, one-row-per-hop register of every
// FindingTransfer record: the exact Document_3 §15 "Transfer Data" field
// set already shown per-finding on FindingDetailClient.tsx's own "Transfer
// History" card, now aggregated across every finding and period so a
// reviewer doesn't have to open findings one at a time to see what
// transferred, from where, to where, and what's happened since.
//
// Three layers of detail per row, matching what was asked for:
//   - Original period data: fromPeriod, the finding's originalCaseCount/
//     originalAmount and caseAgeAtTransferDays AS OF that hop (all
//     snapshotted on the FindingTransfer row itself, never recomputed).
//   - What happened on it (before it left): resolvedBeforeTransferCases/
//     Amount = originalCaseCount/Amount minus casesTransferred/
//     amountTransferred - the portion rectified in the origin period,
//     never carried forward.
//   - Where it transfers, and its status today: toPeriod plus the
//     finding's live, current-day state (status/outstanding/case age) -
//     not snapshotted at transfer time, so this reflects everything that's
//     happened since, all the way up to now, including any later hop.
// ---------------------------------------------------------------------------

export interface TransferredFindingRow {
  transfer: Database["findingTransfers"][number];
  finding: Finding;
  district: District | undefined;
  branch: Branch | undefined;
  category: ClassifiedCategory | undefined;
  source: Source | undefined;
  fromPeriod: ReportingPeriod | undefined;
  toPeriod: ReportingPeriod | undefined;
  resolvedBeforeTransferCases: number;
  resolvedBeforeTransferAmount: number;
  // This finding's own transfer sequence - 1-based position among ALL of
  // its FindingTransfer rows, chronological, and whether this is the most
  // recent one (a finding transferred more than once shows every hop as
  // its own row, newest transfers first overall - see the final sort
  // below).
  hopNumber: number;
  totalHops: number;
  isLatestHop: boolean;
  currentStatus: Finding["status"];
  currentOutstandingCases: number;
  currentOutstandingAmount: number;
  caseAgeDaysNow: number;
}

export function getTransferredFindings(
  db: Database,
  filters?: { fromPeriodId?: string; toPeriodId?: string }
): TransferredFindingRow[] {
  const templateSourceIds = getTemplateSourceIds(db, "transferred-findings");
  const hopsByFinding = new Map<string, Database["findingTransfers"]>();
  for (const t of db.findingTransfers) {
    const list = hopsByFinding.get(t.findingId) ?? [];
    list.push(t);
    hopsByFinding.set(t.findingId, list);
  }
  for (const list of hopsByFinding.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return db.findingTransfers
    .filter(
      (t) =>
        (!filters?.fromPeriodId || t.fromPeriodId === filters.fromPeriodId) &&
        (!filters?.toPeriodId || t.toPeriodId === filters.toPeriodId)
    )
    .map((t): TransferredFindingRow | null => {
      const finding = db.findings.find((f) => f.id === t.findingId);
      if (!finding) return null;
      // Source filter applied at the finding level rather than transfer
      // level - a transfer's "source" is always the underlying finding's
      // source (sources are a finding-level attribute, not per-hop).
      // If this template has configured sources and the finding's source
      // isn't among them, drop the whole hop row rather than silently
      // rendering it with a mismatched source column.
      if (templateSourceIds && !templateSourceIds.includes(finding.sourceId)) return null;
      const hops = hopsByFinding.get(t.findingId) ?? [t];
      const hopNumber = hops.findIndex((h) => h.id === t.id) + 1;
      return {
        transfer: t,
        finding,
        district: db.districts.find((d) => d.id === finding.districtId),
        branch: db.branches.find((b) => b.id === finding.branchId),
        category: db.categories.find((c) => c.id === finding.categoryId),
        source: db.sources.find((s) => s.id === finding.sourceId),
        fromPeriod: db.reportingPeriods.find((p) => p.id === t.fromPeriodId),
        toPeriod: db.reportingPeriods.find((p) => p.id === t.toPeriodId),
        resolvedBeforeTransferCases: t.originalCaseCount - t.casesTransferred,
        resolvedBeforeTransferAmount: t.originalAmount - t.amountTransferred,
        hopNumber,
        totalHops: hops.length,
        isLatestHop: hopNumber === hops.length,
        currentStatus: finding.status,
        // Outstanding = not yet formally closed (same basis as the dashboards).
        currentOutstandingCases: finding.caseCount - finding.closedCases,
        currentOutstandingAmount: finding.amount - finding.closedAmount,
        caseAgeDaysNow: caseAgeDays(finding),
      };
    })
    .filter((r): r is TransferredFindingRow => r !== null)
    .sort((a, b) => b.transfer.createdAt.localeCompare(a.transfer.createdAt));
}
