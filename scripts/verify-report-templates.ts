// Cross-checks every report template's totals against an independent count
// from the raw data (per period, all periods, source filters, rankings,
// weekly summary, transfer register). Read-only.  npm run reports:verify
import { readDb } from "@/lib/db";
import { findingsResidentInPeriod, isHoApproved, computeEligibleCaseCounts } from "@/lib/findings";
import * as T from "@/lib/reportTemplates";

(async () => {
  const db = await readDb();
  const approved = db.findings.filter(isHoApproved);
  const periods = [...db.reportingPeriods].sort((a, b) => a.code.localeCompare(b.code));
  const out: string[] = [];
  const check = (label: string, got: number, want: number) => out.push(`${got === want ? "OK  " : "DIFF"} ${label}: template=${got} raw=${want}`);

  // Raw baselines
  const lifetimeCases = approved.reduce((s, f) => s + f.caseCount, 0);
  const lifetimeClosed = approved.reduce((s, f) => s + f.closedCases, 0);
  const lifetimeRectifiedNotClosed = approved.reduce((s, f) => s + f.rectifiedCases, 0);
  out.push(`raw lifetime: cases=${lifetimeCases} closed=${lifetimeClosed} self-reported rectified=${lifetimeRectifiedNotClosed}`);
  out.push(`inactive districts with findings: ${db.districts.filter((d) => d.status !== "ACTIVE" && approved.some((f) => f.districtId === d.id)).map((d) => d.name).join(", ") || "none"}`);

  const srcFor = (slug: string) => {
    const ids = db.settings.reportTemplateSources?.[slug];
    return ids && ids.length ? approved.filter((f) => ids.includes(f.sourceId)) : approved;
  };
  for (const p of periods) {
    // Category Detail and Monthly Summary are never affected by transfers:
    // each finding counts whole in the period it was originally reported in.
    const originalIn = (f: (typeof approved)[number]) => {
      const first = db.findingTransfers.filter((t) => t.findingId === f.id).sort((x, y) => x.createdAt.localeCompare(y.createdAt))[0];
      return (first ? first.fromPeriodId : f.periodId) === p.id;
    };
    const wholeCases = (list: typeof approved) => list.filter(originalIn).reduce((s, f) => s + f.caseCount, 0);
    check(`${p.code} Category Detail total (original period, its sources)`, T.getCategoryDetailByDistrict(db, p.id).totalRow.totalCases, wholeCases(srcFor("category-detail-by-district")));
    check(`${p.code} Monthly Summary total (original period, its sources)`, T.getMonthlySummaryReport(db, p.id).totalRow.totalCases, wholeCases(srcFor("monthly-summary")));
    const res = findingsResidentInPeriod(db, p.id, approved);
    const cases = res.reduce((s, r) => s + r.slice.eligibleCases, 0);
    const closed = res.reduce((s, r) => s + r.slice.closedCases, 0);
    void closed;
    const ra = T.getDistrictRankingAllCases(db, [p.id]).totalRow;
    check(`${p.code} Ranking All Cases total`, ra.totalCases, cases);
    const cps = T.getCategoryPerformanceSummary(db, p.id).totalRow;
    check(`${p.code} Category Performance total`, cps.totalCases, cases);
    const bankOfficial = computeEligibleCaseCounts(db, { periodId: p.id });
    const ro = T.getDistrictRankingOtherCases(db, [p.id]).totalRow;
    check(`${p.code} Ranking Other Cases total`, ro.totalCases, bankOfficial?.totalCases ?? 0);
    const snap = T.getDistrictSnapshotAsOf(db, p.id, "2999-12-31").totalRow;
    check(`${p.code} Mid-Month snapshot (far future) vs official`, snap.totalCases, bankOfficial?.totalCases ?? 0);
  }
  const raAll = T.getDistrictRankingAllCases(db).totalRow;
  check("ALL Ranking All Cases total", raAll.totalCases, lifetimeCases);
  check("ALL Ranking All Cases rectified (should be closed)", raAll.rectifiedCases, lifetimeClosed);
  const cpsAll = T.getCategoryPerformanceSummary(db).totalRow;
  check("ALL Category Performance rectified (should be closed)", cpsAll.rectifiedCases, lifetimeClosed);
  const roAll = T.getDistrictRankingOtherCases(db).totalRow;
  check("ALL Ranking Other Cases total", roAll.totalCases, computeEligibleCaseCounts(db, {})?.totalCases ?? 0);
  const sumPeriods = (fn: (pid: string) => number) => periods.reduce((s, p) => s + fn(p.id), 0);
  check("ALL Category Detail = sum of periods", T.getCategoryDetailByDistrict(db, undefined).totalRow.totalCases, sumPeriods((pid) => T.getCategoryDetailByDistrict(db, pid).totalRow.totalCases));
  check("ALL Category Detail rectified = sum of periods", T.getCategoryDetailByDistrict(db, undefined).totalRow.totalRectified, sumPeriods((pid) => T.getCategoryDetailByDistrict(db, pid).totalRow.totalRectified));
  check("ALL Monthly Summary = sum of periods", T.getMonthlySummaryReport(db, undefined).totalRow.totalCases, sumPeriods((pid) => T.getMonthlySummaryReport(db, pid).totalRow.totalCases));
  for (const cur of Object.keys(T.getMonthlySummaryReport(db, undefined).totalRow.totalAmount)) {
    check(`ALL Monthly Summary amount (${cur}) = sum of periods`, Math.round(T.getMonthlySummaryReport(db, undefined).totalRow.totalAmount[cur] ?? 0), Math.round(sumPeriods((pid) => T.getMonthlySummaryReport(db, pid).totalRow.totalAmount[cur] ?? 0)));
  }
  check("ALL Ranking Other Cases = sum of periods", roAll.totalCases, sumPeriods((pid) => T.getDistrictRankingOtherCases(db, [pid]).totalRow.totalCases));
  const hist = T.sumDistrictRowsAcrossPeriods(T.getMonthlyDistrictSeries(db, "monthly-district-history").otherCases).reduce((s, r) => s + r.totalCases, 0);
  check("ALL Monthly District History = Ranking Other Cases (all)", hist, roAll.totalCases);
  check("Transferred Findings rows = transfer records", T.getTransferredFindings(db).length, db.findingTransfers.filter((t) => db.findings.some((f) => f.id === t.findingId)).length);
  const wk = T.getWeeklyExecutiveSummary(db, "2999-12-31", "2999-12-30");
  check("Weekly (far future) total cases = approved lifetime", wk.reduce((s, c) => s + c.rows.reduce((a, r) => a + r.currentBalance, 0), 0), approved.reduce((s, f) => s + f.caseCount - f.closedCases, 0));
  console.log(out.join("\n"));
  const diffs = out.filter((l) => l.startsWith("DIFF")).length;
  console.log(diffs ? `\n${diffs} mismatch(es) found.` : "\nAll report templates match the raw data.");
  process.exit(diffs ? 1 : 0);
})();
