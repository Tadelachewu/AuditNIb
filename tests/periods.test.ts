import { describe, expect, it } from "vitest";
import { currentPeriod, resolvePeriodFilter, sortPeriods } from "@/lib/periods";

const P = (code: string, start: string, end: string) => ({ id: code, code, startsAt: `${start}T00:00:00.000Z`, endsAt: `${end}T20:59:00.000Z` });
// Stored in no particular order, as the database may return them.
const periods = [P("2026-09", "2026-09-01", "2026-09-30"), P("2026-11", "2026-11-01", "2026-11-30"), P("2026-08", "2026-08-01", "2026-08-31"), P("2026-10", "2026-10-01", "2026-10-31")];
const at = (d: string) => new Date(`${d}T12:00:00.000Z`).getTime();

describe("reporting period helpers", () => {
  it("lists periods newest first", () => {
    expect(sortPeriods(periods).map((p) => p.code)).toEqual(["2026-11", "2026-10", "2026-09", "2026-08"]);
  });
  it("current = the period whose dates contain today (not the first open one)", () => {
    expect(currentPeriod(periods, at("2026-10-03"))?.code).toBe("2026-10");
    expect(currentPeriod(periods, at("2026-08-15"))?.code).toBe("2026-08");
  });
  it("no period covers today: the most recent one that has started", () => {
    expect(currentPeriod(periods, at("2027-01-10"))?.code).toBe("2026-11");
  });
  it("before every period: the earliest", () => {
    expect(currentPeriod(periods, at("2026-01-01"))?.code).toBe("2026-08");
  });
  it("filter value: none -> current, ALL -> every period, else that period", () => {
    expect(resolvePeriodFilter(periods, "")).toBe(currentPeriod(periods)?.id ?? "");
    expect(resolvePeriodFilter(periods, "ALL")).toBe("");
    expect(resolvePeriodFilter(periods, "2026-08")).toBe("2026-08");
  });
});
