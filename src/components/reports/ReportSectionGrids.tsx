import { formatDateTime } from "@/lib/format";
import { gridPage } from "@/lib/gridPage";
import { getGridParams } from "@/lib/gridParams";
import {
  CategoryBreakdownGridClient,
  RiskBreakdownGridClient,
  TransfersGridClient,
  type CategoryBreakdownRow,
  type RiskBreakdownRow,
  type TransferRow,
} from "@/components/reports/ReportGrids";

// The Reports page's section tables, paged on the server: the page computes
// every row, these search / filter / sort / page them per the URL
// (src/lib/gridPage.ts, each under its own prefix) and send one page.

export function TransfersGrid({ rows }: { rows: TransferRow[] }) {
  const grid = gridPage("transfers", rows, getGridParams(), {
    fields: {
      reference: (t) => t.reference,
      fromCode: (t) => t.fromCode,
      toCode: (t) => t.toCode,
      originalAmount: (t) => t.originalAmount,
      outstandingAmount: (t) => t.outstandingAmount,
      originalCases: (t) => t.originalCases,
      outstandingCases: (t) => t.outstandingCases,
      caseAgeDays: (t) => t.caseAgeDays,
      method: (t) => (t.method === "AUTOMATIC" ? "Automatic" : "Manual"),
      createdByName: (t) => t.createdByName,
      createdAt: (t) => t.createdAt,
      reason: (t) => t.reason,
    },
    search: ["reference", "fromCode", "toCode", "method", "createdByName", "reason"],
    exact: ["fromCode", "toCode", "method", "createdByName"],
    defaultSort: { id: "createdAt", desc: true },
    csv: [
      { header: "Finding", value: (t) => t.reference },
      { header: "From Period", value: (t) => t.fromCode },
      { header: "To Period", value: (t) => t.toCode },
      { header: "Original Amount", value: (t) => t.originalAmount },
      { header: "Outstanding Amount", value: (t) => t.outstandingAmount },
      { header: "Original Cases", value: (t) => t.originalCases },
      { header: "Outstanding Cases", value: (t) => t.outstandingCases },
      { header: "Case Age (days)", value: (t) => t.caseAgeDays },
      { header: "Method", value: (t) => (t.method === "AUTOMATIC" ? "Automatic" : "Manual") },
      { header: "Transferred By", value: (t) => t.createdByName },
      { header: "Transfer Date", value: (t) => formatDateTime(t.createdAt) },
      { header: "Transfer Reason", value: (t) => t.reason },
    ],
  });
  return <TransfersGridClient grid={grid} />;
}

export function CategoryBreakdownGrid({ rows }: { rows: CategoryBreakdownRow[] }) {
  const grid = gridPage("categories", rows, getGridParams(), {
    fields: { name: (r) => r.name, total: (r) => r.total, rectified: (r) => r.rectified, outstanding: (r) => r.outstanding },
    search: ["name"],
    csv: [
      { header: "Category", value: (r) => r.name },
      { header: "Total", value: (r) => r.total },
      { header: "Rectified", value: (r) => r.rectified },
      { header: "Outstanding", value: (r) => r.outstanding },
    ],
  });
  return <CategoryBreakdownGridClient grid={grid} />;
}

export function RiskBreakdownGrid({ rows }: { rows: RiskBreakdownRow[] }) {
  const grid = gridPage("risks", rows, getGridParams(), {
    fields: { risk: (r) => r.risk, count: (r) => r.count },
    search: ["risk"],
    csv: [
      { header: "Risk Level", value: (r) => r.risk },
      { header: "Findings", value: (r) => r.count },
    ],
  });
  return <RiskBreakdownGridClient grid={grid} />;
}
