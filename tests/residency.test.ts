import { describe, expect, it } from "vitest";
import { findingsResidentInPeriod } from "@/lib/findings";
import type { Database, Finding } from "@/types";

// Every case must be counted in exactly one period: the periods' shares of a
// finding always add up to its caseCount, including when it transfers back
// into a period it already left.
function db(transfers: [string, string, number][]): { db: Database; f: Finding } {
  const f = { id: "f1", periodId: transfers.length ? transfers[transfers.length - 1][1] : "p9", caseCount: 4, amount: 400 } as Finding;
  const periods = ["p8", "p9", "p10"].map((id) => ({ id, code: id }));
  const findingTransfers = transfers.map(([from, to, moved], i) => ({
    id: `t${i}`, findingId: "f1", fromPeriodId: from, toPeriodId: to, casesTransferred: moved, amountTransferred: moved * 100, createdAt: `2026-09-1${i}T00:00:00Z`,
  }));
  return { db: { findings: [f], findingTransfers, findingClosures: [], reportingPeriods: periods } as unknown as Database, f };
}
const share = (d: Database, f: Finding, p: string) => findingsResidentInPeriod(d, p, [f])[0]?.slice.eligibleCases ?? 0;

describe("period residency", () => {
  it("forward transfer splits the cases between the two periods", () => {
    const { db: d, f } = db([["p9", "p10", 3]]);
    expect([share(d, f, "p9"), share(d, f, "p10")]).toEqual([1, 3]);
  });

  it("a return trip is counted, so period shares still add up to caseCount", () => {
    const { db: d, f } = db([["p9", "p10", 2], ["p10", "p9", 2]]);
    const shares = ["p8", "p9", "p10"].map((p) => share(d, f, p));
    expect(shares).toEqual([0, 4, 0]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(f.caseCount);
    expect(findingsResidentInPeriod(d, "p9", [f])[0].slice.isCurrentPeriod).toBe(true);
  });

  it("three hops: each stay keeps what didn't move on", () => {
    const { db: d, f } = db([["p8", "p9", 3], ["p9", "p10", 1]]);
    expect(["p8", "p9", "p10"].map((p) => share(d, f, p))).toEqual([1, 2, 1]);
  });
});
