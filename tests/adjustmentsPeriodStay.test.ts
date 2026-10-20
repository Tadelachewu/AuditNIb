import { describe, expect, it } from "vitest";
import { adjustmentsView } from "@/lib/adjustments/view";
import type { SessionData } from "@/lib/session";
import type { Database, Finding } from "@/types";

// The Adjustments card's "In <period> (transferred from <period>)" figure:
// shown while the finding is in a period it was transferred INTO; once it's
// transferred back to the period it was registered in, it's home again and
// the card shows its current total instead.

const finding = { id: "f1", periodId: "sep", caseCount: 20, amount: 40000, operationArea: "ATM", status: "SENT_TO_BRANCH_MANAGER", districtId: "d1", branchId: "b1" } as unknown as Finding;
const periods = [
  { id: "sep", code: "2026-09", startsAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-30T23:59:59Z", submissionStartsAt: "2026-10-01T00:00:00Z", submissionEndsAt: "2026-10-22T00:00:00Z", status: "OPEN" },
  { id: "oct", code: "2026-10", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-31T23:59:59Z", submissionStartsAt: "2026-11-01T00:00:00Z", submissionEndsAt: "2026-11-22T00:00:00Z", status: "OPEN" },
];
const transfer = (id: string, from: string, to: string, at: string) => ({ id, findingId: "f1", fromPeriodId: from, toPeriodId: to, casesTransferred: 20, amountTransferred: 40000, createdAt: at });
const db = (transfers: ReturnType<typeof transfer>[], periodId: string): Database =>
  ({
    findings: [{ ...finding, periodId }],
    findingTransfers: transfers,
    findingAdjustments: [],
    findingCases: [],
    reportingPeriods: periods,
    settings: { hoApproval: { required: false, approverUserIds: [] } },
  }) as unknown as Database;
const session = { isLoggedIn: true, userId: "u1", orgScope: "BRANCH", branchId: "b1", districtId: "d1", permissions: [] } as unknown as SessionData;
const view = (d: Database) => adjustmentsView(d, { revolvingOperationAreas: ["ATM"] } as never, session, d.findings[0]);

describe("Adjustments card: the transferred-in stay", () => {
  it("transferred Sep -> Oct: shows 'In 2026-10 (transferred from 2026-09)'", () => {
    const stay = view(db([transfer("t1", "sep", "oct", "2026-10-20T07:23:00Z")], "oct")).periodStay;
    expect(stay).toMatchObject({ periodCode: "2026-10", fromPeriodCode: "2026-09", cases: 20, amount: 40000 });
  });

  it("transferred back Oct -> Sep (its registered period): home again, no 'transferred from' figure", () => {
    const d = db([transfer("t1", "sep", "oct", "2026-10-20T07:23:00Z"), transfer("t2", "oct", "sep", "2026-10-20T07:25:00Z")], "sep");
    expect(view(d).periodStay).toBeNull();
  });
});
