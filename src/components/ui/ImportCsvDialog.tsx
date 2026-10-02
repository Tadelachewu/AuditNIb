"use client";

import { useRef, useState } from "react";
import { Upload, FileDown, CheckCircle2, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/AddDialog";
import { Button } from "@/components/ui/Button";
import { StickyActions } from "@/components/ui/StickyActions";
import { notify, notifications, presentError } from "@/lib/notify";
import { parseCsv, toCsv, downloadCsv, datedFileName } from "@/lib/csv";

export interface ImportColumn {
  /** Exact CSV header. */
  key: string;
  required?: boolean;
  example: string;
  help: string;
  /** Never written back into the downloadable results file (e.g. a temporary password). */
  sensitive?: boolean;
}

type RowResult = { rowNumber: number; label: string; ok: boolean; message: string };

const MAX_ROWS = 1000;

/**
 * Bulk-create for an admin list from a CSV file (the "Import CSV" button in
 * the table toolbar). Every row goes through the SAME create API as the
 * page's own Add form - one request per row, in order - so every existing
 * validation, uniqueness check, permission and audit-log entry applies
 * unchanged; the importer can never do more than adding rows by hand.
 * A failing row doesn't stop the rest; each row's outcome is listed and
 * can be downloaded to fix and re-import just the failures.
 */
export function ImportCsvDialog({
  entityLabel,
  templateName,
  columns,
  toPayload,
  submit,
  onDone,
}: {
  /** e.g. "districts" */
  entityLabel: string;
  /** Template/results file base name, e.g. "districts-import". */
  templateName: string;
  columns: ImportColumn[];
  /** Turns one CSV row into the create request's body, or explains why it can't. */
  toPayload: (row: Record<string, string>) => { payload: unknown; label: string } | { error: string; label: string };
  submit: (payload: unknown) => Promise<unknown>;
  /** Called after an import run (to reload the list). */
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const cancelRef = useRef(false);

  function reset() {
    setFileName(null);
    setRows(null);
    setParseError(null);
    setProgress(0);
    setResults(null);
    cancelRef.current = false;
  }

  function close() {
    cancelRef.current = true;
    setOpen(false);
    if (results) onDone();
    reset();
  }

  function downloadTemplate() {
    const example = Object.fromEntries(columns.map((c) => [c.key, c.example]));
    downloadCsv(`${templateName}-template.csv`, toCsv([example], columns.map((c) => ({ header: c.key, value: (r: Record<string, string>) => r[c.key] }))));
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    setFileName(file.name);
    if (file.size > 2 * 1024 * 1024) {
      setParseError("File is larger than 2 MB - split it into smaller files.");
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    const missing = columns.filter((c) => c.required && !parsed.headers.includes(c.key)).map((c) => c.key);
    if (missing.length) {
      setParseError(`Missing required column(s): ${missing.join(", ")}. Use the template's exact headers.`);
      return;
    }
    if (parsed.rows.length === 0) {
      setParseError("No data rows found below the header.");
      return;
    }
    if (parsed.rows.length > MAX_ROWS) {
      setParseError(`This file has ${parsed.rows.length} rows - import at most ${MAX_ROWS} at a time.`);
      return;
    }
    setRows(parsed.rows);
  }

  async function run() {
    if (!rows) return;
    setRunning(true);
    cancelRef.current = false;
    const out: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (cancelRef.current) break;
      const rowNumber = i + 2; // row 1 is the header
      const prepared = toPayload(rows[i]);
      if ("error" in prepared) {
        out.push({ rowNumber, label: prepared.label, ok: false, message: prepared.error });
      } else {
        try {
          await submit(prepared.payload);
          out.push({ rowNumber, label: prepared.label, ok: true, message: "Added" });
        } catch (err) {
          out.push({ rowNumber, label: prepared.label, ok: false, message: presentError(err).message });
        }
      }
      setProgress(i + 1);
      setResults([...out]);
    }
    setRunning(false);
    const ok = out.filter((r) => r.ok).length;
    const notOk = out.length - ok;
    if (notOk === 0) notify.success(notifications.csvImport.completed, { description: `${ok} row(s) added.` });
    else notify.error(notifications.csvImport.partialFailed, { description: `${ok} added, ${notOk} failed - see the results below.` });
  }

  function downloadResults() {
    if (!results || !rows) return;
    const withStatus = results.map((r) => ({ ...rows[r.rowNumber - 2], Result: r.ok ? "Added" : "Failed", Message: r.message }));
    const headers = [...columns.filter((c) => !c.sensitive).map((c) => c.key), "Result", "Message"];
    downloadCsv(datedFileName(`${templateName}-results`), toCsv(withStatus, headers.map((h) => ({ header: h, value: (r: Record<string, string>) => r[h] }))));
  }

  const added = results?.filter((r) => r.ok).length ?? 0;
  const failed = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Add many ${entityLabel} at once from a CSV file`}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        <Upload className="h-4 w-4" />
        Import CSV
      </button>
      {open && (
        <Modal title={`Import ${entityLabel} from CSV`} description="Each row is added exactly as if entered with the Add form." size="lg" onClose={close}>
          <div className="flex flex-col gap-4 p-4 text-sm">
            <div>
              <p className="font-medium text-slate-900">1. Get the template</p>
              <p className="mt-0.5 text-slate-600">Keep the first row (the column headers) exactly as it is. One {entityLabel.replace(/s$/, "")} per row.</p>
              <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-1.5 font-semibold">Column</th>
                      <th className="px-3 py-1.5 font-semibold">Required</th>
                      <th className="px-3 py-1.5 font-semibold">What to Put</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {columns.map((c) => (
                      <tr key={c.key}>
                        <td className="px-3 py-1.5 font-mono text-slate-900">{c.key}</td>
                        <td className="px-3 py-1.5 text-slate-700">{c.required ? "Yes" : "No"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{c.help}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={downloadTemplate} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline">
                <FileDown className="h-4 w-4" /> Download template
              </button>
            </div>

            <div>
              <p className="font-medium text-slate-900">2. Choose your filled-in CSV</p>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={running}
                onChange={(e) => void onFile(e.target.files?.[0])}
                className="mt-1.5 block text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-gold file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-on-gold hover:file:bg-brand-gold-dark"
              />
              {parseError && <p className="mt-2 text-red-600">{parseError}</p>}
              {rows && !results && (
                <p className="mt-2 text-slate-700">
                  <span className="font-medium">{fileName}</span>: {rows.length} row(s) ready to import.
                </p>
              )}
            </div>

            {results && (
              <div>
                <p className="font-medium text-slate-900">
                  3. Results {running && `(${progress} of ${rows?.length})`}
                </p>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-brand-gold transition-all" style={{ width: `${rows ? (progress / rows.length) * 100 : 0}%` }} />
                </div>
                <p className="mt-2 text-slate-700">
                  <span className="font-medium text-emerald-700">{added} added</span> · <span className="font-medium text-red-700">{failed} failed</span>
                </p>
                <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">Row</th>
                        <th className="px-3 py-1.5 font-semibold">Record</th>
                        <th className="px-3 py-1.5 font-semibold">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map((r) => (
                        <tr key={r.rowNumber}>
                          <td className="px-3 py-1.5 text-slate-500">{r.rowNumber}</td>
                          <td className="px-3 py-1.5 text-slate-900">{r.label}</td>
                          <td className={`px-3 py-1.5 ${r.ok ? "text-emerald-700" : "text-red-700"}`}>
                            <span className="inline-flex items-center gap-1">
                              {r.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                              {r.message}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <StickyActions>
              {results && !running && (
                <Button type="button" variant="secondary" onClick={downloadResults}>
                  Download results
                </Button>
              )}
              <Button type="button" variant="cancel" onClick={close}>
                {results && !running ? "Close" : "Cancel"}
              </Button>
              {!results && (
                <Button type="button" disabled={!rows || running} onClick={() => void run()}>
                  Import {rows ? `${rows.length} row(s)` : ""}
                </Button>
              )}
            </StickyActions>
          </div>
        </Modal>
      )}
    </>
  );
}
