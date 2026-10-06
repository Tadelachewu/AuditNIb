import { describe, expect, it } from "vitest";
import { dashboardFindingsHref, EMPTY_DASHBOARD_FILTERS } from "@/lib/dashboardFilters";

// A dashboard chart click opens the Findings list with the dashboard's own
// period and filters, plus the clicked segment's values.
const params = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

describe("dashboard chart click -> Findings list", () => {
  it("carries the period (current only), filters and date range, then the segment's values", () => {
    const href = dashboardFindingsHref(
      { ...EMPTY_DASHBOARD_FILTERS, districtId: "d1", sourceId: "s1" },
      { from: "2026-10-01", to: "2026-10-31" },
      "p10",
      { risk: "High", status: "SENT_TO_BRANCH_MANAGER,PARTIALLY_RECTIFIED" }
    );
    expect(params(href)).toEqual({
      periodId: "p10",
      current: "1",
      districtId: "d1",
      sourceId: "s1",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      risk: "High",
      status: "SENT_TO_BRANCH_MANAGER,PARTIALLY_RECTIFIED",
    });
  });

  it("All periods: no current-only restriction", () => {
    expect(params(dashboardFindingsHref(EMPTY_DASHBOARD_FILTERS, {}, "ALL", { status: "CLOSED" }))).toEqual({ periodId: "ALL", status: "CLOSED" });
  });

  it("the clicked segment wins over the dashboard's own risk / status filter", () => {
    const href = dashboardFindingsHref({ ...EMPTY_DASHBOARD_FILTERS, risk: "Low" }, {}, "p10", { risk: "High" });
    expect(params(href).risk).toBe("High");
  });
});
