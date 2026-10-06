// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Register Finding: the finding date (pre-filled with today) must be a real,
// non-future date, on or before the end of the chosen reporting period. A
// disabled Save button always says why.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ apiSend: vi.fn(async () => ({ finding: { id: "f1" } })), apiGet: vi.fn(async () => ({})) }));

import { NewFindingForm } from "@/components/findings/NewFindingForm";
import type { ReportingPeriod } from "@/types";

afterEach(cleanup);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00"));
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ matches: [] }))) as never;
});
afterEach(() => vi.useRealTimers());

const period = (code: string, month: number): ReportingPeriod =>
  ({
    id: `p${month}`, code, year: 2026, month, status: "OPEN", draftsAllowedWhileLocked: true,
    startsAt: new Date(2026, month - 1, 1).toISOString(), endsAt: new Date(2026, month, 0, 23, 59).toISOString(),
    submissionStartsAt: new Date(2026, month - 1, 1).toISOString(), submissionEndsAt: new Date(2026, month, 0, 23, 59).toISOString(),
  }) as unknown as ReportingPeriod;

const noneRequired = { title: false, sourceId: false, departmentId: false, findingDate: false, operationArea: false, irregularityType: false, categoryId: false, currency: false, riskLevel: false, priority: false, description: false, recommendation: false, rootCause: false, evidenceNote: false };
const noOther = { operationArea: false, irregularityType: false, priority: false, riskLevel: false, currency: false, categoryId: false };

function renderForm(requiredFields: Record<string, boolean> = noneRequired) {
  render(
    <NewFindingForm
      sources={[]} departments={[]} categories={[]}
      periods={[period("2026-08", 8), period("2026-10", 10)]}
      districts={[]} branches={[]}
      currencies={["ETB"]} riskLevels={["Low"]} operationAreas={["Teller"]} priorityLevels={["Low"]} irregularityTypes={["Cash"]}
      requiredFields={requiredFields as never} allowOther={noOther as never}
      fixedDistrict={{ id: "d1", name: "Addis" }} fixedBranch={{ id: "b1", name: "Bole" }}
    />
  );
}
const saveDraft = () => screen.getByRole("button", { name: "Save Draft" }) as HTMLButtonElement;
const choosePeriod = (id: string) => fireEvent.change(screen.getByLabelText(/Reporting period/i), { target: { value: id } });

describe("Register Finding: the finding date must be within the reporting period or before it", () => {
  it("period 2026-08 with today's date (2026-10-02, after August) is refused, with the reason shown", () => {
    renderForm();
    choosePeriod("p8");
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    expect(saveDraft().disabled).toBe(true);
    expect(screen.getAllByText(/after reporting period 2026-08/).length).toBeGreaterThan(0);
  });

  it("period 2026-08 with a date in or before August can be saved as a draft", () => {
    renderForm();
    choosePeriod("p8");
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    for (const date of ["2026-08-31", "2026-07-15"]) {
      fireEvent.change(screen.getByLabelText(/Finding date/), { target: { value: date } });
      expect(saveDraft().disabled).toBe(false);
    }
  });

  it("2026-08's submission window has closed: a clear notice says a draft is possible but not submitting, with the window dates", () => {
    renderForm();
    choosePeriod("p8");
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Finding date/), { target: { value: "2026-08-20" } });
    // Under the period field and next to the buttons.
    expect(screen.getAllByText("2026-08 isn't accepting submissions today - you can save a draft, but not submit.")).toHaveLength(2);
    expect(screen.queryByText(/Its submission window is .*2026.* – .*2026/)).not.toBeNull();
    expect((screen.getByRole("button", { name: "Save & Submit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(saveDraft().disabled).toBe(false);
    expect(screen.getByRole("option", { name: "2026-08 (submission closed - drafts only)" })).toBeTruthy();
  });

  it("a period open for submissions shows no notice", () => {
    renderForm();
    choosePeriod("p10");
    expect(screen.queryByText(/isn't accepting submissions/)).toBeNull();
  });

  it("a future date is still refused, with the reason shown", () => {
    renderForm();
    choosePeriod("p10");
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Finding date/), { target: { value: "2026-10-05" } });
    expect(saveDraft().disabled).toBe(true);
    expect(screen.getAllByText(/can't be in the future/).length).toBeGreaterThan(0);
  });

  it("explains why Save Draft is disabled until the amount is filled in", () => {
    renderForm();
    choosePeriod("p10");
    expect(saveDraft().disabled).toBe(true);
    expect(screen.queryByText(/Can't save yet: Amount involved is required/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    expect(saveDraft().disabled).toBe(false);
  });
});

describe("Register Finding: the administrator's required fields", () => {
  it("Classified case required but not chosen: Save Draft and Save & Submit stay disabled and say why", () => {
    renderForm({ ...noneRequired, categoryId: true });
    choosePeriod("p10");
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "1" } });
    expect(saveDraft().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save & Submit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Can't save yet: Classified case is required.")).not.toBeNull();
  });

  it("the current reporting period is selected by default, and periods are listed newest first", () => {
    renderForm();
    expect((screen.getByLabelText(/Reporting period/i) as HTMLSelectElement).value).toBe("p10"); // today is 2026-10-02
    const codes = Array.from((screen.getByLabelText(/Reporting period/i) as HTMLSelectElement).options).map((o) => o.text).filter((t) => t.startsWith("2026"));
    expect(codes.map((t) => t.slice(0, 7))).toEqual(["2026-10", "2026-08"]);
  });

  it("no reporting period chosen: the reason is shown", () => {
    renderForm();
    choosePeriod("");
    expect(saveDraft().disabled).toBe(true);
    expect(screen.queryByText("Can't save yet: Reporting period is required.")).not.toBeNull();
  });

  it("Number of cases starts empty (no assumed 1) and is required", () => {
    renderForm();
    choosePeriod("p10");
    fireEvent.change(screen.getByLabelText("Amount involved"), { target: { value: "500" } });
    expect((screen.getByLabelText("Number of cases") as HTMLInputElement).value).toBe("");
    expect(saveDraft().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Number of cases"), { target: { value: "3" } });
    expect(saveDraft().disabled).toBe(false);
  });

  it("the mouse wheel never changes a number field", () => {
    renderForm();
    const input = screen.getByLabelText("Number of cases") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    input.focus();
    fireEvent.wheel(input, { deltaY: -100 });
    expect(document.activeElement).not.toBe(input); // focus leaves, so the browser can't step it
    expect(input.value).toBe("3");
  });
});
