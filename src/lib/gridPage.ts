import { toCsv } from "@/lib/csv";
import { parseListQuery, runListQuery, type FieldValue, type ListFieldSpec } from "@/lib/serverList";

/**
 * Server-side paging for tables whose rows a Server Component computes
 * (the Reports page's sections, the dashboards' rankings and totals).
 * The page computes every row, as before, but only one page of them goes
 * to the browser: search, column filters, sort and the page itself come
 * from the URL, under the table's own prefix so several tables on one
 * page page independently:
 *
 *   <id>.page, <id>.size        page (1-based), rows per page ("all")
 *   <id>.q                      search
 *   <id>.sort, <id>.dir         sort column, "asc" | "desc"
 *   <id>.f.<col>                column filter (exact for dropdowns, "contains" for text)
 *   <id>.min.<col>, <id>.max.<col>   range filter
 *   <id>.export                 "shown" | "all": also send the CSV of every
 *                               matching row (or every row) for download
 *
 * The client half is useGridUrlState().
 */
export interface GridPage<T> {
  id: string;
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  sort: { id: string; desc: boolean } | null;
  q: string;
  /** Column filters as the table holds them: a string, or [min, max] for ranges. */
  filters: { id: string; value: string | [string, string] }[];
  facets: Record<string, string[]>;
  /** A requested Export CSV: the file's base name and content. */
  csv: { content: string; scope: "shown" | "all" } | null;
}

export interface GridCsvColumn<T> {
  header: string;
  value: (row: T) => FieldValue;
}

/** URL parameter name of one of a grid's settings. */
export const gridParam = (id: string, name: string) => `${id}.${name}`;

/**
 * One page of `rows` per the URL `params` for grid `id`.
 * `spec.fields` = column id -> value (what is searched, filtered and sorted).
 */
export function gridPage<T>(
  id: string,
  rows: T[],
  params: URLSearchParams,
  spec: ListFieldSpec<T> & { csv: GridCsvColumn<T>[]; defaultSort?: { id: string; desc: boolean }; pageSize?: number }
): GridPage<T> {
  // Translate "<id>.x" parameters to the plain list-query ones.
  const own = new URLSearchParams();
  const prefix = `${id}.`;
  for (const [k, v] of params.entries()) {
    if (!k.startsWith(prefix)) continue;
    const name = k.slice(prefix.length);
    if (name === "size") own.set("pageSize", v);
    else if (name.startsWith("f.")) own.set(`f_${name.slice(2)}`, v);
    else if (name.startsWith("min.")) own.set(`fmin_${name.slice(4)}`, v);
    else if (name.startsWith("max.")) own.set(`fmax_${name.slice(4)}`, v);
    else own.set(name, v);
  }
  const query = parseListQuery(own, { sort: spec.defaultSort?.id, desc: spec.defaultSort?.desc, pageSize: spec.pageSize });
  const result = runListQuery(rows, query, spec);

  const filters: GridPage<T>["filters"] = Object.entries(query.filters).map(([fid, value]) => ({ id: fid, value }));
  for (const fid of new Set([...Object.keys(query.min), ...Object.keys(query.max)])) {
    filters.push({ id: fid, value: [query.min[fid] ?? "", query.max[fid] ?? ""] });
  }

  let csv: GridPage<T>["csv"] = null;
  const exportScope = own.get("export");
  if (exportScope === "shown" || exportScope === "all") {
    const all = exportScope === "all";
    const exportRows = runListQuery(rows, { ...query, ...(all ? { q: "", filters: {}, min: {}, max: {} } : {}), page: 1, pageSize: Math.max(1, rows.length) }, spec).items;
    csv = { scope: exportScope, content: toCsv(exportRows, spec.csv.map((c) => ({ header: c.header, value: (r: T) => c.value(r) ?? "" }))) };
  }

  return {
    id,
    rows: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    sort: query.sort ? { id: query.sort, desc: query.desc } : null,
    q: own.get("q") ?? "",
    filters,
    facets: result.facets,
    csv,
  };
}
