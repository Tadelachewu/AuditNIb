import { Skeleton, TableSkeletonRows } from "@/components/ui/Skeleton";

// Route-level Suspense fallback for every page under (app) - Next.js
// swaps this in for {children} while the page Server Component's own data
// fetch (readDb() and everything derived from it) is still resolving, so
// the Sidebar/Topbar shell (src/app/(app)/layout.tsx) stays interactive
// the whole time rather than the entire screen going blank. Deliberately
// generic (this app's pages are heterogeneous - dashboards, tables,
// forms) rather than a page-specific skeleton; a heavier or slower route
// can still add its own more specific loading.tsx alongside its page.tsx,
// which Next.js will use instead of this one for that segment. Built from
// the same Skeleton primitives as every in-page list, so a navigation
// and a client-side reload look like the same loading state.
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="app-card rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="app-card overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <Skeleton className="h-4 w-36" />
        </div>
        <table className="w-full">
          <tbody className="divide-y divide-slate-100">
            <TableSkeletonRows cols={5} rows={6} actions={false} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
