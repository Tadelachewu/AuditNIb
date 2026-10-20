import { describe, expect, it } from "vitest";
import { findingsResidentInPeriod } from "@/lib/findings";
import type { Database, Finding } from "@/types";

// Findings list, per period filter: Reported (registered here), In / Out
// (cases transferred into / out of the period) and Total (what's left here).
// Reported + In - Out = Total in every period.

const finding = { id: "f1", periodId: "oct", caseCount: 5, registeredCaseCount: 5, amount: 500, registeredAmount: 500, status: "TRANSFERRED", closedCases: 0, closedAmount: 0 } as unknown as Finding;
const t = (id: string, from: string, to: string, at: string, cases = 5) => ({ id, findingId: "f1", fromPeriodId: from, toPeriodId: to, casesTransferred: cases, amountTransferred: cases * 100, createdAt: at });
const db = (transfers: ReturnType<typeof t>[], periodId: string): Database =>
  ({ findings: [{ ...finding, periodId }], findingTransfers: transfers, findingAdjustments: [], findingClosures: [], reportingPeriods: [{ id: "sep", code: "2026-09" }, { id: "oct", code: "2026-10" }] }) as unknown as Database;
const slice = (d: Database, periodId: string) => {
  const s = findingsResidentInPeriod(d, periodId, d.findings)[0]?.slice;
  return s && { reported: s.reportedCases, in: s.casesIn, out: s.casesOut, total: s.eligibleCases };
};

describe("Reported / In / Out per period", () => {
  it("registered with 5 cases in 2026-09, transferred to 2026-10: reported only in 2026-09", () => {
    const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z")], "oct");
    expect(slice(d, "sep")).toEqual({ reported: 5, in: 0, out: 5, total: 0 });
    expect(slice(d, "oct")).toEqual({ reported: 0, in: 5, out: 0, total: 5 });
  });

  it("never transferred: reported 5, nothing in or out", () => {
    const d = db([], "sep");
    expect(slice(d, "sep")).toEqual({ reported: 5, in: 0, out: 0, total: 5 });
  });

  it("2026-09 -> 2026-10 -> back to 2026-09: 2026-09 has reported 5, in 5, out 5", () => {
    const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z"), t("t2", "oct", "sep", "2026-10-02T00:00:00Z")], "sep");
    expect(slice(d, "sep")).toEqual({ reported: 5, in: 5, out: 5, total: 5 });
    expect(slice(d, "oct")).toEqual({ reported: 0, in: 5, out: 5, total: 0 });
  });

  it("partly rectified before the transfer (3 of 5 carried on): out 3, total 2 stays in 2026-09", () => {
    const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z", 3)], "oct");
    expect(slice(d, "sep")).toEqual({ reported: 5, in: 0, out: 3, total: 2 });
    expect(slice(d, "oct")).toEqual({ reported: 0, in: 3, out: 0, total: 3 });
  });
});
