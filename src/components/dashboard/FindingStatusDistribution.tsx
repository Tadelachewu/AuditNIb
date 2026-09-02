import { Card, CardHeader } from "@/components/ui/Card";
import { DonutChart } from "@/components/dashboard/charts/DonutChart";
import { categoricalColor } from "@/components/dashboard/charts/categoricalPalette";
import type { Finding } from "@/types";

// "What fraction of all findings sit in each lifecycle stage right now?"
// is a part-to-whole question over a small, fixed set of stages (chart-
// selection rule #4: donut/pie ONLY for part-to-whole, few categories) -
// distinct from RiskDistribution (severity of *open* findings) and
// CategoryDistribution (case category breakdown): this buckets every
// finding, closed and rejected included, by where it sits in the workflow.
const STAGE_BUCKETS: { key: string; label: string; statuses: Finding["status"][] }[] = [
  { key: "review", label: "Draft / In Review", statuses: ["DRAFT", "SUBMITTED", "DISTRICT_REVIEW", "DISTRICT_APPROVED", "HO_REVIEW", "HO_APPROVED"] },
  { key: "in_progress", label: "In Progress", statuses: ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFICATION_RETURNED"] },
  { key: "rectified", label: "Rectified (awaiting close)", statuses: ["RECTIFIED"] },
  { key: "transferred", label: "Transferred", statuses: ["TRANSFERRED"] },
  { key: "closed", label: "Closed", statuses: ["CLOSED"] },
  // Not the same outcome: RETURNED is submittable (SUBMITTABLE_STATUSES in
  // submit/route.ts includes it alongside DRAFT) - the originator corrects
  // it and it re-enters review, same as RECTIFICATION_RETURNED does further
  // down the workflow. REJECTED has no such path back. Merging the two
  // into one slice would hide the difference between "still alive, needs a
  // fix" and "permanently rejected," so they're kept separate.
  { key: "returned", label: "Returned (needs correction)", statuses: ["RETURNED"] },
  { key: "rejected", label: "Rejected", statuses: ["REJECTED"] },
];

export function FindingStatusDistribution({ findings }: { findings: Finding[] }) {
  const segments = STAGE_BUCKETS.map((bucket, i) => ({
    key: bucket.key,
    label: bucket.label,
    value: findings.filter((f) => (bucket.statuses as string[]).includes(f.status)).length,
    color: categoricalColor(i),
    href: `/findings?status=${bucket.statuses.map(encodeURIComponent).join(",")}`,
  }));

  return (
    <Card>
      <CardHeader title="Finding Status Distribution" description="Every finding in scope, by current lifecycle stage - click a segment to filter" />
      <div className="p-4">
        <DonutChart segments={segments} emptyText="No findings yet." />
      </div>
    </Card>
  );
}
