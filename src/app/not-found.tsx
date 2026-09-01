import Link from "next/link";

// Root not-found boundary - Next.js renders this for any URL that
// doesn't match a route anywhere in the app (there's no nested route
// segment for it to have descended into, so (app)/layout.tsx's
// Sidebar/Topbar shell never mounts here - a plain standalone page is
// correct). The Finding-detail page's own "record not found" state
// (src/app/(app)/findings/[id]/page.tsx) is a separate, existing concern -
// a valid route with a missing record, not an unmatched URL - and is
// left as-is.
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Page not found</p>
        <p className="mt-1 text-sm text-slate-500">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block rounded-md bg-brand-gold px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-brand-gold-dark"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
