// Skeleton placeholders shown while a list/page is loading, in place of a
// bare "Loading..." line - they hold the shape of the content that's about
// to appear, so the page doesn't jump when data lands. Pure markup (no
// hooks), usable from both Server and Client Components.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

// Varied bar widths so a skeleton table reads as rows of real text rather
// than a solid grid; cycled per row/column so adjacent cells differ.
const WIDTHS = ["w-24", "w-40", "w-32", "w-20", "w-28", "w-36", "w-16"];

/**
 * Placeholder rows for a <tbody>. Render it *inside* the table's own tbody
 * while loading, so the real header stays put and columns keep their width:
 *   <tbody>{loading ? <TableSkeletonRows cols={6} /> : rows}</tbody>
 * The last column is right-aligned and shorter, matching the row-actions
 * column every admin table ends with.
 */
export function TableSkeletonRows({ cols, rows = 6, actions = true }: { cols: number; rows?: number; actions?: boolean }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden>
          {Array.from({ length: cols }).map((_, c) => {
            const isActions = actions && c === cols - 1;
            return (
              <td key={c} className={`px-4 py-3 ${isActions ? "text-right" : ""}`}>
                <Skeleton className={`h-3.5 ${isActions ? "ml-auto w-24" : WIDTHS[(r + c) % WIDTHS.length]}`} />
              </td>
            );
          })}
        </tr>
      ))}
      <tr className="sr-only">
        <td colSpan={cols} role="status">
          Loading...
        </td>
      </tr>
    </>
  );
}

/** Placeholder for a stacked list of rows/cards (non-table lists). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col divide-y divide-slate-100" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={`h-3.5 ${WIDTHS[i % WIDTHS.length]}`} />
            <Skeleton className="h-3 w-2/3 max-w-md" />
          </div>
          <Skeleton className="h-7 w-24" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a form/settings page body: a few label+field pairs per card. */
export function FormSkeleton({ cards = 3, grid = false }: { cards?: number; grid?: boolean }) {
  return (
    <div className={grid ? "grid grid-cols-1 gap-4 xl:grid-cols-2" : "flex flex-col gap-4"} role="status" aria-label="Loading">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      ))}
    </div>
  );
}
