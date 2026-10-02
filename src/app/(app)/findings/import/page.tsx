"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { apiGet, ApiError, apiUpload, apiSend } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ImportDuplicatesReview, type DuplicatesFound } from "@/components/findings/ImportDuplicatesReview";
import { ImportReversePanel } from "@/components/findings/ImportReversePanel";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FileInput } from "@/components/ui/Field";
import { usePermissions } from "@/lib/permissions/PermissionsContext";
import { hasPermission } from "@/lib/permissions/registry";
import { ImportGuide } from "@/components/findings/ImportGuide";
import type { ImportBatch, ImportBatchRow } from "@/types";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { useClientPagination } from "@/lib/useClientPagination";

const OUTCOME_TONE: Record<string, "green" | "amber" | "red"> = {
  imported: "green",
  duplicate: "amber",
  error: "red",
};

// Shared by a real (already-committed) ImportBatch and by a rejected dry
// run's row list (RejectedImportRow[]) - same shape apart from a rejected
// row never having a findingId, which this table never displays anyway.
type DisplayRow = Pick<ImportBatchRow, "rowNumber" | "outcome" | "reference" | "duplicateOfReference" | "error" | "errors">;

function BatchRowsTable({ rows }: { rows: DisplayRow[] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-slate-100">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 uppercase tracking-wide text-slate-600">
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
                {r.outcome === "imported" && (r.duplicateOfReference ? `${r.reference} (imported although it matches ${r.duplicateOfReference})` : r.reference)}
                {r.outcome === "duplicate" && `Already exists as ${r.duplicateOfReference}`}
                {r.outcome === "error" &&
                  (r.errors && r.errors.length > 1 ? (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {r.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  ) : (
                    r.error
                  ))}
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
  const pager = useClientPagination(history);
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
  const permissions = usePermissions();
  const canImport = hasPermission(permissions, "findings.import");
  const canReverse = hasPermission(permissions, "findings.reverse-import");
  const { confirm, dialog } = useConfirm();
  // Duplicates are the import's final check: nothing is imported until the
  // importer decides (import the rest / cancel). `source` says what to
  // resubmit - the selected file, or a reversed batch being re-imported.
  const [duplicates, setDuplicates] = useState<{ data: DuplicatesFound; source: { kind: "upload" } | { kind: "reimport"; batchId: string } } | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  /** Shared outcome handling for an upload or a re-import attempt. */
  function handleImportFailure(err: unknown, source: { kind: "upload" } | { kind: "reimport"; batchId: string }) {
    if (err instanceof ApiError && err.code === "IMPORT_DUPLICATES_FOUND") {
      setDuplicates({ data: { ...(err.details as Omit<DuplicatesFound, "message">), message: err.message }, source });
      return;
    }
    const rows = err instanceof ApiError ? (err.details as { rows?: ImportBatchRow[] } | null)?.rows : undefined;
    if (err instanceof ApiError && err.code === "IMPORT_FILE_INVALID" && Array.isArray(rows)) {
      setRejected({ error: err.message, rows });
      return;
    }
    if (source.kind === "upload") setError(notify.formError(err, notifications.import.failed));
    else notify.fromError(err, notifications.import.reimportFailed);
  }

  function importSucceeded(batch: ImportBatch, notice = notifications.import.completed) {
    setResult(batch);
    setDuplicates(null);
    notify.success(notice, {
      description: `${batch.importedCount} finding(s) imported${
        batch.rows.some((r) => r.outcome === "imported" && r.duplicateOfReference)
          ? `, including ${batch.rows.filter((r) => r.outcome === "imported" && r.duplicateOfReference).length} possible duplicate(s)`
          : ""
      }.`,
    });
  }

  async function reimport(batch: ImportBatch, importDuplicates = false) {
    setRowBusy(batch.id);
    setResult(null);
    setRejected(null);
    try {
      const res = await apiSend<{ importBatch: ImportBatch }>(`/api/findings/import/${batch.id}/reimport`, "POST", { importDuplicates });
      importSucceeded(res.importBatch, notifications.import.reimported);
      await load();
    } catch (err) {
      handleImportFailure(err, { kind: "reimport", batchId: batch.id });
    } finally {
      setRowBusy(null);
    }
  }

  async function deleteRecord(batch: ImportBatch) {
    const ok = await confirm({
      title: "Delete this import record?",
      message: `"${batch.fileName}" and its stored original file will be removed from Import History. Its findings were already reversed. The audit log keeps a record. This can't be undone.`,
      confirmLabel: "Delete Record",
      tone: "danger",
    });
    if (ok === false) return;
    setRowBusy(batch.id);
    try {
      await apiSend(`/api/findings/import/${batch.id}`, "DELETE");
      notify.success(notifications.import.deleted);
      await load();
    } catch (err) {
      notify.fromError(err, notifications.import.deleteFailed);
    } finally {
      setRowBusy(null);
    }
  }

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

  async function handleImport(importDuplicates = false) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setResult(null);
    setRejected(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (importDuplicates) formData.append("duplicates", "import");
      const body = await apiUpload<{ importBatch: ImportBatch }>("/api/findings/import", formData);
      importSucceeded(body.importBatch);
      setFile(null);
      await load();
    } catch (err) {
      handleImportFailure(err, { kind: "upload" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Import Findings</h1>
        <p className="mt-1 text-sm text-slate-600">
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

      <ImportGuide />

      {canImport && (
      <>
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
          description="All-or-nothing: every row is checked first and every problem in every row is listed at once. If any row has an error, nothing is imported — fix them all and re-upload the whole file. Duplicates (by the Settings → Similar Findings rule) are the final check: you'll see the evidence and choose to import anyway or cancel."
        />
        <div className="flex flex-col gap-3 p-4">
          <FileInput accept=".xlsx" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
          <p className="text-xs text-slate-500">
            {file ? (
              <>
                Selected: <span className="font-medium text-slate-600">{file.name}</span>
              </>
            ) : (
              "Select a .xlsx file above to enable Import."
            )}
          </p>
          <div>
            <Button onClick={() => handleImport()} disabled={!file || uploading}>
              {uploading ? "Importing..." : "Import"}
            </Button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Card>
      </>
      )}

      {duplicates && (
        <ImportDuplicatesReview
          data={duplicates.data}
          busy={uploading || rowBusy !== null}
          onCancel={() => {
            setDuplicates(null);
            notify.info(notifications.import.cancelled);
          }}
          onImportAnyway={() => {
            const src = duplicates.source;
            if (src.kind === "upload") handleImport(true);
            else {
              const b = history.find((x) => x.id === src.batchId);
              if (b) reimport(b, true);
            }
          }}
        />
      )}

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
          {loading && <ListSkeleton rows={4} />}
          {!loading && history.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-500">No imports yet.</p>}
          {!loading &&
            pager.pageItems.map((b) => (
              <div key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">{b.fileName}</span>{" "}
                    <span className="text-xs text-slate-500">
                      by {b.importedByName} · {formatDateTime(b.createdAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {b.reversedAt && <Badge tone="gray">Reversed</Badge>}
                    <Badge tone="green">{b.importedCount} imported</Badge>
                    {b.duplicateCount > 0 && <Badge tone="amber">{b.duplicateCount} duplicate</Badge>}
                    {b.errorCount > 0 && <Badge tone="red">{b.errorCount} error</Badge>}
                    {b.storedFile && (
                      <a
                        href={`/api/findings/import/${b.id}/file`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        title="Download the original spreadsheet behind this import"
                      >
                        <Download className="h-4 w-4" />
                        Download file
                      </a>
                    )}
                    <Button variant="secondary" onClick={() => setExpandedBatchId(expandedBatchId === b.id ? null : b.id)}>
                      {expandedBatchId === b.id ? "Hide" : "Details"}
                    </Button>
                    {canReverse && !b.reversedAt && b.importedCount > 0 && (
                      <Button variant="danger" onClick={() => setReversingId(reversingId === b.id ? null : b.id)}>
                        Reverse
                      </Button>
                    )}
                    {canReverse && canImport && b.reversedAt && b.storedFile && (
                      <Button onClick={() => reimport(b)} disabled={rowBusy !== null}>
                        {rowBusy === b.id ? "Working..." : "Re-import"}
                      </Button>
                    )}
                    {canReverse && (b.reversedAt || b.importedCount === 0) && (
                      <Button variant="danger" onClick={() => deleteRecord(b)} disabled={rowBusy !== null}>
                        Delete record
                      </Button>
                    )}
                  </div>
                </div>
                {b.reversedAt && (
                  <p className="mt-1 text-xs text-slate-500">
                    Reversed by {b.reversedByName} · {formatDateTime(b.reversedAt)}
                    {b.reverseReason ? ` · "${b.reverseReason}"` : ""}
                  </p>
                )}
                {reversingId === b.id && (
                  <ImportReversePanel
                    batch={b}
                    onCancel={() => setReversingId(null)}
                    onDone={() => {
                      setReversingId(null);
                      load();
                    }}
                  />
                )}
                {expandedBatchId === b.id && (
                  <div className="mt-2">
                    <BatchRowsTable rows={b.rows} />
                  </div>
                )}
              </div>
            ))}
        </div>
        <Pagination page={pager.page} totalPages={pager.totalPages} total={pager.total} pageSize={pager.pageSize} onPageChange={pager.setPage} />
      </Card>
      {dialog}
    </div>
  );
}
