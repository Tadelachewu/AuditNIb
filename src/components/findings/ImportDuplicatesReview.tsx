"use client";

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/format";
import type { DuplicateEvidence } from "@/lib/importRun";
import { findingStatusLabel } from "@/types";

export interface DuplicatesFound {
  message: string;
  totalRows: number;
  matchFields: string[];
  duplicates: DuplicateEvidence[];
}

/**
 * The import's FINAL check: rows that match existing findings (or each
 * other) under the admin-configured rule (Settings → Similar Findings).
 * Nothing has been imported yet. Shows the evidence for each match and
 * lets the importer import everything anyway, or cancel.
 */
export function ImportDuplicatesReview({
  data,
  busy,
  onImportAnyway,
  onCancel,
}: {
  data: DuplicatesFound;
  busy: boolean;
  onImportAnyway: () => void;
  onCancel: () => void;
}) {
  return (
    <Card className="border-amber-300">
      <CardHeader title={`Possible duplicates: ${data.duplicates.length} of ${data.totalRows} row(s)`} description={data.message} />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-slate-600">
          Every other check passed. A row counts as a possible duplicate when all of these match an existing finding (or an earlier row in
          this file):{" "}
          <span className="font-medium text-slate-800">{data.matchFields.join(", ")}</span> - the fields chosen in Settings → Similar Findings.
          Review the evidence, then import everything anyway (duplicates are imported as new findings, each linked in the import history to
          the finding it matched) or cancel and fix the file.
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
                        &quot;{d.existing.title}&quot; · {findingStatusLabel(d.existing.status).toLowerCase()}
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
          <Button variant="warning" onClick={onImportAnyway} disabled={busy}>
            {busy ? "Importing..." : `Import anyway - all ${data.totalRows} row${data.totalRows === 1 ? "" : "s"}, duplicates included`}
          </Button>
        </div>
      </div>
    </Card>
  );
}
