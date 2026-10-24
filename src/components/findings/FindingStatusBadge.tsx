import { Badge } from "@/components/ui/Badge";
import { findingStatusLabel, type FindingStatus } from "@/types";

// Tone reflects severity, not just workflow stage: red is reserved for
// REJECTED, the one truly terminal-negative status (no path back - see
// HOW_IT_WORKS.md §2). RECTIFICATION_RETURNED is a recoverable
// send-back-for-correction, the exact same severity as RETURNED (both
// resubmittable, neither terminal) - previously it was red, which visually
// overstated it as equally severe as a permanent rejection. RECTIFIED is
// genuine positive progress (the full amount/case count is fixed, just
// awaiting independent verification) - previously it shared "blue" with
// every still-pending-someone-else's-action status above it, which
// under-signaled that real work was actually done.
const TONES: Record<FindingStatus, "green" | "gray" | "amber" | "red" | "blue"> = {
  DRAFT: "gray",
  SUBMITTED: "blue",
  DISTRICT_REVIEW: "blue",
  DISTRICT_APPROVED: "blue",
  HO_REVIEW: "blue",
  HO_APPROVED: "blue",
  PENDING_BANK_APPROVAL: "blue",
  SENT_TO_BRANCH_MANAGER: "amber",
  REVERSED: "amber",
  PARTIALLY_RECTIFIED: "amber",
  RECTIFIED: "green",
  TRANSFERRED: "gray",
  RECTIFICATION_RETURNED: "amber",
  REJECTED: "red",
  RETURNED: "amber",
  CLOSED: "green",
};

/**
 * Rectified by the branch but not yet accepted (closed): "pending". Used by
 * the All Findings table and the finding page; other screens keep the usual labels.
 */
export const PENDING_STATUS_LABELS: Partial<Record<FindingStatus, string>> = {
  RECTIFIED: "Rectified (pending)",
  PARTIALLY_RECTIFIED: "Partially Rectified (pending)",
};

/**
 * The status wording for one finding: "(pending)" only while some of what the
 * branch rectified is still waiting for HO to close it. Partially rectified
 * with everything rectified so far already closed is plain "Partially Rectified".
 */
export function pendingStatusLabel(status: FindingStatus, awaitingClose: boolean): string | undefined {
  return awaitingClose ? PENDING_STATUS_LABELS[status] : undefined;
}

/** Rectified (by the branch) beyond what HO has closed - cases or amount. */
export function isAwaitingClose(f: { rectifiedCases: number; rectifiedAmount: number; closedCases: number; closedAmount: number }): boolean {
  return f.rectifiedCases > f.closedCases || f.rectifiedAmount > f.closedAmount;
}

/** `label` (optional) replaces the status's usual text - same colour. */
export function FindingStatusBadge({ status, label }: { status: FindingStatus; label?: string }) {
  return <Badge tone={TONES[status]}>{label ?? findingStatusLabel(status)}</Badge>;
}
