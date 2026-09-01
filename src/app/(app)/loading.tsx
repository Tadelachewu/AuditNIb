// Route-level Suspense fallback for every page under (app) - Next.js
// swaps this in for {children} while the page Server Component's own data
// fetch (readDb() and everything derived from it) is still resolving, so
// the Sidebar/Topbar shell (src/app/(app)/layout.tsx) stays interactive
// the whole time rather than the entire screen going blank. Deliberately
// generic (this app's pages are heterogeneous - dashboards, tables,
// forms) rather than a page-specific skeleton; a heavier or slower route
// can still add its own more specific loading.tsx alongside its page.tsx,
// which Next.js will use instead of this one for that segment.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
    </div>
  );
}
