import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { formatNumber, formatDateTime } from "@/lib/format";
import { getTransferredFindings } from "@/lib/reportTemplates";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select, Label } from "@/components/ui/Field";
import { PrintButton } from "@/components/reports/PrintButton";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";

// Not modeled on a bank Excel sheet like the other 10 templates - a
// bank-wide, one-row-per-hop register of Document_3 §15's own Transfer
// Data, requested directly. See getTransferredFindings()'s own doc comment
// in src/lib/reportTemplates.ts for the three layers of detail every row
// carries: the original period's own data, what happened on it before it
// left, and where it went plus its live status today.
export default async function TransferredFindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user.permissions, permissionKey("report-templates", "transferred-findings"))) redirect("/reports/templates");

  const db = readDb();
  const params = await searchParams;
  const fromPeriodId = typeof params.fromPeriodId === "string" ? params.fromPeriodId : "";
  const toPeriodId = typeof params.toPeriodId === "string" ? params.toPeriodId : "";

  const rows = getTransferredFindings(db, {
    fromPeriodId: fromPeriodId || undefined,
    toPeriodId: toPeriodId || undefined,
  });

  const totalCasesTransferred = rows.reduce((sum, r) => sum + r.transfer.casesTransferred, 0);
  const totalAmountTransferred = rows.reduce((sum, r) => sum + r.transfer.amountTransferred, 0);
  const stillOutstandingCount = rows.filter((r) => r.isLatestHop && r.currentOutstandingCases > 0 && r.currentStatus !== "CLOSED").length;
  const periodsSorted = [...db.reportingPeriods].sort((a, b) => b.code.localeCompare(a.code));

  return (
    <div className="flex flex-col gap-5">
      <style>{`@media print { nav, header, .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/reports/templates" className="text-xs text-blue-800 hover:underline">
            ← Report Templates
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">Transferred Findings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every transfer hop, bank-wide: original-period detail, what happened before it left, where it went, and its status today.
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/report-templates/transferred-findings/export?fromPeriodId=${fromPeriodId}&toPeriodId=${toPeriodId}`}>
            <span className="inline-flex items-center rounded-md border border-brand-gold-dark bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-brand-gold-dark">
              Download CSV
            </span>
          </a>
          <PrintButton />
        </div>
      </div>

      <form method="GET" className="no-print flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="fromPeriodId">From period (origin)</Label>
          <Select id="fromPeriodId" name="fromPeriodId" defaultValue={fromPeriodId}>
            <option value="">All periods</option>
            {periodsSorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="toPeriodId">To period (destination)</Label>
          <Select id="toPeriodId" name="toPeriodId" defaultValue={toPeriodId}>
            <option value="">All periods</option>
            {periodsSorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} {p.status === "LOCKED" ? "(locked)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit">View</Button>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Transfer Hops" value={rows.length} hint="Matching current filter" />
        <StatCard label="Cases Transferred" value={formatNumber(totalCasesTransferred)} hint="Sum of outstanding cases moved" />
        <StatCard label="Amount Transferred" value={formatNumber(totalAmountTransferred)} hint="Sum of outstanding amount moved" />
        <StatCard label="Still Outstanding" value={stillOutstandingCount} hint="Latest hop, not yet closed" />
      </div>

      <Card>
        <CardHeader
          title="Transfer Register"
          description={rows.length === 0 ? "No transfers match this filter." : `${rows.length} transfer hop(s), most recent first`}
        />
        <div className="flex flex-col gap-3 divide-y divide-slate-100 p-4">
          {rows.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No transfers recorded yet.</p>}
          {rows.map((r) => (
            <div key={r.transfer.id} className="flex flex-col gap-2 pt-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/findings/${r.finding.id}`} className="font-mono text-xs text-blue-800 hover:underline">
                    {r.finding.reference}
                  </Link>
                  <Badge tone={r.transfer.method === "AUTOMATIC" ? "blue" : "gray"}>
                    {r.transfer.method === "AUTOMATIC" ? "Auto Transfer" : "Manual Transfer"}
                  </Badge>
                  {r.totalHops > 1 && (
                    <Badge tone="gray">
                      Hop {r.hopNumber} of {r.totalHops}
                    </Badge>
                  )}
                  <span className="text-slate-500">
                    <span className="font-medium text-slate-800">{r.fromPeriod?.code ?? r.transfer.fromPeriodId}</span>{" "}
                    <span aria-hidden>→</span>{" "}
                    <span className="font-medium text-slate-900">{r.toPeriod?.code ?? r.transfer.toPeriodId}</span>
                  </span>
                </div>
                <span className="text-xs text-slate-400">{formatDateTime(r.transfer.createdAt)}</span>
              </div>

              <p className="text-xs text-slate-500">
                {r.district?.name ?? "Unknown district"} · {r.branch?.name ?? "Unknown branch"} · {r.category?.name ?? "Unknown category"} ·{" "}
                {r.source?.name ?? "Unknown source"} · Risk: {r.finding.riskLevel}
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase text-slate-400">Original Period Data</p>
                  <dl className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Previous Reporting Month</dt>
                      <dd className="font-medium text-slate-800">{r.fromPeriod?.code ?? r.transfer.fromPeriodId}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Case Count</dt>
                      <dd className="font-medium text-slate-800">{formatNumber(r.transfer.originalCaseCount)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Amount</dt>
                      <dd className="font-medium text-slate-800">
                        {r.finding.currency} {formatNumber(r.transfer.originalAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Case Age at Transfer</dt>
                      <dd className="font-medium text-slate-800">{r.transfer.caseAgeAtTransferDays}d</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase text-slate-400">What Happened Before It Left</p>
                  <dl className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Resolved Before Transfer (Cases)</dt>
                      <dd className="font-medium text-emerald-700">{formatNumber(r.resolvedBeforeTransferCases)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Resolved Before Transfer (Amount)</dt>
                      <dd className="font-medium text-emerald-700">
                        {r.finding.currency} {formatNumber(r.resolvedBeforeTransferAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Cases Transferred</dt>
                      <dd className="font-medium text-amber-700">{formatNumber(r.transfer.casesTransferred)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Amount Transferred</dt>
                      <dd className="font-medium text-amber-700">
                        {r.finding.currency} {formatNumber(r.transfer.amountTransferred)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-md bg-slate-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase text-slate-400">
                    Where It Transfers, and Status Today
                  </p>
                  <dl className="flex flex-col gap-1 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">New Reporting Month</dt>
                      <dd className="font-medium text-slate-800">{r.toPeriod?.code ?? r.transfer.toPeriodId}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="text-slate-500">Current Status{r.isLatestHop ? "" : " (superseded by a later hop)"}</dt>
                      <dd>
                        <FindingStatusBadge status={r.currentStatus} />
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Current Outstanding (Cases)</dt>
                      <dd className="font-medium text-slate-800">{formatNumber(r.currentOutstandingCases)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Case Age Today</dt>
                      <dd className="font-medium text-slate-800">{r.caseAgeDaysNow}d</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  Transferred by <span className="font-medium text-slate-700">{r.transfer.createdByName}</span>: {r.transfer.reason}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
