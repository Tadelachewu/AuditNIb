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
  formatPercentageRange,
} from "@/lib/reportTemplates";
import type { Database } from "@/types";

// One shared text/csv exporter for all 10 report templates - same
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
      // Other-Case-only, matching the page's own filter - getMonthlyDistrictSeries()
      // now returns two rows per district/period (OTHER_CASES and the
      // VARIOUS_INTERNAL_AUDIT catch-all, see its own doc comment); this
      // template is specifically the official scored-category series, same
      // as Monthly District History has always been.
      const series = getMonthlyDistrictSeries(db).filter((r) => r.rowKind === "OTHER_CASES");
      return toCsv(
        ["Period", "Total No. of Branches", "District", "Others Cases", "Unrectified", "Rectified", "rectified percetage"],
        series.map((r) => [r.period.code, r.totalBranches, r.district.name, r.totalCases, r.outstandingCases, r.rectifiedCases, pct(r.performance)])
      );
    }
    case "monthly-district-detail": {
      // Grouped by district ("Detail monthly summaryBD" - "BD" = "By
      // District" - see getMonthlyDistrictSeries' own doc comment), each
      // district's months followed by its subtotal, then one grand TOTAL
      // row at the end - matching the source sheet's structure exactly.
      // Each district/period pair now carries two rows (Other Cases +
      // Various internal Audit report catch-all - see rowKind on
      // DistrictPeriodRow) - the Case Type column and shared per-period SN
      // mirror exactly how the on-screen table (monthly-district-detail/
      // page.tsx) renders the same series, so CSV and screen never diverge.
      const series = getMonthlyDistrictSeries(db);
      const caseTypeLabel = (kind: "OTHER_CASES" | "VARIOUS_INTERNAL_AUDIT") =>
        kind === "OTHER_CASES" ? "Other Cases" : "Various internal Audit report";
      const byDistrict = new Map<string, typeof series>();
      for (const r of series) {
        const list = byDistrict.get(r.district.id) ?? [];
        list.push(r);
        byDistrict.set(r.district.id, list);
      }
      const dataRows: (string | number)[][] = [];
      let grandTotalCases = 0;
      let grandRectified = 0;
      for (const rows of byDistrict.values()) {
        const byPeriod = new Map<string, typeof rows>();
        for (const r of rows) {
          const list = byPeriod.get(r.period.id) ?? [];
          list.push(r);
          byPeriod.set(r.period.id, list);
        }
        [...byPeriod.values()].forEach((periodRows, i) => {
          periodRows.forEach((r, kindIdx) => {
            dataRows.push([
              kindIdx === 0 ? i + 1 : "",
              kindIdx === 0 ? r.district.name : "",
              kindIdx === 0 ? r.period.code : "",
              caseTypeLabel(r.rowKind),
              r.totalCases,
              r.outstandingCases,
              r.rectifiedCases,
              pct(r.performance),
            ]);
          });
        });
        const totalCases = rows.reduce((sum, r) => sum + r.totalCases, 0);
        const rectifiedCases = rows.reduce((sum, r) => sum + r.rectifiedCases, 0);
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
      const sections = getWeeklyExecutiveSummary(db);
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

  const db = readDb();
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
