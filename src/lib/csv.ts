// CSV building/parsing for the admin list tables' Export and Import
// (client-side). Client-safe: no Node APIs.

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

// A cell starting with one of these is interpreted as a formula by Excel /
// LibreOffice / Google Sheets ("CSV injection") - e.g. a user named
// "=HYPERLINK(...)" could run something when an admin opens the export.
// Prefixing a single quote makes the spreadsheet show it as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCell(c.value(row))).join(","));
  return lines.join("\r\n");
}

/**
 * Triggers a browser download. Prefixed with a UTF-8 byte-order mark so
 * Excel opens non-Latin text (Amharic names) correctly instead of as
 * mojibake.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "districts-2026-09-29.csv" */
export function datedFileName(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, commas and line breaks
 * inside quotes, CRLF or LF. Strips a leading byte-order mark. Returns the
 * header row and one object per data row keyed by (trimmed) header; blank
 * lines are skipped.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}
