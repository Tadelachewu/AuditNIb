import { describe, expect, it } from "vitest";
import { getCategoryDetailByDistrict, getUncoveredBranches } from "@/lib/reportTemplates";
import { reportTemplateDb, reportTemplateScopeNote } from "@/lib/reportTemplateScope";
import type { SessionData } from "@/lib/session";
import type { Database } from "@/types";

// Settings › Report Template Visibility: bank-wide (the default, unchanged)
// or each district / branch user's own district / branch only.

function db(reportTemplates?: "BANK" | "OWN_SCOPE"): Database {
  const finding = (id: string, districtId: string, branchId: string) => ({
    id, districtId, branchId, categoryId: "c1", sourceId: "s1", periodId: "sep",
    status: "SENT_TO_BRANCH_MANAGER", caseCount: 5, closedCases: 0, amount: 500, closedAmount: 0, currency: "ETB", registeredByBankScope: false,
  });
  return {
    districts: [
      { id: "d1", code: "AA", name: "Addis", status: "ACTIVE" },
      { id: "d2", code: "HW", name: "Hawassa", status: "ACTIVE" },
    ],
    branches: [
      { id: "b1", code: "B1", name: "Bole", districtId: "d1", status: "ACTIVE" },
      { id: "b1b", code: "B1B", name: "Piassa", districtId: "d1", status: "ACTIVE" },
      { id: "b2", code: "B2", name: "Tabor", districtId: "d2", status: "ACTIVE" },
    ],
    categories: [{ id: "c1", code: "OTHER_CASE", name: "Other Case", active: true }],
    sources: [{ id: "s1", code: "IC", name: "Internal Control", active: true }],
    reportingPeriods: [],
    findings: [finding("f1", "d1", "b1"), finding("f1b", "d1", "b1b"), finding("f2", "d2", "b2")],
    findingTransfers: [{ id: "t2", findingId: "f2", fromPeriodId: "sep", toPeriodId: "oct", casesTransferred: 1, amountTransferred: 1, createdAt: "2026-09-01" }],
    findingClosures: [],
    findingTransitions: [], rectifications: [], findingAdjustments: [], findingCases: [], evidence: [], comments: [],
    branchCoverageNotes: [{ id: "n2", branchId: "b2", periodId: "sep", note: "x" }],
    scoringRules: [{ id: "r1", active: true, categories: ["c1"], sources: ["s1"], version: 1 }],
    settings: { reportTemplateSources: {}, rankingVisibility: { branches: true, districts: true, reportTemplates } },
  } as unknown as Database;
}

const session = (orgScope: "BANK" | "DISTRICT" | "BRANCH"): SessionData =>
  ({ isLoggedIn: true, userId: "u", orgScope, districtId: orgScope === "BANK" ? null : "d1", branchId: orgScope === "BRANCH" ? "b1" : null }) as SessionData;

describe("report template visibility setting", () => {
  it("bank-wide (setting missing - today's behaviour): a district user sees every district", () => {
    const d = db();
    expect(reportTemplateDb(d, session("DISTRICT"))).toBe(d);
    expect(getCategoryDetailByDistrict(reportTemplateDb(d, session("DISTRICT")), "sep").totalRow.totalCases).toBe(15);
    expect(reportTemplateScopeNote(d, session("DISTRICT"))).toBeNull();
    expect(reportTemplateDb(db("BANK"), session("DISTRICT")).findings).toHaveLength(3);
  });

  it("own scope: a district user sees only their district - findings, districts, branches, history, notes", () => {
    const s = reportTemplateDb(db("OWN_SCOPE"), session("DISTRICT"));
    expect(s.districts.map((x) => x.id)).toEqual(["d1"]);
    expect(s.branches.map((x) => x.id)).toEqual(["b1", "b1b"]);
    expect(s.findings.map((x) => x.id)).toEqual(["f1", "f1b"]);
    expect(s.findingTransfers).toHaveLength(0);
    expect(s.branchCoverageNotes).toHaveLength(0);
    expect(getCategoryDetailByDistrict(s, "sep").totalRow.totalCases).toBe(10);
    expect(reportTemplateScopeNote(db("OWN_SCOPE"), session("DISTRICT"))).toMatch(/district only/);
  });

  it("own scope: a branch user sees only their branch (and its district's row)", () => {
    const s = reportTemplateDb(db("OWN_SCOPE"), session("BRANCH"));
    expect(s.districts.map((x) => x.id)).toEqual(["d1"]);
    expect(s.branches.map((x) => x.id)).toEqual(["b1"]);
    expect(s.findings.map((x) => x.id)).toEqual(["f1"]);
    expect(getUncoveredBranches(s, "sep")).toHaveLength(0);
  });

  it("own scope: bank-wide users still see everything", () => {
    const d = db("OWN_SCOPE");
    expect(reportTemplateDb(d, session("BANK"))).toBe(d);
    expect(reportTemplateScopeNote(d, session("BANK"))).toBeNull();
  });

  it("own scope: a session with no recognised scope sees nothing", () => {
    const s = reportTemplateDb(db("OWN_SCOPE"), { isLoggedIn: true } as SessionData);
    expect([s.findings.length, s.districts.length, s.branches.length]).toEqual([0, 0, 0]);
  });
});
