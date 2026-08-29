export const DEFAULT_PAGE_SIZE = 25;

/** Parses a page number from a query-string value, defaulting to 1 for anything absent, non-numeric, or out of range. */
export function parsePage(value: string | number | undefined): number {
  const n = typeof value === "number" ? value : value ? parseInt(value, 10) : 1;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * The one place page-slicing logic lives, used by every server-rendered
 * list page (Findings, Reports) - clamps an out-of-range page (e.g. a
 * stale bookmark to page 9 after filters narrowed the result set to 2
 * pages) down to the last real page rather than rendering an empty table.
 */
export function paginate<T>(items: T[], page: number, pageSize: number = DEFAULT_PAGE_SIZE): PageResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: safePage, pageSize, total, totalPages };
}
