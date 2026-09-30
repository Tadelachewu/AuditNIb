"use client";

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";
import type { DuplicateEvidence } from "@/lib/importRun";

export interface DuplicatesFound {
  message: string;
  totalRows: number;
  importableRows: number;
  matchFields: string[];
  duplicates: DuplicateEvidence[];
}

/**
 * The import's FINAL check: rows that duplicate existing findings (or each
 * other). Nothing has been imported yet. Shows the evidence for each match
 * and lets the importer import the rest without the duplicates, or cancel.
 */
export function ImportDuplicatesReview({
  data,
  busy,
  onImportRest,
  onCancel,
}: {
  data: DuplicatesFound;
  busy: boolean;
  onImportRest: () => void;
  onCancel: () => void;
}) {
  return (
    <Card className="border-amber-300">
      <CardHeader title={`Possible duplicates: ${data.duplicates.length} of ${data.totalRows} row(s)`} description={data.message} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-slate-600">
          Every other check passed. A row counts as a duplicate when all of these match an existing finding (or an earlier row in this file):{" "}
          <span className="font-medium text-slate-800">{data.matchFields.join(", ")}</span>. Title and description may differ.
        </p>
        <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-1.5 font-medium">Row</th>
                <th className="px-3 py-1.5 font-medium">Title in file</th>
                <th className="px-3 py-1.5 font-medium">Matches</th>
                <th className="px-3 py-1.5 font-medium">Evidence (matching values)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.duplicates.map((d) => (
                <tr key={d.rowNumber} className="align-top">
                  <td className="px-3 py-2 text-slate-500">{d.rowNumber}</td>
                  <td className="px-3 py-2 text-slate-800">{d.rowTitle || "—"}</td>
                  <td className="px-3 py-2">
                    {d.withinFile ? (
                      <span className="text-slate-700">Row {d.matchesRowNumber ?? "?"} of this file</span>
                    ) : d.matchesFindingId ? (
                      <Link href={`/findings/${d.matchesFindingId}`} target="_blank" className="font-mono text-blue-800 hover:underline">
                        {d.matchesReference}
                      </Link>
                    ) : (
                      <span className="font-mono">{d.matchesReference}</span>
                    )}
                    {d.existing && !d.withinFile && (
                      <p className="mt-0.5 text-slate-500">
                        &quot;{d.existing.title}&quot; · {d.existing.status.replaceAll("_", " ").toLowerCase()}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {d.existing ? (
                      <>
                        {d.existing.branch} · {d.existing.period} · {d.existing.source} · {d.existing.department} · {d.existing.category}
                        <br />
                        {d.existing.findingDate} · {d.existing.operationArea} · {d.existing.irregularityType} · {d.existing.currency}{" "}
                        {formatCurrency(d.existing.amount)} · {d.existing.caseCount} case(s)
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="cancel" onClick={onCancel} disabled={busy}>
            Cancel import
          </Button>
          <Button onClick={onImportRest} disabled={busy || data.importableRows === 0}>
            {busy ? "Importing..." : `Import without duplicates (${data.importableRows} row${data.importableRows === 1 ? "" : "s"})`}
          </Button>
        </div>
      </div>
    </Card>
  );
}
