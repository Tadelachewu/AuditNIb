"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { appDate, setBrowserClockOffset } from "@/lib/clock";
import { formatDateTime } from "@/lib/format";

/**
 * Gives the browser the server's business-clock offset (src/lib/clock.ts),
 * so forms and filters use the same business date as the server. Set during
 * render, before any child reads the clock.
 */
export function TestClockProvider({ offsetMs, children }: { offsetMs: number; children: React.ReactNode }) {
  setBrowserClockOffset(offsetMs);
  return <>{children}</>;
}

/**
 * Shown on every page while the test clock is on (APP_TEST_NOW,
 * docs/test-clock.md), so nobody mistakes test results for real ones.
 */
export function TestClockBar() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setNow(formatDateTime(appDate().toISOString()));
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-fuchsia-700 px-4 py-1 text-xs font-semibold text-on-dark">
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      Test clock: {now ?? "…"} - business dates on this server are simulated (APP_TEST_NOW). Real timestamps are unchanged.
    </div>
  );
}
