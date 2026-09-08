import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { queueStatusesForSession, findingsResidentInPeriod, type FindingPeriodSlice } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { paginate, parsePage } from "@/lib/pagination";
import { inDateRange } from "@/lib/dateRange";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pagination } from "@/components/ui/Pagination";
import { TimeRangeFilter } from "@/components/reports/TimeRangeFilter";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { FindingsTable, type FindingRow } from "@/components/findings/FindingsTable";
import type { Finding } from "@/types";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("findings", "view"))) redirect("/dashboard");

  const params = await searchParams;
  const get = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const queueOnly = get("queue") === "1";

  const db = readDb();
  let findings: Finding[] = findingsInScope(db, user);

  const periodId = get("periodId");
  const districtId = get("districtId");
  const branchId = get("branchId");
  const sourceId = get("sourceId");
  const categoryId = get("categoryId");
  const risk = get("risk");
  const status = get("status");
  const dateFrom = get("dateFrom");
  const dateTo = get("dateTo");

  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  // Comma-separated to support the Status Distribution donut's multi-status
  // buckets (e.g. "Draft / In Review" spans 6 statuses) linking here with
  // one query param - a single status value still works unchanged since
  // split(",") on a value with no comma just returns that one value.
  if (status) {
    const statuses = new Set(status.split(","));
    findings = findings.filter((f) => statuses.has(f.status));
  }
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

  const isQueued = queueStatusesForSession(user, db);
  if (queueOnly) resident = resident.filter((r) => (r.slice === null || r.slice.isCurrentPeriod) && isQueued(r.finding));

  resident = [...resident].sort((a, b) => b.finding.updatedAt.localeCompare(a.finding.updatedAt));

  // Server-side pagination: only the current page's rows are ever
  // rendered/sent to the client, no matter how large the filtered result
  // set grows - the Findings table is the one dataset in this app with
  // genuinely unbounded growth (every registered finding, forever).
  const { items: pageResident, page, pageSize, totalPages, total } = paginate(resident, parsePage(get("page")));
  function hrefFor(targetPage: number) {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "page") continue;
      if (typeof value === "string" && value) q.set(key, value);
    }
    if (targetPage > 1) q.set("page", String(targetPage));
    const qs = q.toString();
    return qs ? `/findings?${qs}` : "/findings";
  }

  const district = db.districts.find((d) => d.id === user.districtId);
  const branch = db.branches.find((b) => b.id === user.branchId);
  const canCreate = hasPermission(user.permissions, permissionKey("findings", "create"));

  function branchName(id: string) {
    return db.branches.find((b) => b.id === id)?.name ?? "—";
  }
  function categoryName(id: string) {
    return db.categories.find((c) => c.id === id)?.name ?? "—";
  }
  function sourceName(id: string) {
    return db.sources.find((s) => s.id === id)?.name ?? "—";
  }
  function departmentName(id: string) {
    return db.departments.find((d) => d.id === id)?.name ?? "—";
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
  };

  const rows: FindingRow[] = pageResident.map(({ finding: f, slice }) => ({
    id: f.id,
    reference: f.reference,
    title: f.title,
    branchName: branchName(f.branchId),
    departmentName: departmentName(f.departmentId),
    categoryName: categoryName(f.categoryId),
    sourceName: sourceName(f.sourceId),
    riskLevel: f.riskLevel,
    currency: f.currency,
    amount: slice ? slice.eligibleAmount : f.amount,
    status: f.status,
    updatedAt: f.updatedAt,
    rectifiedCases: f.rectifiedCases,
    rectifiedAmount: f.rectifiedAmount,
    districtVerifiedCases: f.districtVerifiedCases,
    districtVerifiedAmount: f.districtVerifiedAmount,
    closedCases: slice ? slice.closedCases : f.closedCases,
    closedAmount: slice ? slice.closedAmount : f.closedAmount,
    createdBy: f.createdBy,
    // A period filter can surface a finding that has since transferred
    // away from it (see findingsResidentInPeriod()) - that entry is this
    // period's own history, not something actionable here any more, so
    // FindingsTable must neither offer bulk actions on it nor show its
    // live current status (which belongs to whatever period it's in now).
    isHistorical: slice ? !slice.isCurrentPeriod : false,
    transferredOutToCode: slice?.transferredOutToCode ?? null,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Findings</h1>
          <p className="mt-1 text-sm text-slate-500">{total} matching</p>
        </div>
        {canCreate && (
          <Link href="/findings/new">
            <Button>New Finding</Button>
          </Link>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Link href={queueOnly ? "/findings" : "/findings?queue=1"}>
          <Button variant={queueOnly ? "primary" : "secondary"}>
            {queueOnly ? "Showing: My Queue" : "Show My Queue"}
          </Button>
        </Link>
      </div>

      <div className="mt-4">
        <FilterBar
          periods={db.reportingPeriods}
          districts={user.orgScope === "BRANCH" || user.orgScope === "DISTRICT" ? (district ? [district] : []) : db.districts}
          branches={user.orgScope === "BRANCH" ? (branch ? [branch] : []) : db.branches}
          sources={db.sources.filter((s) => s.active)}
          categories={db.categories.filter((c) => c.active)}
          riskLevels={db.settings.riskLevels}
          fixedDistrict={user.orgScope !== "BANK" && district ? { id: district.id, name: district.name } : undefined}
          fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
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
        />
        <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} hrefFor={hrefFor} />
      </Card>
    </div>
  );
}
