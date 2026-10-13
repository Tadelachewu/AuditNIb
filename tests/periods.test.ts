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
  it("current = the previous calendar month's period, all month long", () => {
    expect(currentPeriod(periods, at("2026-10-03"))?.code).toBe("2026-09");
    expect(currentPeriod(periods, at("2026-10-31"))?.code).toBe("2026-09");
    expect(currentPeriod(periods, at("2026-11-01"))?.code).toBe("2026-10");
    expect(currentPeriod(periods, at("2026-12-15"))?.code).toBe("2026-11");
  });
  it("across a year end: January's current period is December's", () => {
    const yearEnd = [...periods, P("2026-12", "2026-12-01", "2026-12-31"), P("2027-01", "2027-01-01", "2027-01-31")];
    expect(currentPeriod(yearEnd, at("2027-01-10"))?.code).toBe("2026-12");
  });
  it("last month's period doesn't exist: the most recent one that started before this month", () => {
    expect(currentPeriod(periods, at("2027-02-10"))?.code).toBe("2026-11");
  });
  it("nothing earlier than this month (the system's first month, or before every period): the earliest", () => {
    expect(currentPeriod(periods, at("2026-08-15"))?.code).toBe("2026-08");
    expect(currentPeriod(periods, at("2026-01-01"))?.code).toBe("2026-08");
  });
  it("filter value: none -> current, ALL -> every period, else that period", () => {
    expect(resolvePeriodFilter(periods, "")).toBe(currentPeriod(periods)?.id ?? "");
    expect(resolvePeriodFilter(periods, "ALL")).toBe("");
    expect(resolvePeriodFilter(periods, "2026-08")).toBe("2026-08");
  });
});
