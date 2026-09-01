import Link from "next/link";
import type { Database, Branch, ReportingPeriod } from "@/types";
import { computePerformance, findPreviousPeriod } from "@/lib/findings";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

interface Row {
  branch: Branch;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
  improvement: number | null;
  highRiskCount: number;
}

function Callout({
  label,
  branchName,
  sub,
  href,
  tone,
}: {
  label: string;
  branchName: string | null;
  sub: string | null;
  href: string | null;
  tone: "green" | "red" | "amber" | "gray" | "blue";
}) {
  const inner = (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-900">{branchName ?? "--"}</p>
      {sub && (
        <p className="mt-0.5">
          <Badge tone={tone}>{sub}</Badge>
        </p>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-colors hover:border-slate-300 hover:bg-slate-50">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/**
 * Document_3 §15's "Branch Performance Dashboard": Rank/Branch/Total
 * Cases/Rectified/Outstanding/Performance, for District and HO users -
 * shared between DistrictDashboard (that district's own branches) and
 * HODashboard (every branch bank-wide), since the shape is identical, just
 * the input branch list differs. Plus the five required callouts (Top
 * performer, Lowest performer, High-risk branch, Most outstanding,
 * Highest improvement) - each linking straight to that branch's filtered
 * Findings list where there's a real branch to link to.
 */
export function BranchPerformanceTable({
  db,
  branches,
  openPeriod,
  title = "Branch Performance",
  description = "Rank, cases, and performance by branch, current period",
}: {
  db: Database;
  branches: Branch[];
  openPeriod?: ReportingPeriod;
  title?: string;
  description?: string;
}) {
  const previousPeriod = openPeriod ? findPreviousPeriod(db, openPeriod) : undefined;
  const highRiskTiers = new Set(db.settings.riskLevels.slice(-2).map((l) => l.toLowerCase()));

  const rows: Row[] = branches.map((b) => {
    const findings = openPeriod ? db.findings.filter((f) => f.branchId === b.id && f.periodId === openPeriod.id) : [];
    const totalCases = findings.reduce((sum, f) => sum + f.caseCount, 0);
    const rectifiedCases = findings.reduce((sum, f) => sum + f.rectifiedCases, 0);
    const performance = openPeriod ? computePerformance(db, { branchId: b.id, periodId: openPeriod.id }) : null;
    const prevPerformance = previousPeriod ? computePerformance(db, { branchId: b.id, periodId: previousPeriod.id }) : null;
    const highRiskCount = findings.filter(
      (f) => !["RECTIFIED", "CLOSED", "REJECTED"].includes(f.status) && highRiskTiers.has(f.riskLevel.toLowerCase())
    ).length;
    return {
      branch: b,
      totalCases,
      rectifiedCases,
      outstandingCases: totalCases - rectifiedCases,
      performance,
      improvement: performance !== null && prevPerformance !== null ? performance - prevPerformance : null,
      highRiskCount,
    };
  });

  const ranked = [...rows].sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));
  const withPerf = rows.filter((r) => r.performance !== null);
  const topPerformer = withPerf.length > 0 ? [...withPerf].sort((a, b) => b.performance! - a.performance!)[0] : null;
  const lowestPerformer = withPerf.length > 0 ? [...withPerf].sort((a, b) => a.performance! - b.performance!)[0] : null;
  const highRiskBranch = rows.some((r) => r.highRiskCount > 0) ? [...rows].sort((a, b) => b.highRiskCount - a.highRiskCount)[0] : null;
  const mostOutstanding = rows.some((r) => r.outstandingCases > 0) ? [...rows].sort((a, b) => b.outstandingCases - a.outstandingCases)[0] : null;
  const withImprovement = rows.filter((r) => r.improvement !== null && r.improvement > 0);
  const highestImprovement = withImprovement.length > 0 ? [...withImprovement].sort((a, b) => b.improvement! - a.improvement!)[0] : null;

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="grid grid-cols-2 gap-2 border-b border-slate-100 p-4 sm:grid-cols-5">
        <Callout
          label="Top Performer"
          branchName={topPerformer?.branch.name ?? null}
          sub={topPerformer ? `${topPerformer.performance!.toFixed(1)}%` : null}
          href={topPerformer ? `/findings?branchId=${topPerformer.branch.id}` : null}
          tone="green"
        />
        <Callout
          label="Lowest Performer"
          branchName={lowestPerformer?.branch.name ?? null}
          sub={lowestPerformer ? `${lowestPerformer.performance!.toFixed(1)}%` : null}
          href={lowestPerformer ? `/findings?branchId=${lowestPerformer.branch.id}` : null}
          tone="red"
        />
        <Callout
          label="High-Risk Branch"
          branchName={highRiskBranch?.branch.name ?? null}
          sub={highRiskBranch ? `${highRiskBranch.highRiskCount} high-risk` : null}
          href={highRiskBranch ? `/findings?branchId=${highRiskBranch.branch.id}` : null}
          tone="amber"
        />
        <Callout
          label="Most Outstanding"
          branchName={mostOutstanding?.branch.name ?? null}
          sub={mostOutstanding ? `${mostOutstanding.outstandingCases} case(s)` : null}
          href={mostOutstanding ? `/findings?branchId=${mostOutstanding.branch.id}` : null}
          tone="gray"
        />
        <Callout
          label="Highest Improvement"
          branchName={highestImprovement?.branch.name ?? null}
          sub={highestImprovement ? `+${highestImprovement.improvement!.toFixed(1)}pp` : previousPeriod ? null : "No prior period"}
          href={highestImprovement ? `/findings?branchId=${highestImprovement.branch.id}` : null}
          tone="blue"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Rank</th>
              <th className="px-4 py-2 font-medium">Branch</th>
              <th className="px-4 py-2 font-medium">Total Cases</th>
              <th className="px-4 py-2 font-medium">Rectified</th>
              <th className="px-4 py-2 font-medium">Outstanding</th>
              <th className="px-4 py-2 font-medium">Performance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ranked.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No branches configured yet.
                </td>
              </tr>
            )}
            {ranked.map((row, i) => (
              <tr key={row.branch.id}>
                <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                <td className="px-4 py-2">
                  <Link href={`/findings?branchId=${row.branch.id}`} className="text-blue-800 hover:underline">
                    {row.branch.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-700">{openPeriod ? row.totalCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{openPeriod ? row.rectifiedCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{openPeriod ? row.outstandingCases : "--"}</td>
                <td className="px-4 py-2 text-slate-700">{row.performance !== null ? `${row.performance.toFixed(1)}%` : "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
