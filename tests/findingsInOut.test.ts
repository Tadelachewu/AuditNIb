import { describe, expect, it } from "vitest";
import { adjustmentPeriodOf, findingsResidentInPeriod, reportedInPeriod } from "@/lib/findings";
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

  describe("with an approved adjustment (+3 cases): reported in the period it was APPROVED in", () => {
    const adj = (submittedIn: string, approvedAt: string) => ({ id: "a1", findingId: "f1", status: "APPROVED", periodId: submittedIn, approvedAt, addedCases: 3, amountChange: 300 });

    it("transferred Sep -> Oct, then submitted and approved in Oct: Oct reports 3 (and the dashboard agrees)", () => {
      const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z")], "oct");
      d.findingAdjustments = [adj("oct", "2026-10-05T00:00:00Z")] as never;
      expect(slice(d, "sep")).toEqual({ reported: 5, in: 0, out: 5, total: 0 });
      expect(slice(d, "oct")).toEqual({ reported: 3, in: 5, out: 0, total: 8 });
      expect(reportedInPeriod(d, d.findings[0], "oct").cases).toBe(3);
      expect(reportedInPeriod(d, d.findings[0], "sep").cases).toBe(5);
    });

    it("approved in Sep before the transfer: Sep reports 5 + 3, and the transfer carries all 8 on", () => {
      const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z", 8)], "oct");
      d.findingAdjustments = [adj("sep", "2026-09-20T00:00:00Z")] as never;
      expect(slice(d, "sep")).toEqual({ reported: 8, in: 0, out: 8, total: 0 });
      expect(slice(d, "oct")).toEqual({ reported: 0, in: 8, out: 0, total: 8 });
    });

    it("edge case - submitted in Oct, transferred to Nov, approved in Nov: reported in Nov, not Oct", () => {
      const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z"), t("t2", "oct", "nov", "2026-11-01T00:00:00Z")], "nov");
      d.findingAdjustments = [adj("oct", "2026-11-03T00:00:00Z")] as never;
      expect(slice(d, "oct")).toEqual({ reported: 0, in: 5, out: 5, total: 0 });
      expect(slice(d, "nov")).toEqual({ reported: 3, in: 5, out: 0, total: 8 });
      expect(adjustmentPeriodOf(d, d.findings[0], d.findingAdjustments[0])).toBe("nov");
      expect(reportedInPeriod(d, d.findings[0], "oct").cases).toBe(0);
      expect(reportedInPeriod(d, d.findings[0], "nov").cases).toBe(3);
    });
  });

  it("partly rectified before the transfer (3 of 5 carried on): out 3, total 2 stays in 2026-09", () => {
    const d = db([t("t1", "sep", "oct", "2026-10-01T00:00:00Z", 3)], "oct");
    expect(slice(d, "sep")).toEqual({ reported: 5, in: 0, out: 3, total: 2 });
    expect(slice(d, "oct")).toEqual({ reported: 0, in: 3, out: 0, total: 3 });
  });
});
