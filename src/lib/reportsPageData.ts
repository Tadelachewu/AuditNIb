import { findingsInScope } from "@/lib/findings-scope";
import { computePerformance, computeEligibleCaseCounts, findingsResidentInPeriod, type FindingPeriodSlice } from "@/lib/findings";
import { paginate, parsePage } from "@/lib/pagination";
import { matchesOperationAndIrregularity } from "@/lib/dashboardFilters";
import { filterFindingsByText, sortFindings, parseFindingSort, parsePageSize } from "@/lib/findingListQuery";
import type { RankingRow } from "@/components/dashboard/RankingGrid";
import type { ReportFindingRow, TransferRow } from "@/components/reports/ReportGrids";
import type { SessionData } from "@/lib/session";
import type { Database, Finding } from "@/types";

/**
 * Everything the Reports page shows, for the current filters - shared by
 * the page (src/app/(app)/reports/page.tsx) and its full CSV export
 * (/api/reports/export), so the download always contains exactly the
 * page's data: findings, branch & district performance, category and risk
 * breakdowns, and transfers.
 */
export function buildReportsData(db: Database, user: SessionData, get: (key: string) => string) {
  let findings: Finding[] = findingsInScope(db, user);

  const periodId = get("periodId");
  const districtId = get("districtId");
  const branchId = get("branchId");
  const sourceId = get("sourceId");
  const categoryId = get("categoryId");
  const risk = get("risk");
  const operationArea = get("operationArea");
  const irregularityType = get("irregularityType");
  const status = get("status");
  const dateFrom = get("dateFrom");
  const dateTo = get("dateTo");

  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (operationArea || irregularityType) findings = findings.filter((f) => matchesOperationAndIrregularity(f, { operationArea, irregularityType }));
  if (status) findings = findings.filter((f) => f.status === status);
  // Today/This Week/This Month/Custom (TimeRangeFilter) - by each
  // finding's own findingDate, distinct from the reporting-period
  // dropdown above (a period is a monthly bucket; this is a free date
  // range within or across periods). Plain string comparison works since
  // both findingDate and dateFrom/dateTo are YYYY-MM-DD.
  if (dateFrom) findings = findings.filter((f) => f.findingDate >= dateFrom);
  if (dateTo) findings = findings.filter((f) => f.findingDate <= dateTo);

  // A period filter now includes a finding that has since transferred out
  // of it (paired with that period's own slice of its cases/amount), not
  // just findings still currently in it - see findingsResidentInPeriod()'s
  // doc comment. `findings` stays the flat list for the aggregates below
  // that don't need the slice (risk breakdown, transfers-in-scope);
  // `resident` carries the slice for the ones that do (findings table,
  // category breakdown - both must use the period-scoped numbers instead
  // of the finding's live lifetime totals, or a transferred finding would
  // be double-counted once in its origin period and again in its
  // destination period).
  type ResidentFinding = { finding: Finding; slice: FindingPeriodSlice | null };
  let resident: ResidentFinding[] = periodId
    ? findingsResidentInPeriod(db, periodId, findings)
    : findings.map((f) => ({ finding: f, slice: null }));
  resident = [...resident].sort((a, b) => b.finding.updatedAt.localeCompare(a.finding.updatedAt));
  findings = resident.map((r) => r.finding);

  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);

  const exportQuery = new URLSearchParams();
  const searchText = get("q");
  for (const [k, v] of Object.entries({ periodId, districtId, branchId, sourceId, categoryId, risk, status, operationArea, irregularityType, dateFrom, dateTo, q: searchText, sort: get("sort"), dir: get("dir") })) {
    if (v) exportQuery.set(k, v);
  }

  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "—";
  const categoryName = (id: string) => db.categories.find((c) => c.id === id)?.name ?? (id || "—");
  const sourceName = (id: string) => db.sources.find((s) => s.id === id)?.name ?? "—";
  const departmentName = (id: string) => db.departments.find((d) => d.id === id)?.name ?? "—";

  const inScopeBranches = user.orgScope === "BANK" ? db.branches : user.orgScope === "DISTRICT" ? db.branches.filter((b) => b.districtId === user.districtId) : branch ? [branch] : [];
  const inScopeDistricts = user.orgScope === "BANK" ? db.districts : district ? [district] : [];

  // Same numbers as the dashboards' ranking tables (RankingGrid): % plus
  // the eligible / solved / unsolved case counts behind it.
  const perfPeriod = periodId || undefined;
  function rankingRows(items: { id: string; name: string }[], kind: "branch" | "district"): RankingRow[] {
    return items
      .map((o) => {
        const scope = kind === "branch" ? { branchId: o.id, periodId: perfPeriod } : { districtId: o.id, periodId: perfPeriod };
        const counts = computeEligibleCaseCounts(db, scope);
        const totalCases = counts?.totalCases ?? 0;
        const rectifiedCases = counts?.rectifiedCases ?? 0;
        return {
          id: o.id,
          rank: 0,
          name: o.name,
          href: `/findings?${kind === "branch" ? "branchId" : "districtId"}=${o.id}`,
          branchCount: kind === "district" ? db.branches.filter((b) => b.districtId === o.id).length : undefined,
          totalCases,
          rectifiedCases,
          outstandingCases: totalCases - rectifiedCases,
          performance: computePerformance(db, scope),
        };
      })
      .filter((r) => r.performance !== null)
      .sort((a, b) => (b.performance ?? 0) - (a.performance ?? 0))
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
  const branchPerformance = rankingRows(inScopeBranches, "branch");

  const districtPerformance = rankingRows(inScopeDistricts, "district");

  const categoryBreakdown = db.categories
    .filter((c) => c.active)
    .map((c) => {
      const catEntries = resident.filter((r) => r.finding.categoryId === c.id);
      // Period-scoped (slice.eligibleCases/closedCases) when a period is
      // filtered, so a transferred finding's cases count toward exactly one
      // period's total here too - unchanged (live caseCount/rectifiedCases)
      // when no period is selected, same as before this fix.
      const total = catEntries.reduce((sum, r) => sum + (r.slice ? r.slice.eligibleCases : r.finding.caseCount), 0);
      // Rectified = formally closed, in both modes (same basis as every official figure).
      const rectified = catEntries.reduce((sum, r) => sum + (r.slice ? r.slice.closedCases : r.finding.closedCases), 0);
      return { category: c, total, rectified, outstanding: total - rectified };
    });

  const riskBreakdown = db.settings.riskLevels.map((r) => ({
    risk: r,
    count: findings.filter((f) => f.riskLevel === r).length,
  }));

  const findingIdsInScope = new Set(findings.map((f) => f.id));
  const transfers = db.findingTransfers
    .filter((t) => findingIdsInScope.has(t.findingId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const transferRows: TransferRow[] = transfers.map((t) => {
    const finding = db.findings.find((f) => f.id === t.findingId);
    return {
      id: t.id,
      findingId: t.findingId,
      reference: finding?.reference ?? t.findingId,
      fromCode: db.reportingPeriods.find((p) => p.id === t.fromPeriodId)?.code ?? t.fromPeriodId,
      toCode: db.reportingPeriods.find((p) => p.id === t.toPeriodId)?.code ?? t.toPeriodId,
      currency: finding?.currency ?? "",
      originalAmount: t.originalAmount,
      outstandingAmount: t.amountTransferred,
      originalCases: t.originalCaseCount,
      outstandingCases: t.casesTransferred,
      caseAgeDays: t.caseAgeAtTransferDays,
      method: t.method,
      createdByName: t.createdByName,
      createdAt: t.createdAt,
      reason: t.reason,
    };
  });

  // Findings Report: search / sort / page applied server-side, exactly as
  // the Findings list does (src/lib/findingListQuery.ts), so its Export
  // CSV (/api/findings/export) returns what the grid shows. The aggregates
  // above use every filtered finding, not just the searched ones.
  const names = { branchName, departmentName, categoryName, sourceName };
  const sort = parseFindingSort(get("sort"), get("dir"));
  const amountOf = (r: ResidentFinding) => (r.slice ? r.slice.eligibleAmount : r.finding.amount);
  const listed = sortFindings(filterFindingsByText(resident, searchText, names), sort, names, amountOf);
  const findingsPage = paginate(listed, parsePage(get("page")), parsePageSize(get("pageSize")));
  const findingRows: ReportFindingRow[] = findingsPage.items.map(({ finding: f, slice }) => ({
    id: f.id,
    reference: f.reference,
    title: f.title,
    branchName: branchName(f.branchId),
    departmentName: departmentName(f.departmentId),
    categoryName: categoryName(f.categoryId),
    sourceName: sourceName(f.sourceId),
    currency: f.currency,
    amount: amountOf({ finding: f, slice }),
    outstanding: slice ? slice.eligibleAmount - slice.closedAmount : f.amount - f.rectifiedAmount,
    status: f.status,
    isHistorical: slice ? !slice.isCurrentPeriod : false,
    transferredOutToCode: slice?.transferredOutToCode ?? null,
  }));


  return {
    findings,
    listed,
    amountOf,
    names,
    periodId,
    district,
    branch,
    exportQuery,
    searchText,
    sort,
    findingsPage,
    findingRows,
    branchPerformance,
    districtPerformance,
    categoryBreakdown,
    riskBreakdown,
    transferRows,
  };
}
