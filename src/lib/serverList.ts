import { ALL_ROWS, DEFAULT_PAGE_SIZE, paginate, parsePage } from "@/lib/pagination";

/**
 * Server-side search / filter / sort / paging for any list API - the server
 * half of server-paged tables (the client half is useServerList()). Every
 * list API that takes `page` returns one page this way, with the same URL
 * parameters everywhere:
 *
 *   page, pageSize      page number (1-based); rows per page, or "all"
 *   q                   text search: every word must appear in one of the
 *                       list's searchable fields (case-insensitive)
 *   sort, dir           field id to sort by; "asc" | "desc"
 *   f_<field>=value     column filter: exact match for "select" fields,
 *                       "contains" for text fields
 *   fmin_<field>, fmax_<field>   range filter (numbers or dates)
 *
 * Without `page` an API keeps returning its whole list (used for dropdowns
 * and lookups elsewhere). See isListRequest().
 */
export type FieldValue = string | number | boolean | null | undefined;

export interface ListFieldSpec<T> {
  /** Field id -> value, matching the table's column id / accessorKey. */
  fields: Record<string, (row: T) => FieldValue>;
  /** Fields the `q` search looks in (default: every field). */
  search?: string[];
  /** Fields filtered by exact value (dropdown filters); their distinct values come back as `facets`. */
  exact?: string[];
}

export interface ListQuery {
  q: string;
  sort: string | null;
  desc: boolean;
  page: number;
  pageSize: number;
  filters: Record<string, string>;
  min: Record<string, string>;
  max: Record<string, string>;
}

/** True when the request asks for one page (a server-paged table) rather than the whole list. */
export function isListRequest(sp: URLSearchParams): boolean {
  return sp.has("page") || sp.has("pageSize");
}

export function parseListQuery(sp: URLSearchParams, defaults: { sort?: string; desc?: boolean; pageSize?: number } = {}): ListQuery {
  const filters: Record<string, string> = {};
  const min: Record<string, string> = {};
  const max: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (!v) continue;
    if (k.startsWith("f_")) filters[k.slice(2)] = v;
    else if (k.startsWith("fmin_")) min[k.slice(5)] = v;
    else if (k.startsWith("fmax_")) max[k.slice(5)] = v;
  }
  const rawSize = sp.get("pageSize");
  const pageSize = rawSize === "all" ? ALL_ROWS : Math.min(ALL_ROWS, Math.max(1, Number(rawSize) || defaults.pageSize || DEFAULT_PAGE_SIZE));
  return {
    q: (sp.get("q") ?? "").trim().toLowerCase(),
    sort: sp.get("sort") || defaults.sort || null,
    desc: sp.get("dir") ? sp.get("dir") === "desc" : Boolean(defaults.desc),
    page: parsePage(sp.get("page") ?? undefined),
    pageSize,
    filters,
    min,
    max,
  };
}

const text = (v: FieldValue) => (v === null || v === undefined ? "" : String(v));

const blank = (v: FieldValue) => v === null || v === undefined || v === "";

/** Ascending order of two non-blank values. */
function compare(a: FieldValue, b: FieldValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function inRange(v: FieldValue, lo?: string, hi?: string): boolean {
  if (lo === undefined && hi === undefined) return true;
  if (blank(v)) return false;
  if (typeof v === "number") {
    if (lo !== undefined && v < Number(lo)) return false;
    if (hi !== undefined && v > Number(hi)) return false;
    return true;
  }
  // Dates / ISO strings: compare by the date part.
  const s = String(v).slice(0, 10);
  if (lo !== undefined && s < lo.slice(0, 10)) return false;
  if (hi !== undefined && s > hi.slice(0, 10)) return false;
  return true;
}

export interface ListPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Distinct values of the `exact` fields across the whole list (for dropdown filters). */
  facets: Record<string, string[]>;
}

export function runListQuery<T>(rows: T[], query: ListQuery, spec: ListFieldSpec<T>): ListPage<T> {
  const fieldIds = Object.keys(spec.fields);
  const searchIds = spec.search ?? fieldIds;
  const exact = new Set(spec.exact ?? []);
  const words = query.q ? query.q.split(/\s+/) : [];

  const filtered = rows.filter((row) => {
    for (const [id, want] of Object.entries(query.filters)) {
      const get = spec.fields[id];
      if (!get) continue;
      const v = text(get(row));
      if (exact.has(id) ? v !== want : !v.toLowerCase().includes(want.toLowerCase())) return false;
    }
    for (const id of new Set([...Object.keys(query.min), ...Object.keys(query.max)])) {
      const get = spec.fields[id];
      if (get && !inRange(get(row), query.min[id], query.max[id])) return false;
    }
    if (words.length) {
      const hay = searchIds.map((id) => text(spec.fields[id]?.(row))).join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  const sortGet = query.sort ? spec.fields[query.sort] : undefined;
  if (sortGet) {
    filtered.sort((a, b) => {
      const va = sortGet(a);
      const vb = sortGet(b);
      // Blanks ("--") last in either direction.
      if (blank(va) || blank(vb)) return blank(va) === blank(vb) ? 0 : blank(va) ? 1 : -1;
      return compare(va, vb) * (query.desc ? -1 : 1);
    });
  }

  const facets: Record<string, string[]> = {};
  for (const id of exact) {
    const get = spec.fields[id];
    if (get) facets[id] = [...new Set(rows.map((r) => text(get(r))).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }

  const result = paginate(filtered, query.page, query.pageSize);
  return { ...result, facets };
}

/**
 * For a list API's GET: when the request asks for a page (isListRequest),
 * returns `{ [key]: pageRows, total, page, pageSize, totalPages, facets }`;
 * otherwise null, and the API returns its whole list as before.
 */
export function listPageJson<T>(
  request: Request,
  key: string,
  rows: T[],
  spec: ListFieldSpec<T>,
  defaults: { sort?: string; desc?: boolean } = {}
): Record<string, unknown> | null {
  const sp = new URL(request.url).searchParams;
  if (!isListRequest(sp)) return null;
  const { items, ...rest } = runListQuery(rows, parseListQuery(sp, defaults), spec);
  return { [key]: items, ...rest };
}
