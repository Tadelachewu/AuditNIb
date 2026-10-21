// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReportingPeriod } from "@/types";

// District Ranking (All Cases / Other Cases) period filter: choosing one,
// several or all periods must load exactly that choice - the auto-applying
// form reads the dropdown's choice, never the one before it.

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/reports/templates/district-ranking-all-cases" }));

import { AutoFilterForm } from "@/components/reports/AutoFilterForm";
import { PeriodMultiSelect } from "@/components/reports/PeriodMultiSelect";

const p = (m: number) =>
  ({ id: `p${m}`, code: `2026-${String(m).padStart(2, "0")}`, year: 2026, month: m, status: "OPEN", startsAt: `2026-${String(m).padStart(2, "0")}-01T00:00:00Z`, endsAt: `2026-${String(m).padStart(2, "0")}-28T00:00:00Z` }) as unknown as ReportingPeriod;
const periods = [p(8), p(9), p(10)];

beforeEach(() => push.mockClear());
afterEach(cleanup);

const lastUrl = () => (push.mock.calls.at(-1)?.[0] as string | undefined) ?? "";
const periodsIn = (url: string) => new URLSearchParams(url.split("?")[1] ?? "").getAll("periodIds").sort();
const open = () => fireEvent.click(screen.getByRole("button"));
const tick = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
};

function setup(selectedIds: string[] = []) {
  render(
    <AutoFilterForm>
      <PeriodMultiSelect periods={periods} selectedIds={selectedIds} />
    </AutoFilterForm>
  );
  open();
}

describe("District Ranking period filter applies exactly what was chosen", () => {
  it("one period", async () => {
    setup();
    await tick("2026-09");
    expect(periodsIn(lastUrl())).toEqual(["p9"]);
  });

  it("several periods: each tick loads the full choice so far", async () => {
    setup();
    await tick("2026-09");
    await tick("2026-10");
    expect(periodsIn(lastUrl())).toEqual(["p10", "p9"]);
    await tick("2026-08");
    expect(periodsIn(lastUrl())).toEqual(["p10", "p8", "p9"]);
  });

  it("unticking one keeps the rest", async () => {
    setup(["p9", "p10"]);
    await tick("2026-09");
    expect(periodsIn(lastUrl())).toEqual(["p10"]);
  });

  it("All periods clears the choice (no periodIds = cumulative)", async () => {
    setup(["p9", "p10"]);
    await tick("All periods (cumulative)");
    expect(periodsIn(lastUrl())).toEqual([]);
    expect(lastUrl()).toBe("/reports/templates/district-ranking-all-cases");
  });
});
