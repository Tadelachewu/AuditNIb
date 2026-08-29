import Link from "next/link";

/**
 * One pagination bar for both server-rendered list pages (pass `hrefFor`,
 * e.g. Findings/Reports - navigation is a real page request, so the next
 * page's slice is computed server-side) and client-fetch admin pages
 * (pass `onPageChange`, e.g. Users/Branches/Audit Log - a page change
 * re-fetches that page's slice from the API rather than slicing a
 * client-held array). Renders nothing when there's nothing to page
 * through, so callers can always mount it unconditionally.
 */
export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  hrefFor,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  hrefFor?: (page: number) => string;
  onPageChange?: (page: number) => void;
}) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const navClass = "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors";

  function renderNav(targetPage: number, label: string, disabled: boolean) {
    if (disabled) {
      return <span className={`${navClass} border-slate-200 text-slate-300`}>{label}</span>;
    }
    if (hrefFor) {
      return (
        <Link href={hrefFor(targetPage)} className={`${navClass} border-slate-300 text-slate-700 hover:bg-slate-50`}>
          {label}
        </Link>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onPageChange?.(targetPage)}
        className={`${navClass} border-slate-300 text-slate-700 hover:bg-slate-50`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500">
      <p>
        Showing{" "}
        <span className="font-medium text-slate-700">
          {start}-{end}
        </span>{" "}
        of <span className="font-medium text-slate-700">{total}</span>
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          {renderNav(page - 1, "Previous", page <= 1)}
          <span className="px-1.5 text-xs text-slate-400">
            Page {page} of {totalPages}
          </span>
          {renderNav(page + 1, "Next", page >= totalPages)}
        </div>
      )}
    </div>
  );
}
