import Link from "next/link";

/**
 * One pagination bar for both server-rendered list pages (pass `hrefFor`,
 * e.g. Findings/Reports - navigation is a real page request, so the next
 * page's slice is computed server-side) and client-fetch admin pages
 * (pass `onPageChange`, e.g. Users/Branches/Audit Log - a page change
 * re-fetches that page's slice from the API rather than slicing a
 * client-held array). Renders nothing when there's nothing to page
 * through, so callers can always mount it unconditionally.
 *
 * The bar is sticky to the bottom of the screen while its list is
 * scrolled, so the count and Previous/Next are always within reach on a
 * long list instead of only after scrolling to its end - every list in the
 * app gets this from here. Mount it as the list card's last child: it only
 * sticks within that card, so it settles back into place at the end of the
 * list and never floats over anything below. Works because nothing between
 * it and the window clips or scrolls - see StickyActions' note on
 * (app)/layout.tsx's overflow-x-clip.
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
    <div className="app-card-bar sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t border-slate-200 bg-white/95 px-4 py-2.5 text-sm text-slate-500 shadow-[0_-4px_10px_-8px_rgb(15_23_42/0.25)] backdrop-blur-sm">
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
          <span className="px-1.5 text-xs text-slate-500">
            Page {page} of {totalPages}
          </span>
          {renderNav(page + 1, "Next", page >= totalPages)}
        </div>
      )}
    </div>
  );
}
