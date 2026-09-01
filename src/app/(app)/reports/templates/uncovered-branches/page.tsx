import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { getUncoveredBranches } from "@/lib/reportTemplates";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";
import { UncoveredBranchesTable } from "@/components/reports/UncoveredBranchesTable";

// The "Uncovered Branches" template - branches with zero findings this
// period, and why (see BranchCoverageNote). Recording/editing the reason
// is gated by the same permission that lets you view this page at all.
export default async function UncoveredBranchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "uncovered-branches"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const openPeriod = db.reportingPeriods.find((p) => p.status === "OPEN");
  const periodId = (typeof params.periodId === "string" && params.periodId) || openPeriod?.id || db.reportingPeriods[0]?.id || "";
  const period = db.reportingPeriods.find((p) => p.id === periodId);
  const rows = periodId ? getUncoveredBranches(db, periodId) : [];

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Uncovered Branches</h1>
          <p className="mt-1 text-sm text-slate-500">Branches with no findings submitted this period, and why.</p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/uncovered-branches/export?periodId=${periodId}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="no-print flex items-end gap-2">
        <div>
          <Label htmlFor="periodId">Period</Label>
          <Select id="periodId" name="periodId" defaultValue={periodId}>
            {db.reportingPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      <Card>
        <CardHeader title="Uncovered Branches" description={period ? `As of ${period.code} - ${rows.length} branch(es)` : "No reporting period"} />
        <UncoveredBranchesTable rows={rows} periodId={periodId} reasons={db.uncoveredReasons} />
      </Card>
    </div>
  );
}
