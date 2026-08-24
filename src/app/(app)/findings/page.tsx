import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { findingsInScope } from "@/lib/findings-scope";
import { queueStatusesForSession } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { FindingsFilterBar } from "@/components/findings/FindingsFilterBar";
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

  if (periodId) findings = findings.filter((f) => f.periodId === periodId);
  if (districtId) findings = findings.filter((f) => f.districtId === districtId);
  if (branchId) findings = findings.filter((f) => f.branchId === branchId);
  if (sourceId) findings = findings.filter((f) => f.sourceId === sourceId);
  if (categoryId) findings = findings.filter((f) => f.categoryId === categoryId);
  if (risk) findings = findings.filter((f) => f.riskLevel === risk);
  if (status) findings = findings.filter((f) => f.status === status);

  const queueStatuses = queueStatusesForSession(user);
  if (queueOnly) findings = findings.filter((f) => queueStatuses.includes(f.status));

  findings = [...findings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Findings</h1>
          <p className="mt-1 text-sm text-slate-500">{findings.length} shown</p>
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
        <FindingsFilterBar
          periods={db.reportingPeriods}
          districts={user.orgScope === "BRANCH" || user.orgScope === "DISTRICT" ? (district ? [district] : []) : db.districts}
          branches={user.orgScope === "BRANCH" ? (branch ? [branch] : []) : db.branches}
          sources={db.sources.filter((s) => s.active)}
          categories={db.categories.filter((c) => c.active)}
          riskLevels={db.settings.riskLevels}
          fixedDistrict={user.orgScope !== "BANK" && district ? { id: district.id, name: district.name } : undefined}
          fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
        />
      </div>

      <Card className="mt-4">
        <CardHeader title="All Findings" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">Reference</th>
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Risk</th>
                <th className="px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {findings.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={8}>
                    {queueOnly ? "Nothing in your queue." : "No findings match these filters."}
                  </td>
                </tr>
              )}
              {findings.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link href={`/findings/${f.id}`} className="font-mono text-xs text-blue-800 hover:underline">
                      {f.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{branchName(f.branchId)}</td>
                  <td className="px-4 py-2 text-slate-600">{categoryName(f.categoryId)}</td>
                  <td className="px-4 py-2 text-slate-600">{sourceName(f.sourceId)}</td>
                  <td className="px-4 py-2 text-slate-600">{f.riskLevel}</td>
                  <td className="px-4 py-2 text-slate-900">
                    {f.currency} {f.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <FindingStatusBadge status={f.status} />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-400">{new Date(f.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
