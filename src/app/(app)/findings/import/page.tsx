"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { ImportBatch, ImportBatchRow } from "@/types";

const OUTCOME_TONE: Record<string, "green" | "amber" | "red"> = {
  imported: "green",
  duplicate: "amber",
  error: "red",
};

// Shared by a real (already-committed) ImportBatch and by a rejected dry
// run's row list (RejectedImportRow[]) - same shape apart from a rejected
// row never having a findingId, which this table never displays anyway.
type DisplayRow = Pick<ImportBatchRow, "rowNumber" | "outcome" | "reference" | "duplicateOfReference" | "error">;

function BatchRowsTable({ rows }: { rows: DisplayRow[] }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border border-slate-100">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 uppercase text-slate-400">
          <tr>
            <th className="px-3 py-1.5 font-medium">Row</th>
            <th className="px-3 py-1.5 font-medium">Outcome</th>
            <th className="px-3 py-1.5 font-medium">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r) => (
            <tr key={r.rowNumber}>
              <td className="px-3 py-1.5 text-slate-500">{r.rowNumber}</td>
              <td className="px-3 py-1.5">
                <Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge>
              </td>
              <td className="px-3 py-1.5 text-slate-700">
                {r.outcome === "imported" && r.reference}
                {r.outcome === "duplicate" && `Already exists as ${r.duplicateOfReference}`}
                {r.outcome === "error" && r.error}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ImportFindingsPage() {
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportBatch | null>(null);
  // Set instead of `result` when the whole file was rejected (any row had
  // a real validation error) - nothing was imported, so this has no batch
  // id/history entry behind it, just the row-by-row breakdown to fix from.
  const [rejected, setRejected] = useState<{ error: string; rows: ImportBatchRow[] } | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await apiGet<{ importBatches: ImportBatch[] }>("/api/findings/import");
      setHistory(res.importBatches);
    } catch {
      // A user with findings.view but not findings.import will 403 here -
      // the upload form below still explains the permission requirement.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function handleFileChange(picked: File | null) {
    setError(null);
    if (picked && !picked.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setError(`"${picked.name}" isn't a .xlsx file - download and fill in the template above, then upload that file`);
      return;
    }
    setFile(picked);
  }

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    setRejected(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/findings/import", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A rejected all-or-nothing dry run carries the full row breakdown
        // alongside the error message - a plain permission/file-shape
        // error (wrong extension, too many rows, ...) doesn't.
        if (Array.isArray(body?.rows)) {
          setRejected({ error: body.error ?? "Import failed", rows: body.rows as ImportBatchRow[] });
          return;
        }
        throw new ApiError(body?.error ?? "Import failed", res.status);
      }
      setResult(body.importBatch as ImportBatch);
      setFile(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to import file");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Import Findings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Bulk-backfill findings that are already resolved (or in progress) outside the system, from an Excel file.
          Each row&apos;s Status column must be one of{" "}
          <span className="font-medium text-slate-700">SENT_TO_BRANCH_MANAGER</span> (approved, nothing rectified
          yet), <span className="font-medium text-slate-700">TRANSFERRED</span> (moved to a later open period with
          an outstanding balance — requires a Transferred To Period Code), or{" "}
          <span className="font-medium text-slate-700">CLOSED</span> (fully resolved). Every row is fast-forwarded
          straight to that state through the same mechanism a live action would use, clearly marked in its history
          as a historical import rather than a live decision — this isn&apos;t a way to register a brand-new finding
          for live district/HO review. Reference numbers are always system-generated, never taken from the file.
        </p>
      </div>

      <Card>
        <CardHeader
          title="1. Download the template"
          description="Includes a Reference Data sheet with every currently-valid code/name to copy from."
        />
        <div className="p-4">
          <Link href="/api/findings/import/template">
            <Button variant="secondary">Download Template</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="2. Upload the completed file"
          description="All-or-nothing: every row is checked first, and if even one has a real error, nothing is imported — fix every row shown below and re-upload the whole file. A row that merely already exists (duplicate) doesn't block the rest."
        />
        <div className="flex flex-col gap-3 p-4">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="text-sm text-slate-600"
          />
          <p className="text-xs text-slate-400">
            {file ? (
              <>
                Selected: <span className="font-medium text-slate-600">{file.name}</span>
              </>
            ) : (
              "Select a .xlsx file above to enable Import."
            )}
          </p>
          <div>
            <Button onClick={handleImport} disabled={!file || uploading}>
              {uploading ? "Importing..." : "Import"}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Card>

      {rejected && (
        <Card className="border-red-200">
          <CardHeader title="Import rejected — nothing was imported" description={rejected.error} />
          <div className="p-4">
            <BatchRowsTable rows={rejected.rows} />
          </div>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader
            title="Import result"
            description={`${result.fileName} — ${result.totalRows} row(s): ${result.importedCount} imported, ${result.duplicateCount} duplicate(s)`}
          />
          <div className="p-4">
            <BatchRowsTable rows={result.rows} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Import History" description={`${history.length} run(s)`} />
        <div className="divide-y divide-slate-100">
          {loading && <p className="px-4 py-4 text-sm text-slate-400">Loading...</p>}
          {!loading && history.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No imports yet.</p>}
          {!loading &&
            history.map((b) => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">{b.fileName}</span>{" "}
                    <span className="text-xs text-slate-400">
                      by {b.importedByName} · {formatDateTime(b.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="green">{b.importedCount} imported</Badge>
                    {b.duplicateCount > 0 && <Badge tone="amber">{b.duplicateCount} duplicate</Badge>}
                    {b.errorCount > 0 && <Badge tone="red">{b.errorCount} error</Badge>}
                    <Button variant="secondary" onClick={() => setExpandedBatchId(expandedBatchId === b.id ? null : b.id)}>
                      {expandedBatchId === b.id ? "Hide" : "Details"}
                    </Button>
                  </div>
                </div>
                {expandedBatchId === b.id && (
                  <div className="mt-2">
                    <BatchRowsTable rows={b.rows} />
                  </div>
                )}
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
