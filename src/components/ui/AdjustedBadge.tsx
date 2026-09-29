/**
 * Marks a performance % that comes from a manual Scoring Adjustment rather
 * than the formula (see getActiveScoringAdjustment() in src/lib/findings.ts
 * and docs/scoring-adjustments.md) - so a reader can tell why a row's %
 * disagrees with its (never adjusted) case counts. The reason shows on
 * hover. Renders nothing when there's no adjustment, so it can be placed
 * unconditionally right after any performance figure. Pure markup - usable
 * in Server and Client Components.
 */
export function AdjustedBadge({ adjustment }: { adjustment: { reason: string } | null | undefined }) {
  if (!adjustment) return null;
  return (
    <span
      title={`Manually adjusted (Scoring Adjustments): "${adjustment.reason}"`}
      className="ml-1.5 inline-flex cursor-help items-center rounded bg-amber-100 px-1.5 py-px align-middle text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-300"
    >
      Adjusted
    </span>
  );
}
