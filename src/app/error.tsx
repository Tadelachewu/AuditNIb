"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientMonitoring";

// Error boundary for the pages outside the signed-in shell (login, forgot /
// reset password). Signed-in pages have their own, (app)/error.tsx; errors
// in the root layout itself are caught by global-error.tsx.
export default function RootSegmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, "root-segment");
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">Something went wrong</p>
        <p className="mt-1 text-sm text-slate-600">Please try again. If it keeps happening, contact support.</p>
        {error.digest && <p className="mt-2 font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={() => retry()}
          className="mt-4 inline-block rounded-md bg-brand-gold px-3 py-1.5 text-sm font-medium text-on-gold hover:bg-brand-gold-dark"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
