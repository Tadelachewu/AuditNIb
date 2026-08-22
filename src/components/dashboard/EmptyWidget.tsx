import type { ReactNode } from "react";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * Placeholder for a BRD-specified dashboard widget that needs Finding/
 * Rectification data which doesn't exist in the app yet (no Finding entity
 * - see PHASE4.md). Deliberately not a fabricated chart with fake numbers:
 * this states plainly what will appear here and why it's empty now.
 */
export function EmptyWidget({
  title,
  description,
  className = "",
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} />
      <div className="flex min-h-[140px] flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-sm font-medium text-slate-400">No data yet</p>
        <p className="max-w-xs text-xs text-slate-400">{description}</p>
        {children}
      </div>
    </Card>
  );
}
