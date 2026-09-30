import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { buildReportsData } from "@/lib/reportsPageData";
import { withApiHandler } from "@/lib/api/handler";

// The Reports page's "Download CSV": EVERY section of the page, with the
// page's current filters - built by the same function the page renders
// from (src/lib/reportsPageData.ts), so the file always matches the screen.
// Sections, each with its own heading row and header row:
//   Findings (all matching rows, not one page) · Branch Performance ·
//   District Performance · Category Breakdown · Risk Breakdown · Transfers

// A text cell starting with = + - @ would run as a formula in Excel
// ("CSV injection"); a leading quote keeps it plain text.
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const line = (values: (string | number | null | undefined)[]) => values.map(cell).join(",");
const pct = (v: number | null) => (v === null ? "" : v.toFixed(1));

async function handleGET(request: Request) {
  const auth = await requirePermission("reports.view");
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const db = await readDb();
  const data = buildReportsData(db, auth.session, (k) => params.get(k) ?? "");
  const periodCode = data.periodId ? (db.reportingPeriods.find((p) => p.id === data.periodId)?.code ?? data.periodId) : "All periods";

  const out: string[] = [];
  out.push(line(["NIB Control360 - Reports"]));
  out.push(line(["Reporting period", periodCode]));
  out.push(line(["Generated", new Date().toISOString()]));
  out.push("");

  out.push(line([`Findings (${data.listed.length})`]));
  out.push(line(["Reference", "Title", "District", "Branch", "Department", "Category", "Source", "Currency", "Amount", "Outstanding", "Reported Cases", "Total Cases", "Status"]));
  for (const r of data.listed) {
    const f = r.finding;
    const amount = data.amountOf(r);
    const outstanding = r.slice ? r.slice.eligibleAmount - r.slice.closedAmount : f.amount - f.closedAmount;
    const status = r.slice && !r.slice.isCurrentPeriod ? `Transferred -> ${r.slice.transferredOutToCode ?? ""}` : f.status;
    out.push(
      line([f.reference, f.title, data.names.districtName(f.districtId), data.names.branchName(f.branchId), data.names.departmentName(f.departmentId), data.names.categoryName(f.categoryId), data.names.sourceName(f.sourceId), f.currency, amount, outstanding, f.caseCount, r.slice ? r.slice.eligibleCases : f.caseCount, status])
    );
  }
  out.push("");

  for (const [title, rows, withBranches] of [
    ["Branch Performance", data.branchPerformance, false],
    ["District Performance", data.districtPerformance, true],
  ] as const) {
    out.push(line([title]));
    out.push(line(["Rank", title.startsWith("Branch") ? "Branch" : "District", ...(withBranches ? ["Branches"] : []), "Eligible Cases", "Solved", "Unsolved", "Performance %"]));
    for (const r of rows) {
      out.push(line([r.rank, r.name, ...(withBranches ? [r.branchCount ?? ""] : []), r.totalCases, r.rectifiedCases, r.outstandingCases, pct(r.performance)]));
    }
    out.push("");
  }

  out.push(line(["Category Breakdown"]));
  out.push(line(["Category", "Total", "Rectified", "Outstanding"]));
  for (const c of data.categoryBreakdown) out.push(line([c.category.name, c.total, c.rectified, c.outstanding]));
  out.push("");

  out.push(line(["Risk Breakdown"]));
  out.push(line(["Risk Level", "Findings"]));
  for (const r of data.riskBreakdown) out.push(line([r.risk, r.count]));
  out.push("");

  out.push(line([`Transfers (${data.transferRows.length})`]));
  out.push(line(["Finding", "From Period", "To Period", "Currency", "Original Amount", "Outstanding Amount", "Original Cases", "Outstanding Cases", "Case Age (days)", "Method", "Transferred By", "Transfer Date", "Reason"]));
  for (const t of data.transferRows) {
    out.push(
      line([t.reference, t.fromCode, t.toCode, t.currency, t.originalAmount, t.outstandingAmount, t.originalCases, t.outstandingCases, t.caseAgeDays, t.method, t.createdByName, t.createdAt, t.reason])
    );
  }

  // UTF-8 BOM so Excel shows Amharic / other non-Latin text correctly.
  return new NextResponse("﻿" + out.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
