import { Badge } from "@/components/ui/Badge";
import type { FindingStatus } from "@/types";

const TONES: Record<FindingStatus, "green" | "gray" | "amber" | "red" | "blue"> = {
  DRAFT: "gray",
  SUBMITTED: "blue",
  DISTRICT_REVIEW: "blue",
  DISTRICT_APPROVED: "blue",
  HO_REVIEW: "blue",
  HO_APPROVED: "blue",
  SENT_TO_BRANCH_MANAGER: "amber",
  PARTIALLY_RECTIFIED: "amber",
  RECTIFIED: "blue",
  TRANSFERRED: "gray",
  REJECTED: "red",
  RETURNED: "amber",
  CLOSED: "green",
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  return <Badge tone={TONES[status]}>{status.replaceAll("_", " ")}</Badge>;
}
