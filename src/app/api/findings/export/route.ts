import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";

// master.txt §18's report set, as a real text/csv export - same
// org-scope + filter logic as GET /api/findings (src/app/api/findings/route.ts),
// so an export always matches exactly what's on screen for that filter set.
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET(request: Request) {
  const auth = await requirePermission("reports.view");
  if (!auth.ok) return auth.response;

  const db = readDb();
  let findings = findingsInScope(db, auth.session);

  const url = new URL(request.url);
  const periodId = url.searchParams.get("periodId");
  const districtId = url.searchParams.get("districtId");
  const branchId = url.searchParams.get("branchId");
  const sourceId = url.searchParams.get("sourceId");
  const categoryId = url.searchParams.get("categoryId");
  const risk = url.searchParams.get("risk");
  const status = url.searchParams.get("status");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (periodId) findings = findings.filter((f) => f.periodId === periodId);
  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (status) findings = findings.filter((f) => f.status === status);
  if (dateFrom) findings = findings.filter((f) => f.findingDate >= dateFrom);
  if (dateTo) findings = findings.filter((f) => f.findingDate <= dateTo);

  findings = [...findings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const branchName = (id: string) => db.branches.find((b) => b.id === id)?.name ?? "";
  const districtName = (id: string) => db.districts.find((d) => d.id === id)?.name ?? "";
  const sourceName = (id: string) => db.sources.find((s) => s.id === id)?.name ?? "";
  const departmentName = (id: string) => db.departments.find((d) => d.id === id)?.name ?? "";
  const categoryName = (id: string) => db.categories.find((c) => c.id === id)?.name ?? "";
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
    "Cases",
    "Rectified Amount",
    "Rectified Cases",
    "Outstanding Amount",
    "Outstanding Cases",
    "Finding Date",
    "Updated At",
  ];

  const rows = findings.map((f) =>
    [
      f.reference,
      f.title,
      districtName(f.districtId),
      branchName(f.branchId),
      departmentName(f.departmentId),
      periodCode(f.periodId),
      sourceName(f.sourceId),
      categoryName(f.categoryId),
      f.riskLevel,
      f.status,
      f.amount,
      f.currency,
      f.caseCount,
      f.rectifiedAmount,
      f.rectifiedCases,
      f.amount - f.rectifiedAmount,
      f.caseCount - f.rectifiedCases,
      f.findingDate,
      f.updatedAt,
    ]
      .map(csvCell)
      .join(",")
  );

  const csv = [header.join(","), ...rows].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="findings-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
