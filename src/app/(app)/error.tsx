"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { reportClientError } from "@/lib/clientMonitoring";

// Route-segment error boundary for every signed-in page under (app): an
// unexpected error while rendering a page keeps the sidebar/top bar and
// shows this card in place of the page only. Must be a Client Component.
//
// Never shows error.message: for Server Component errors Next replaces it
// with a generic text in production anyway, and a Client Component error's
// message can still carry internals. The `digest` is the reference that
// matches the server log line (onRequestError in src/instrumentation.ts).
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const router = useRouter();

  useEffect(() => {
    reportClientError(error, "app-segment");
  }, [error]);

  return (
    <Card className="mx-auto max-w-lg p-6 text-center">
      <p className="text-sm font-semibold text-slate-900">Something went wrong</p>
      <p className="mt-1 text-sm text-slate-600">
        This page hit an unexpected error. You can try again, or head back to the dashboard.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-500">Reference: {error.digest}</p>}
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => router.push("/dashboard")}>
          Go to Dashboard
        </Button>
        <Button onClick={() => retry()}>Try Again</Button>
      </div>
    </Card>
  );
}
