import { afterEach, describe, expect, it, vi } from "vitest";
import { appNow, clockOffsetMs, resetClockForTests, testClockProblem } from "@/lib/clock";
import { currentPeriod } from "@/lib/periods";
import { localToday, findingDateError } from "@/lib/inputRules";
import { caseAges } from "@/lib/caseAge";
import type { Finding } from "@/types";

// The business clock (docs/test-clock.md): APP_TEST_NOW simulates the date on
// a test server, never in production, and drives the business rules only.

const P = (code: string, start: string, end: string) => ({ id: code, code, startsAt: `${start}T00:00:00`, endsAt: `${end}T23:59:00` });
const periods = [P("2026-09", "2026-09-01", "2026-09-30"), P("2026-10", "2026-10-01", "2026-10-31"), P("2026-11", "2026-11-01", "2026-11-30")];

function withEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v as string);
  resetClockForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetClockForTests();
});

describe("test clock", () => {
  it("off by default: the business clock is the real clock", () => {
    withEnv({ APP_TEST_NOW: "", APP_ENV: "development" });
    expect(clockOffsetMs()).toBe(0);
    expect(Math.abs(appNow() - Date.now())).toBeLessThan(50);
  });

  it("APP_TEST_NOW on a test server moves the business clock there, and it keeps ticking", async () => {
    withEnv({ APP_TEST_NOW: "2026-11-01T00:05:00", APP_ENV: "development" });
    const target = new Date("2026-11-01T00:05:00").getTime();
    expect(Math.abs(appNow() - target)).toBeLessThan(1000);
    const first = appNow();
    await new Promise((r) => setTimeout(r, 30));
    expect(appNow()).toBeGreaterThan(first);
    // Real timestamps are untouched.
    expect(Math.abs(Date.now() - target)).toBeGreaterThan(1000);
  });

  it("works with any non-production APP_ENV (e.g. uat)", () => {
    withEnv({ APP_TEST_NOW: "2026-11-01T00:05:00", APP_ENV: "uat" });
    expect(clockOffsetMs()).not.toBe(0);
  });

  it("is ignored in production, without an APP_ENV, or with a value that isn't a date", () => {
    withEnv({ APP_TEST_NOW: "2026-11-01T00:05:00", APP_ENV: "production" });
    expect(clockOffsetMs()).toBe(0);
    expect(testClockProblem()).toMatch(/production/);
    withEnv({ APP_TEST_NOW: "2026-11-01T00:05:00", APP_ENV: "" });
    expect(clockOffsetMs()).toBe(0);
    withEnv({ APP_TEST_NOW: "next tuesday", APP_ENV: "development" });
    expect(clockOffsetMs()).toBe(0);
    expect(testClockProblem()).toMatch(/isn't a date/);
  });

  it("drives the business rules: current period, today, future dates, case age", () => {
    withEnv({ APP_TEST_NOW: "2026-11-01T00:05:00", APP_ENV: "development" });
    expect(currentPeriod(periods)?.code).toBe("2026-10");
    expect(localToday()).toBe("2026-11-01");
    expect(findingDateError("2026-10-31")).toBeNull();
    expect(findingDateError("2026-11-02")).toMatch(/future/);
    const submittedAt = new Date("2026-10-22T00:05:00").toISOString();
    const f = { id: "f1", status: "SUBMITTED", createdAt: submittedAt, updatedAt: submittedAt } as Finding;
    expect(caseAges(f, [{ findingId: "f1", action: "SUBMIT", toStatus: "SUBMITTED", createdAt: submittedAt } as never]).submit).toBe(10);

    withEnv({ APP_TEST_NOW: "2026-10-31T23:50:00", APP_ENV: "development" });
    expect(currentPeriod(periods)?.code).toBe("2026-09");
  });
});
