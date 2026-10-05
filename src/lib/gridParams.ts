import { cache } from "react";

/**
 * The current request's URL parameters, for server-paged grids
 * (src/lib/gridPage.ts) rendered deep inside a page: the page calls
 * setGridParams(await searchParams) once, and any grid below it reads them
 * with getGridParams() - no need to pass them through every component.
 * React's cache() keeps one store per request.
 */
const store = cache(() => ({ params: new URLSearchParams() }));

export function setGridParams(params: Record<string, string | string[] | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0] !== undefined) qs.set(k, v[0]);
  }
  store().params = qs;
}

export function getGridParams(): URLSearchParams {
  return store().params;
}
