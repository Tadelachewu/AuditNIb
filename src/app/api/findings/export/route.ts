import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { findingsResidentInPeriod, queueStatusesForSession, type FindingPeriodSlice } from "@/lib/findings";
import { findingStatusCode, type Finding } from "@/types";
import { filterFindingsByText, sortFindings, parseFindingSort } from "@/lib/findingListQuery";
import { matchesOperationAndIrregularity } from "@/lib/dashboardFilters";
import { withApiHandler } from "@/lib/api/handler";
import { resolvePeriodFilter } from "@/lib/periods";

// master.txt §18's report set, as a real text/csv export - same
// org-scope + filter logic as GET /api/findings (src/app/api/findings/route.ts),
// so an export always matches exactly what's on screen for that filter set.
// A text cell starting with = + - @ would be run as a formula by Excel /
// Sheets ("CSV injection"); a leading quote makes it plain text. Numbers
// are left alone (a negative amount is still a number).
function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function handleGET(request: Request) {
  // Used by both the Reports page and the Findings list's Export CSV - either
  // permission is enough (the data is still limited to the caller's scope).
  const auth = await requirePermission("reports.view", "findings.view");
  if (!auth.ok) return auth.response;

  const db = await readDb();
  let findings = findingsInScope(db, auth.session);

  const url = new URL(request.url);
  // Same default as the Findings page: current period unless one (or "ALL") is chosen.
  // (My Queue: every period unless one is chosen.)
  const periodId =
    url.searchParams.get("queue") === "1" && !url.searchParams.get("periodId") ? "" : resolvePeriodFilter(db.reportingPeriods, url.searchParams.get("periodId"));
  const districtId = url.searchParams.get("districtId");
  const branchId = url.searchParams.get("branchId");
  const sourceId = url.searchParams.get("sourceId");
  const categoryId = url.searchParams.get("categoryId");
  const risk = url.searchParams.get("risk");
  const operationArea = url.searchParams.get("operationArea") ?? "";
  const irregularityType = url.searchParams.get("irregularityType") ?? "";
  const status = url.searchParams.get("status");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (operationArea || irregularityType) findings = findings.filter((f) => matchesOperationAndIrregularity(f, { operationArea, irregularityType }));
  // Comma-separated, same as the Findings list (e.g. a status-donut bucket).
  if (status) {
    const statuses = new Set(status.split(","));
    findings = findings.filter((f) => statuses.has(f.status));
  }
  if (dateFrom) findings = findings.filter((f) => f.findingDate >= dateFrom);
  if (dateTo) findings = findings.filter((f) => f.findingDate <= dateTo);

  // A period filter includes a finding that has since transferred out of
  // it too, exported with that period's own slice of its cases/amount -
  // see findingsResidentInPeriod()'s doc comment in src/lib/findings.ts.
  // Without a period filter, every finding still exports once with its
  // live fields, exactly as before.
  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "";
  const districtName = (id: string) => db.districts.find((d) => d.id === id)?.name ?? "";
  const sourceName = (id: string) => db.sources.find((s) => s.id === id)?.name ?? "";
  const departmentName = (id: string) => db.departments.find((d) => d.id === id)?.name ?? "";
  const categoryName = (id: string) => db.categories.find((c) => c.id === id)?.name ?? id;

  let resident: { finding: Finding; slice: FindingPeriodSlice | null }[] = periodId
    ? findingsResidentInPeriod(db, periodId, findings)
    : findings.map((f) => ({ finding: f, slice: null }));

  // Same "My Queue" / search / sort as the Findings list
  // (src/lib/findingListQuery.ts), so an export matches what's on screen.
  if (url.searchParams.get("queue") === "1") {
    const isQueued = queueStatusesForSession(auth.session, db);
    resident = resident.filter((r) => (r.slice === null || r.slice.isCurrentPeriod) && isQueued(r.finding));
  }
  const names = { districtName, branchName, departmentName, categoryName, sourceName };
  resident = filterFindingsByText(resident, url.searchParams.get("q") ?? "", names);
  resident = sortFindings(
    resident,
    parseFindingSort(url.searchParams.get("sort"), url.searchParams.get("dir")),
    names,
    (r) => (r.slice ? r.slice.eligibleAmount : r.finding.amount)
  );
  const periodCode = (id: string) => db.reportingPeriods.find((p) => p.id === id)?.code ?? "";

  const header = [
    "Reference",
    "Title",
    "District",
    "Branch",
    "Department",
    "Period",
    "Source",
    "Category",
    "Risk",
    "Status",
    "Amount",
    "Currency",
    "Reported Cases",
    "Total Cases",
    "Rectified Amount",
    "Rectified Cases",
    "Outstanding Amount",
    "Outstanding Cases",
    "Finding Date",
    "Updated At",
  ];

  const rows = resident.map(({ finding: f, slice }) => {
    // A historical row (this finding transferred out of the filtered
    // period) exports that period's own slice - amount/cases actually
    // attributable there - and the filtered period itself (not the
    // finding's live current one), with status replaced by a plain marker
    // so the CSV never claims a transferred-away finding is still, say,
    // DRAFT in a period it left long ago.
    const amount = slice ? slice.eligibleAmount : f.amount;
    const caseCount = slice ? slice.eligibleCases : f.caseCount;
    const rectifiedAmount = slice ? slice.closedAmount : f.rectifiedAmount;
    const rectifiedCases = slice ? slice.closedCases : f.rectifiedCases;
    const isHistorical = slice ? !slice.isCurrentPeriod : false;
    return [
      f.reference,
      f.title,
      districtName(f.districtId),
      branchName(f.branchId),
      departmentName(f.departmentId),
      periodId && slice ? periodCode(periodId) : periodCode(f.periodId),
      sourceName(f.sourceId),
      categoryName(f.categoryId),
      f.riskLevel,
      isHistorical ? `TRANSFERRED_OUT (${slice?.transferredOutToCode ?? ""})` : findingStatusCode(f.status),
      amount,
      f.currency,
      f.caseCount,
      caseCount,
      rectifiedAmount,
      rectifiedCases,
      amount - rectifiedAmount,
      caseCount - rectifiedCases,
      f.findingDate,
      f.updatedAt,
    ]
      .map(csvCell)
      .join(",");
  });

  const csv = [header.join(","), ...rows].join("\r\n");

  // UTF-8 byte-order mark so Excel shows Amharic text correctly.
  return new NextResponse("\uFEFF" + csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="findings-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
