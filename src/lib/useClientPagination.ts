"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/**
 * Pages a list that's already fully loaded client-side (small reference
 * lists: districts, categories, roles, ...), for use with <Pagination
 * onPageChange>. Same page size as the server-paginated lists (Users,
 * Branches, Audit Log, Findings), so every list in the app pages the same
 * way. Clamps back to the last page when the list shrinks (e.g. deleting
 * the only row on the final page) instead of stranding the user on an
 * empty page.
 */
export function useClientPagination<T>(items: T[], pageSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const current = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize]
  );

  return { page: current, setPage, pageItems, total, totalPages, pageSize };
}
