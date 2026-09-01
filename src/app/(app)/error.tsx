"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

// Route-level error boundary for every page under (app) - catches a
// thrown error from a page Server Component (or anything it renders)
// during this navigation. Next.js requires this to be a Client Component
// (it's a real React error boundary under the hood). The raw error is
// logged here (server-side render errors still reach the browser console
// via Next's error reporting) rather than shown to the user - only a
// generic message renders, since `error.message` can carry internal
// detail (a stack frame, a file path, a raw exception from readDb()) that
// has no business being user-facing.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-lg p-6 text-center">
      <p className="text-sm font-semibold text-slate-900">Something went wrong</p>
      <p className="mt-1 text-sm text-slate-500">
        This page hit an unexpected error. You can try again, or head back to the dashboard.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Reference: {error.digest}</p>}
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => router.push("/dashboard")}>
          Go to Dashboard
        </Button>
        <Button onClick={reset}>Try Again</Button>
      </div>
    </Card>
  );
}
