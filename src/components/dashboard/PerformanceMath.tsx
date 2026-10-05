// "Click the % to see how it was calculated" - one explanation for every
// performance percentage on the dashboards and reports (stat cards, top /
// bottom lists, ranking tables, IC + IA summary), so the same figure always
// explains itself the same way. Plain markup (no hooks, no server imports):
// usable from Server and Client Components alike. A performance % is always
// closed eligible cases ÷ eligible cases × 100 (computeEligibleCaseCounts()
// in src/lib/findings.ts) - unless it's closed, a case never counts.

export interface PerformanceCounts {
  rectifiedCases: number;
  totalCases: number;
}

const pct = (c: PerformanceCounts) => (c.rectifiedCases / c.totalCases) * 100;

/** The calculation behind a performance %, as a short explanation. */
export function PerformanceCalculation({ counts, formula }: { counts: PerformanceCounts; formula?: string }) {
  return (
    <>
      <p>
        <span className="font-medium text-slate-900">{counts.rectifiedCases}</span> of{" "}
        <span className="font-medium text-slate-900">{counts.totalCases}</span> eligible case(s) closed (unless it&apos;s closed, it never
        counts as rectified):
      </p>
      <p className="mt-0.5 tabular-nums">
        {counts.rectifiedCases} ÷ {counts.totalCases} × 100 = <span className="font-semibold text-slate-900">{pct(counts).toFixed(1)}%</span>
      </p>
      {formula && <p className="mt-1 text-slate-500">Formula: {formula}</p>}
    </>
  );
}

/**
 * A performance % that opens its calculation when clicked (and closes on a
 * second click). "--" when there are no eligible cases in scope.
 */
export function PerformancePct({
  counts,
  formula,
  className = "font-medium text-slate-700",
  align = "right",
}: {
  counts: PerformanceCounts | null;
  formula?: string;
  className?: string;
  align?: "left" | "right";
}) {
  if (!counts || counts.totalCases === 0) return <span className={className}>--</span>;
  return (
    <details className={`group ${align === "right" ? "text-right" : ""}`}>
      <summary
        className={`cursor-pointer list-none tabular-nums underline decoration-slate-400 decoration-dotted underline-offset-4 marker:content-none hover:decoration-solid ${className}`}
        title="Show how this % is calculated"
      >
        {pct(counts).toFixed(1)}%
      </summary>
      <div className={`mt-1 max-w-[16rem] text-xs font-normal leading-relaxed text-slate-500 ${align === "right" ? "ml-auto text-left" : ""}`}>
        <PerformanceCalculation counts={counts} formula={formula} />
      </div>
    </details>
  );
}
