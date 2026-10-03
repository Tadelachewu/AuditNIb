// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PeriodMultiSelect } from "@/components/reports/PeriodMultiSelect";
import type { ReportingPeriod } from "@/types";

afterEach(cleanup);
const p = (m: number, status = "OPEN") =>
  ({ id: `p${m}`, code: `2026-${String(m).padStart(2, "0")}`, year: 2026, month: m, status, startsAt: `2026-${String(m).padStart(2, "0")}-01T00:00:00Z`, endsAt: `2026-${String(m).padStart(2, "0")}-28T00:00:00Z` }) as unknown as ReportingPeriod;
const submitted = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="periodIds"]')).map((i) => i.value);

describe("District Ranking period dropdown", () => {
  it("is one compact button; no selection = All periods", () => {
    render(<PeriodMultiSelect periods={[p(8), p(9, "LOCKED"), p(10)]} selectedIds={[]} />);
    expect(screen.getByRole("button").textContent).toContain("All periods");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(submitted()).toEqual([]);
  });

  it("opens a newest-first list; ticking periods submits them and updates the label", () => {
    render(<PeriodMultiSelect periods={[p(8), p(9, "LOCKED"), p(10)]} selectedIds={[]} />);
    fireEvent.click(screen.getByRole("button"));
    const labels = Array.from(screen.getByRole("listbox").querySelectorAll("label")).map((l) => l.textContent);
    expect(labels).toEqual(["All periods (cumulative)", "2026-10", "2026-09(locked)", "2026-08"]);
    fireEvent.click(screen.getByLabelText("2026-10"));
    expect(screen.getByRole("button").textContent).toContain("2026-10");
    fireEvent.click(screen.getByLabelText("2026-08"));
    expect(screen.getByRole("button").textContent).toContain("2 periods");
    expect(submitted().sort()).toEqual(["p10", "p8"]);
    fireEvent.click(screen.getByLabelText("All periods (cumulative)"));
    expect(submitted()).toEqual([]);
  });

  it("keeps an existing selection from the URL", () => {
    render(<PeriodMultiSelect periods={[p(8), p(10)]} selectedIds={["p8"]} />);
    expect(screen.getByRole("button").textContent).toContain("2026-08");
    expect(submitted()).toEqual(["p8"]);
  });
});
