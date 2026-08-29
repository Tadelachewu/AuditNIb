"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { ImportBatch } from "@/types";

const OUTCOME_TONE: Record<string, "green" | "amber" | "red"> = {
  imported: "green",
  duplicate: "amber",
  error: "red",
};

function BatchRows({ batch }: { batch: ImportBatch }) {
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
          {batch.rows.map((r) => (
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
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/findings/import", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body?.error ?? "Import failed", res.status);
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
          Bulk-register Internal Audit findings from an Excel file. Every row goes through the same DRAFT-first
          workflow as a manually-registered finding — importing doesn&apos;t skip district/HO review. Reference
          numbers are always system-generated, never taken from the file.
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
        <CardHeader title="2. Upload the completed file" description="Rows are validated and deduplicated independently — one bad row won't block the rest." />
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

      {result && (
        <Card>
          <CardHeader
            title="Import result"
            description={`${result.fileName} — ${result.totalRows} row(s): ${result.importedCount} imported, ${result.duplicateCount} duplicate(s), ${result.errorCount} error(s)`}
          />
          <div className="p-4">
            <BatchRows batch={result} />
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
                      by {b.importedByName} · {new Date(b.createdAt).toLocaleString()}
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
                    <BatchRows batch={b} />
                  </div>
                )}
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
