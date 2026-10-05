// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PerformanceCalculation, PerformancePct } from "@/components/dashboard/PerformanceMath";

afterEach(cleanup);

describe("performance % with its calculation", () => {
  it("shows the % and, when clicked, how it was calculated", () => {
    const { container } = render(<PerformancePct counts={{ rectifiedCases: 18, totalCases: 46 }} />);
    const details = container.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(summary.textContent).toBe("39.1%");
    expect(details.open).toBe(false);

    fireEvent.click(summary);
    details.open = true; // jsdom doesn't toggle <details> on click
    expect(details.textContent).toContain("18 of 46 eligible case(s) closed");
    expect(details.textContent).toContain("18 ÷ 46 × 100 = 39.1%");
  });

  it("shows -- with nothing to explain when there are no eligible cases", () => {
    render(<PerformancePct counts={null} />);
    expect(screen.getByText("--")).toBeTruthy();
    cleanup();
    const { container } = render(<PerformancePct counts={{ rectifiedCases: 0, totalCases: 0 }} />);
    expect(container.querySelector("details")).toBeNull();
  });

  it("the explanation includes the scoring rule's formula when given", () => {
    render(<PerformanceCalculation counts={{ rectifiedCases: 3, totalCases: 4 }} formula="Closed Other Case cases ÷ eligible cases" />);
    expect(screen.getByText(/3 ÷ 4 × 100 =/).textContent).toContain("75.0%");
    expect(screen.getByText("Formula: Closed Other Case cases ÷ eligible cases")).toBeTruthy();
  });
});
