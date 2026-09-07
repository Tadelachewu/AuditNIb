import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// `detail`, when given, makes `value` a native <details>/<summary>
// disclosure instead of plain text - click (or tap) it to reveal the
// breakdown behind the number (e.g. "how is this percentage actually
// calculated") right there in the card, with no client-side JS needed.
// Optional and backward-compatible - every existing StatCard without a
// `detail` renders exactly as before.
export function StatCard({ label, value, hint, detail }: { label: string; value: ReactNode; hint?: string; detail?: ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      {detail ? (
        <details className="group mt-1">
          <summary className="cursor-pointer list-none text-2xl font-semibold text-slate-900 marker:content-none">{value}</summary>
          <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-xs leading-relaxed text-slate-600">{detail}</div>
        </details>
      ) : (
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      )}
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}
