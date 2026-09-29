import type { Database, District, ScoringAdjustment } from "@/types";
import { computePerformance, computeEligibleCaseCounts, getActiveScoringAdjustment } from "@/lib/findings";
import { RankingGrid } from "@/components/dashboard/RankingGrid";
import { Card, CardHeader } from "@/components/ui/Card";

interface DistrictRow {
  district: District;
  branchCount: number;
  totalCases: number;
  rectifiedCases: number;
  outstandingCases: number;
  performance: number | null;
  // Set when `performance` comes from an active Scoring Adjustment.
  adjustment: ScoringAdjustment | null;
}

/**
 * Document_3 §17's "District Ranking": Rank/District/Branches/Cases/
 * Performance, for Head Office users - branch count per district is
 * dynamic (db.branches.filter(...).length), not a fixed number, since
 * different districts have different numbers of branches. Total/Rectified/
 * Outstanding come from computeEligibleCaseCounts() - the exact same
 * function computePerformance() itself divides to get the Performance %
 * shown in the same row - not a hand-rolled raw findings reduce (every
 * category, self-reported rectifiedCases), which could disagree with what
 * the percentage right next to it actually means.
 */
export function DistrictRankingTable({
  db,
  districts,
  openPeriod,
  allPeriods = false,
  title = "District Ranking",
  description = "All districts, ranked by performance, current period",
}: {
  db: Database;
  districts: District[];
  openPeriod?: { id: string };
  /** FilterBar's "All periods" choice (ALL_PERIODS_VALUE) - aggregates across every period instead of one; `openPeriod` is undefined in this mode. */
  allPeriods?: boolean;
  title?: string;
  description?: string;
}) {
  const hasScope = allPeriods || Boolean(openPeriod);
  const rows: DistrictRow[] = districts.map((d) => {
    const branchCount = db.branches.filter((b) => b.districtId === d.id && b.status === "ACTIVE").length;
    const eligible = hasScope
      ? computeEligibleCaseCounts(db, { districtId: d.id, periodId: allPeriods ? undefined : openPeriod!.id })
      : null;
    const totalCases = eligible?.totalCases ?? 0;
    const rectifiedCases = eligible?.rectifiedCases ?? 0;
    const performance = hasScope
      ? computePerformance(db, { districtId: d.id, periodId: allPeriods ? undefined : openPeriod!.id })
      : null;
    const adjustment = hasScope ? getActiveScoringAdjustment(db, { districtId: d.id, periodId: allPeriods ? undefined : openPeriod!.id }) : null;
    return { district: d, branchCount, totalCases, rectifiedCases, outstandingCases: totalCases - rectifiedCases, performance, adjustment };
  });

  const ranked = [...rows].sort((a, b) => (b.performance ?? -1) - (a.performance ?? -1));

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <RankingGrid
        kind="district"
        hasScope={hasScope}
        exportFileName="district-ranking"
        rows={ranked.map((row, i) => ({
          id: row.district.id,
          rank: i + 1,
          name: row.district.name,
          href: `/findings?districtId=${row.district.id}`,
          branchCount: row.branchCount,
          totalCases: row.totalCases,
          rectifiedCases: row.rectifiedCases,
          outstandingCases: row.outstandingCases,
          performance: row.performance,
          adjustmentReason: row.adjustment?.reason ?? null,
        }))}
      />
    </Card>
  );
}
