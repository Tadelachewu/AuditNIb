import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import {
  REPORT_TEMPLATES,
  getUncoveredBranches,
  getCategoryDetailByDistrict,
  getMonthlySummaryReport,
  getMonthlyDistrictSeries,
  getDistrictRankingOtherCases,
  getWeeklyExecutiveSummary,
  getDistrictRankingAllCases,
  getCategoryPerformanceSummary,
  getDistrictSnapshotAsOf,
  getTransferredFindings,
  formatPercentageRange,
} from "@/lib/reportTemplates";
import type { Database } from "@/types";

// One shared text/csv exporter for all report templates - same
// escaping/header/attachment convention as /api/findings/export, just
// dispatched by slug since each template's shape differs. Column headers
// and ordering here deliberately mirror the bank's own report/*.xlsx
// sheets (down to the exact wording, e.g. "rectified percetage" - not a
// typo, that's how the source workbook spells it) so a CSV pasted into an
// existing downstream workflow needs no relabeling.
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
function toCsv(header: string[], rows: (string | number)[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}
function pct(v: number | null): string {
  return v === null ? "--" : v.toFixed(1);
}

const SLUG_TO_ACTION: Record<string, string> = Object.fromEntries(REPORT_TEMPLATES.map((t) => [t.slug, t.action]));

function buildCsv(slug: string, db: Database, params: URLSearchParams): string | null {
  const periodId = params.get("periodId") ?? "";
  const periodIdsList = params.getAll("periodIds");
  const periodIds = periodIdsList.length > 0 ? periodIdsList : undefined;

  switch (slug) {
    case "uncovered-branches": {
      const rows = getUncoveredBranches(db, periodId);
      return toCsv(
        ["Ser. No", "Name of Branches", "Name of Districts", "Reasons for failing to uncover"],
        rows.map((r, i) => [i + 1, r.branch.name, r.district?.name ?? "", r.note?.reason ?? ""])
      );
    }
    case "category-detail-by-district": {
      const { rows, categories, totalRow } = getCategoryDetailByDistrict(db, periodId);
      const header = [
        "SN",
        "Total No. of Branches",
        "District",
        ...categories.flatMap((c) => [`${c.name} Unrectified`, `${c.name} Rectified`]),
        "Total unrectified",
        "Rectified",
        "unrectified Balance",
        "rectified percetage",
      ];
      const dataRows = rows.map((r, i) => [
        i + 1,
        r.totalBranches,
        r.district.name,
        ...r.perCategory.flatMap((c) => [c.outstanding, c.rectified]),
        r.totalOutstanding,
        r.totalRectified,
        r.totalOutstanding,
        pct(r.rectifiedPct),
      ]);
      dataRows.push([
        "",
        "",
        "TOTAL",
        ...categories.flatMap(() => ["", ""]),
        totalRow.totalOutstanding,
        totalRow.totalRectified,
        totalRow.totalOutstanding,
        pct(totalRow.rectifiedPct),
      ]);
      return toCsv(header, dataRows);
    }
    case "monthly-summary": {
      const { rows, categories, totalRow } = getMonthlySummaryReport(db, periodId);
      const header = [
        "SN",
        "Total No. of Branches",
        "District",
        ...categories.map((c) => c.name),
        "Amount involved in Birr",
        "Unrectified",
        "Rectified",
        "rectified percetage",
        "No. of Branches not dispatched",
        "No. of Branches Dispatched reports",
        "Total No. of cases",
      ];
      const dataRows = rows.map((r, i) => [
        i + 1,
        r.totalBranches,
        r.district.name,
        ...r.perCategory.map((c) => c.outstanding),
        r.amountInvolved,
        r.totalOutstanding,
        r.officialRectified,
        pct(r.officialPerformance),
        r.branchesNotDispatched,
        r.branchesDispatched,
        r.totalCases,
      ]);
      dataRows.push([
        "",
        "",
        "TOTAL",
        ...categories.map(() => ""),
        totalRow.totalAmount,
        totalRow.totalOutstanding,
        totalRow.officialRectified,
        "",
        "",
        "",
        totalRow.totalCases,
      ]);
      return toCsv(header, dataRows);
    }
    case "monthly-district-history": {
      // Other-Case-only, matching the page's own filter. periodId narrows
      // to whatever period the page currently has selected (its own period
      // picker now shows one period at a time, not every period stacked) -
      // omitted entirely, this still exports the full history across every
      // period, same as before that page-level filter existed.
      let rows = getMonthlyDistrictSeries(db).otherCases;
      if (periodId) rows = rows.filter((r) => r.period.id === periodId);
      return toCsv(
        ["Period", "Total No. of Branches", "District", "Others Cases", "Unrectified", "Rectified", "rectified percetage"],
        rows.map((r) => [r.period.code, r.totalBranches, r.district.name, r.totalCases, r.outstandingCases, r.rectifiedCases, pct(r.performance)])
      );
    }
    case "monthly-district-detail": {
      // Grouped by district ("Detail monthly summaryBD" - "BD" = "By
      // District"), each district's period rows followed by exactly ONE
      // "Various internal Audit report" closing row, then its subtotal,
      // then one grand TOTAL row at the end - matching the source Excel's
      // structure exactly (cross-checked against its raw cells: Various is
      // the literal last row of each district's block, not repeated per
      // month - see getMonthlyDistrictSeries()'s own doc comment). Mirrors
      // exactly how the on-screen table (monthly-district-detail/page.tsx)
      // renders the same series, so CSV and screen never diverge.
      const { otherCases, various } = getMonthlyDistrictSeries(db);
      const variousByDistrict = new Map(various.map((v) => [v.district.id, v]));
      const byDistrict = new Map<string, typeof otherCases>();
      for (const r of otherCases) {
        const list = byDistrict.get(r.district.id) ?? [];
        list.push(r);
        byDistrict.set(r.district.id, list);
      }
      const dataRows: (string | number)[][] = [];
      let grandTotalCases = 0;
      let grandRectified = 0;
      for (const [districtId, periodRows] of byDistrict) {
        periodRows.forEach((r, i) => {
          dataRows.push([i + 1, i === 0 ? r.district.name : "", r.period.code, "Other Cases", r.totalCases, r.outstandingCases, r.rectifiedCases, pct(r.performance)]);
        });
        const variousRow = variousByDistrict.get(districtId);
        if (variousRow) {
          dataRows.push([
            periodRows.length + 1,
            "",
            "",
            "Various internal Audit report",
            variousRow.totalCases,
            variousRow.outstandingCases,
            variousRow.rectifiedCases,
            pct(variousRow.performance),
          ]);
        }
        const totalCases = periodRows.reduce((sum, r) => sum + r.totalCases, 0) + (variousRow?.totalCases ?? 0);
        const rectifiedCases = periodRows.reduce((sum, r) => sum + r.rectifiedCases, 0) + (variousRow?.rectifiedCases ?? 0);
        grandTotalCases += totalCases;
        grandRectified += rectifiedCases;
        dataRows.push(["", "", "", "", totalCases, totalCases - rectifiedCases, rectifiedCases, pct(totalCases > 0 ? (rectifiedCases / totalCases) * 100 : null)]);
      }
      dataRows.push([
        "",
        "TOTAL",
        "",
        "",
        grandTotalCases,
        grandTotalCases - grandRectified,
        grandRectified,
        pct(grandTotalCases > 0 ? (grandRectified / grandTotalCases) * 100 : null),
      ]);
      return toCsv(["SN", "District", "Month", "Case Type", "Total Cases", "Unrectified", "Rectified", "rectified percetage"], dataRows);
    }
    case "district-ranking-other-cases": {
      const { rows, totalRow } = getDistrictRankingOtherCases(db, periodIds);
      const header = ["SN", "Total No. of Branches", "District", "Total Others Cases", "Rectified", "Total outstanding unrectified", "Rank"];
      const dataRows = rows.map((r, i) => [i + 1, r.totalBranches, r.district.name, r.totalCases, r.rectifiedCases, r.outstandingCases, pct(r.performance)]);
      if (rows.length > 0) {
        dataRows.push(["", totalRow.totalBranches, "TOTAL", totalRow.totalCases, totalRow.rectifiedCases, totalRow.outstandingCases, pct(totalRow.performance)]);
      }
      return toCsv(header, dataRows);
    }
    case "weekly-executive-summary": {
      const thisWeekDate = params.get("thisWeekDate") || undefined;
      const lastWeekDate = params.get("lastWeekDate") || undefined;
      const sections = getWeeklyExecutiveSummary(db, thisWeekDate, lastWeekDate);
      const header = [
        "Section",
        "Types of cases",
        "SN",
        "Total No. of Branches",
        "District",
        "Previous Balance",
        "Additional",
        "Rectified",
        "Current Balance",
        "This Week Rectified %",
        "Last Week Rectified %",
        "Difference",
      ];
      const dataRows = sections.flatMap((section, sIdx) => [
        ...section.rows.map((r, i) => [
          sIdx + 1,
          section.category.name,
          i + 1,
          r.totalBranches,
          r.district.name,
          r.previousBalance,
          r.additional,
          r.rectified,
          r.currentBalance,
          pct(r.thisWeekPct),
          pct(r.lastWeekPct),
          r.difference === null ? "--" : r.difference.toFixed(1),
        ]),
        [
          sIdx + 1,
          section.category.name,
          "",
          "",
          "TOTAL",
          section.totalRow.previousBalance,
          section.totalRow.additional,
          section.totalRow.rectified,
          section.totalRow.currentBalance,
          pct(section.totalRow.thisWeekPct),
          pct(section.totalRow.lastWeekPct),
          section.totalRow.difference === null ? "--" : section.totalRow.difference.toFixed(1),
        ],
      ]);
      return toCsv(header, dataRows);
    }
    case "district-ranking-all-cases": {
      const { rows, totalRow } = getDistrictRankingAllCases(db, periodIds);
      const header = ["SN", "Total No. of Branches", "District", "Total Cases", "Rectified", "Total outstanding unrectified", "Rank in all cases"];
      const dataRows = rows.map((r, i) => [i + 1, r.totalBranches, r.district.name, r.totalCases, r.rectifiedCases, r.outstandingCases, pct(r.performance)]);
      if (rows.length > 0) {
        dataRows.push(["", totalRow.totalBranches, "TOTAL", totalRow.totalCases, totalRow.rectifiedCases, totalRow.outstandingCases, pct(totalRow.performance)]);
      }
      return toCsv(header, dataRows);
    }
    case "category-performance-summary": {
      const { rows, totalRow, grossPercentage } = getCategoryPerformanceSummary(db, periodId || undefined);
      const header = ["SN", "Types of cases", "Unrectified", "Rectified", "Total outstanding unrectified", "Percentage ranges", "Gross percentage", "Previous period"];
      const dataRows = rows.map((r, i) => [
        i + 1,
        r.category.name,
        r.totalCases,
        r.rectifiedCases,
        r.outstandingCases,
        formatPercentageRange(r.minDistrictPct, r.maxDistrictPct),
        pct(r.performance),
        pct(r.previousPeriodPerformance),
      ]);
      if (rows.length > 0) {
        dataRows.push(["", "TOTAL", totalRow.totalCases, totalRow.rectifiedCases, totalRow.outstandingCases, "", pct(grossPercentage), ""]);
      }
      return toCsv(header, dataRows);
    }
    case "mid-month-district-snapshot": {
      const asOfDate = params.get("asOfDate") ?? new Date().toISOString().slice(0, 10);
      const { rows, totalRow } = getDistrictSnapshotAsOf(db, periodId, asOfDate);
      const header = ["SN", "District", "Others Cases", "Unrectified", "Rectified", "rectified percetage"];
      const dataRows = rows.map((r, i) => [i + 1, r.district.name, r.totalCases, r.outstandingCases, r.rectifiedCases, pct(r.performance)]);
      if (rows.length > 0) {
        dataRows.push(["", "TOTAL", totalRow.totalCases, totalRow.outstandingCases, totalRow.rectifiedCases, pct(totalRow.performance)]);
      }
      return toCsv(header, dataRows);
    }
    case "transferred-findings": {
      const rows = getTransferredFindings(db, {
        fromPeriodId: params.get("fromPeriodId") || undefined,
        toPeriodId: params.get("toPeriodId") || undefined,
      });
      const header = [
        "Finding Reference",
        "Original Finding ID",
        "District",
        "Branch",
        "Category",
        "Source",
        "Risk Level",
        "Hop",
        "Method",
        "Previous Reporting Month",
        "New Reporting Month",
        "Transfer Date",
        "Case Age at Transfer",
        "Original Case Count",
        "Original Amount",
        "Resolved Before Transfer (Cases)",
        "Resolved Before Transfer (Amount)",
        "Outstanding Case Count Transferred",
        "Outstanding Amount Transferred",
        "Transferred By",
        "Transfer Reason",
        "Current Status",
        "Current Outstanding Cases",
        "Current Outstanding Amount",
        "Case Age Today",
      ];
      const dataRows = rows.map((r) => [
        r.finding.reference,
        r.finding.id,
        r.district?.name ?? "",
        r.branch?.name ?? "",
        r.category?.name ?? "",
        r.source?.name ?? "",
        r.finding.riskLevel,
        `${r.hopNumber} of ${r.totalHops}`,
        r.transfer.method,
        r.fromPeriod?.code ?? r.transfer.fromPeriodId,
        r.toPeriod?.code ?? r.transfer.toPeriodId,
        r.transfer.createdAt.slice(0, 10),
        r.transfer.caseAgeAtTransferDays,
        r.transfer.originalCaseCount,
        r.transfer.originalAmount,
        r.resolvedBeforeTransferCases,
        r.resolvedBeforeTransferAmount,
        r.transfer.casesTransferred,
        r.transfer.amountTransferred,
        r.transfer.createdByName,
        r.transfer.reason,
        r.currentStatus,
        r.currentOutstandingCases,
        r.currentOutstandingAmount,
        r.caseAgeDaysNow,
      ]);
      return toCsv(header, dataRows);
    }
    default:
      return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const action = SLUG_TO_ACTION[slug];
  if (!action) return NextResponse.json({ error: "Unknown report template" }, { status: 404 });

  const auth = await requirePermission(`report-templates.${action}`);
  if (!auth.ok) return auth.response;

  const db = await readDb();
  const url = new URL(request.url);
  const csv = buildCsv(slug, db, url.searchParams);
  if (csv === null) return NextResponse.json({ error: "Unknown report template" }, { status: 404 });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
