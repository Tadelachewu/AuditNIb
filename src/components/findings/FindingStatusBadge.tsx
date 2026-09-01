import { Badge } from "@/components/ui/Badge";
import type { FindingStatus } from "@/types";

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
  PARTIALLY_RECTIFIED: "amber",
  RECTIFIED: "green",
  TRANSFERRED: "gray",
  RECTIFICATION_RETURNED: "amber",
  REJECTED: "red",
  RETURNED: "amber",
  CLOSED: "green",
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return <Badge tone={TONES[status]}>{status.replaceAll("_", " ")}</Badge>;
}
