import { caseAgeIndex } from "@/lib/caseAge";
import Link from "next/link";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { queueStatusesForSession, findingsResidentInPeriod, type FindingPeriodSlice, registeredAmountOf } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { paginate, parsePage } from "@/lib/pagination";
import { filterFindingsByStatus, filterFindingsByText, sortFindings, parseFindingSort, parsePageSize } from "@/lib/findingListQuery";
import { inDateRange } from "@/lib/dateRange";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { FindingsTable, type FindingRow } from "@/components/findings/FindingsTable";
import { isAwaitingClose } from "@/components/findings/FindingStatusBadge";
import { getPreference } from "@/lib/userPreferences";
import { isAwaitingDistrict } from "@/lib/rectificationResubmit";
import { FILTERABLE_FINDING_STATUSES, type Finding } from "@/types";
import { matchesOperationAndIrregularity } from "@/lib/dashboardFilters";
import { currentPeriod, resolvePeriodFilter, sortPeriods } from "@/lib/periods";
import { ALL_PERIODS_VALUE } from "@/lib/dashboardFilters";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  if (!hasPermission(user.permissions, permissionKey("findings", "view"))) redirect("/dashboard");

  const params = await searchParams;
  const get = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const queueOnly = get("queue") === "1";

  const db = await readDb();
  let findings: Finding[] = findingsInScope(db, user);

  // No period chosen -> the current period; "ALL" -> every period.
  // My Queue shows everything waiting for you, whatever its period, unless
  // a period is chosen explicitly.
  const periodId = queueOnly && !get("periodId") ? "" : resolvePeriodFilter(db.reportingPeriods, get("periodId"));
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
  // Comma-separated to support the Status Distribution donut's multi-status
  // buckets (e.g. "Draft / In Review" spans 6 statuses) linking here with
  // one query param - a single status value still works unchanged since
  // split(",") on a value with no comma just returns that one value.
  // Status is matched per row, after the period is applied (filterFindingsByStatus):
  // in a period the finding has left, its status there is Transferred.
  // Optional Today/This Week/This Month/Custom filter (TimeRangeFilter) -
  // by each finding's own findingDate, same convention as the Reports page.
  if (dateFrom || dateTo) findings = findings.filter((f) => inDateRange({ from: dateFrom || undefined, to: dateTo || undefined }, f.findingDate));

  // A period filter no longer means "still currently in that period" -
  // findingsResidentInPeriod() also surfaces a finding that transferred out
  // of it, paired with that period's own slice of its cases/amount, so
  // period A's list still shows the work that genuinely happened there
  // (see the function's own doc comment). Without a period filter, nothing
  // changes - every finding still shows once, using its live fields.
  type ResidentFinding = { finding: Finding; slice: FindingPeriodSlice | null };
  let resident: ResidentFinding[] = periodId
    ? findingsResidentInPeriod(db, periodId, findings)
    : findings.map((f) => ({ finding: f, slice: null }));

  resident = filterFindingsByStatus(resident, status);

  // current=1 (from a dashboard chart click): only findings currently in the
  // period - the same set the dashboard counted, not ones that moved on.
  if (periodId && get("current") === "1") resident = resident.filter((r) => r.slice === null || r.slice.isCurrentPeriod);

  const isQueued = queueStatusesForSession(user, db);
  if (queueOnly) resident = resident.filter((r) => (r.slice === null || r.slice.isCurrentPeriod) && isQueued(r.finding));

  // The table's own search box (q) and column sort (sort + dir) - applied
  // here, server-side, across every matching finding rather than just the
  // visible page; the CSV export reuses the same helpers so it always
  // matches the list (src/lib/findingListQuery.ts).
  const caseAge = caseAgeIndex(db);
  const names = { districtName, branchName, departmentName, categoryName, sourceName, periodCode, caseAge };
  const searchText = get("q");
  const sort = parseFindingSort(get("sort"), get("dir"));
  resident = filterFindingsByText(resident, searchText, names);
  resident = sortFindings(resident, sort, names, (r) => (r.slice ? r.slice.eligibleAmount : r.finding.amount));

  // Server-side pagination: only the current page's rows are ever
  // rendered/sent to the client, no matter how large the filtered result
  // set grows - the Findings table is the one dataset in this app with
  // genuinely unbounded growth (every registered finding, forever).
  const { items: pageResident, page, pageSize, total } = paginate(resident, parsePage(get("page")), parsePageSize(get("pageSize")));

  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);
  const canCreate = hasPermission(user.permissions, permissionKey("findings", "create"));

  function districtName(id: string) {
    return db.districts.find((d) => d.id === id)?.name ?? "—";
  }
  function branchName(id: string) {
    return db.branches.find((b) => b.id === id)?.name ?? "—";
  }
  function categoryName(id: string) {
    // A typed-in "Other" value has no matching category record - the id
    // field holds the free text itself in that case, so show it directly.
    return db.categories.find((c) => c.id === id)?.name ?? (id || "—");
  }
  function sourceName(id: string) {
    return db.sources.find((s) => s.id === id)?.name ?? "—";
  }
  function departmentName(id: string) {
    return db.departments.find((d) => d.id === id)?.name ?? "—";
  }
  function periodCode(id: string) {
    return db.reportingPeriods.find((p) => p.id === id)?.code ?? "—";
  }
  function userName(id: string) {
    return db.users.find((u) => u.id === id)?.name ?? "—";
  }

  // What the signed-in session can attempt via the bulk action toolbar -
  // the exact same gates the Finding detail page uses per action, so bulk
  // never offers something a single-finding attempt would then reject.
  // Bank approval isn't a permission at all (Settings.hoApproval gates it
  // to specific assigned user IDs, same as the detail page - see
  // bank-approval/route.ts), so it's checked directly here too.
  const bulkPermissions = {
    canSubmit: hasPermission(user.permissions, permissionKey("findings", "submit")),
    currentUserId: user.userId!,
    canDistrictReview: hasPermission(user.permissions, permissionKey("findings", "district-review")),
    canHoReview: hasPermission(user.permissions, permissionKey("findings", "ho-review")),
    canBankApprove: db.settings.hoApproval.approverUserIds.includes(user.userId!),
    canVerifyRectification: hasPermission(user.permissions, permissionKey("findings", "verify-rectification")),
    canReturnRectification: hasPermission(user.permissions, permissionKey("findings", "return-rectification")),
    canClose: hasPermission(user.permissions, permissionKey("findings", "close")),
    canDeleteRejected: hasPermission(user.permissions, permissionKey("findings", "delete-rejected")),
  };

  // The user's own shown / hidden columns, kept until they change them.
  const savedColumns = await getPreference(user.userId!, "findings.columns");

  const rows: FindingRow[] = pageResident.map(({ finding: f, slice }) => ({
    id: f.id,
    reference: f.reference,
    title: f.title,
    districtName: districtName(f.districtId),
    branchName: branchName(f.branchId),
    departmentName: departmentName(f.departmentId),
    categoryName: categoryName(f.categoryId),
    sourceName: sourceName(f.sourceId),
    riskLevel: f.riskLevel,
    currency: f.currency,
    amount: slice ? slice.eligibleAmount : f.amount,
    // Registered + adjustments approved in the filtered period (0 where it was only
    // transferred in); with no period, everything reported (= its current case count).
    reportedCases: slice ? slice.reportedCases : f.caseCount,
    totalCases: slice ? slice.eligibleCases : f.caseCount,
    // Cases transferred into / out of the filtered period (no period filter: none to show).
    casesIn: slice ? slice.casesIn : null,
    casesOut: slice ? slice.casesOut : null,
    status: f.status,
    updatedAt: f.updatedAt,
    // With a period chosen: what was rectified / verified IN that period.
    rectifiedCases: slice ? slice.rectifiedCases : f.rectifiedCases,
    rectifiedAmount: slice ? slice.rectifiedAmount : f.rectifiedAmount,
    districtVerifiedCases: slice ? slice.verifiedCases : f.districtVerifiedCases,
    districtVerifiedAmount: slice ? slice.verifiedAmount : f.districtVerifiedAmount,
    closedCases: slice ? slice.closedCases : f.closedCases,
    closedAmount: slice ? slice.closedAmount : f.closedAmount,
    // The status is the live one, so its "(pending)" follows the live totals.
    awaitingClose: isAwaitingClose(f),
    createdBy: f.createdBy,
    // A period filter can surface a finding that has since transferred
    // away from it (see findingsResidentInPeriod()) - that entry is this
    // period's own history, not something actionable here any more, so
    // FindingsTable must neither offer bulk actions on it nor show its
    // live current status (which belongs to whatever period it's in now).
    isHistorical: slice ? !slice.isCurrentPeriod : false,
    transferredOutToCode: slice?.transferredOutToCode ?? null,
    awaitingDistrict: isAwaitingDistrict(f),
    // Optional columns (Show / hide columns).
    periodCode: periodCode(slice ? periodId : f.periodId),
    findingDate: f.findingDate ?? "",
    operationArea: f.operationArea ?? "",
    irregularityType: f.irregularityType ?? "",
    priority: f.priority ?? "",
    // Registered (+ approved adjustments) in the filtered period - 0 where it was only transferred in.
    reportedAmount: slice ? slice.reportedAmount : registeredAmountOf(f),
    outstandingCases: (slice ? slice.eligibleCases : f.caseCount) - (slice ? slice.closedCases : f.closedCases),
    outstandingAmount: (slice ? slice.eligibleAmount : f.amount) - (slice ? slice.closedAmount : f.closedAmount),
    description: f.description ?? "",
    recommendation: f.recommendation ?? "",
    rootCause: f.rootCause ?? "",
    evidenceNote: f.evidenceNote ?? "",
    externalReference: f.externalReference ?? "",
    registeredByName: userName(f.createdBy),
    registeredBankWide: Boolean(f.registeredByBankScope),
    imported: Boolean(f.importBatchId),
    createdAt: f.createdAt,
    lastReminderAt: f.lastReminderAt ?? "",
    // Case ages now (src/lib/caseAge.ts).
    ageSubmit: caseAge(f).submit,
    ageApproved: caseAge(f).approved,
    ageFindingDate: caseAge(f).findingDate,
    ageImported: caseAge(f).imported,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Findings</h1>
          <p className="mt-1 text-sm text-slate-600">{total} matching</p>
        </div>
        {canCreate && (
          <Link href="/findings/new">
            <Button>New Finding</Button>
          </Link>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {queueOnly ? (
          <Link href="/findings">
            <Button variant="primary">Showing: My Queue</Button>
          </Link>
        ) : (
          // Off: a soft tint - set apart from the page, but close to it (see-through, so it suits both themes).
          <Link
            href="/findings?queue=1"
            className="inline-flex items-center rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-sm font-medium text-slate-800 transition-colors hover:bg-sky-500/20"
          >
            Show My Queue
          </Link>
        )}
      </div>

      <div className="mt-4">
        <FilterBar
          periods={sortPeriods(db.reportingPeriods)}
          defaultPeriodId={queueOnly ? ALL_PERIODS_VALUE : currentPeriod(db.reportingPeriods)?.id}
          districts={user.orgScope === "BRANCH" || user.orgScope === "DISTRICT" ? (district ? [district] : []) : db.districts}
          branches={user.orgScope === "BRANCH" ? (branch ? [branch] : []) : db.branches}
          sources={db.sources.filter((s) => s.active)}
          categories={db.categories.filter((c) => c.active)}
          riskLevels={db.settings.riskLevels}
          operationAreas={db.settings.operationAreas}
          irregularityTypes={db.settings.irregularityTypes}
          fixedDistrict={user.orgScope !== "BANK" && district ? { id: district.id, name: district.name } : undefined}
          fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
          statusOptions={FILTERABLE_FINDING_STATUSES}
          hint="Filters apply immediately."
        />
      </div>

      <div className="mt-3">
        <TimeRangeFilter />
      </div>

      <Card className="mt-4">
        <CardHeader title="All Findings" />
        <FindingsTable
          rows={rows}
          permissions={bulkPermissions}
          emptyText={queueOnly ? "Nothing in your queue." : "No findings match these filters."}
          paging={{ page, pageSize, total }}
          sort={{ id: sort.key, desc: sort.desc }}
          searchText={searchText}
          savedColumns={savedColumns}
        />
      </Card>
    </div>
  );
}
