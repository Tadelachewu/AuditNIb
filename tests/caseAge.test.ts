import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageSummary, averageApprovedAge, caseAgeIndex, caseAges } from "@/lib/caseAge";
import type { Finding, FindingTransition } from "@/types";

// Case age (docs/case-age.md): from first submission, from final approval,
// from the Finding date; an import is submitted and approved at once.

const NOW = new Date("2026-10-31T12:00:00");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const day = (d: string) => new Date(`${d}T09:00:00`).toISOString();
const t = (action: string, toStatus: string, at: string): FindingTransition =>
  ({ id: `${action}-${at}`, findingId: "f1", action, toStatus, fromStatus: "", userId: "u", userName: "U", createdAt: day(at) }) as FindingTransition;
const finding = (over: Partial<Finding> = {}) =>
  ({ id: "f1", status: "SENT_TO_BRANCH_MANAGER", findingDate: "2026-09-01", createdAt: day("2026-10-01"), updatedAt: day("2026-10-01"), ...over }) as Finding;

describe("case ages", () => {
  it("draft: no submit or approved age yet; finding-date age always", () => {
    const a = caseAges(finding({ status: "DRAFT" }), []);
    expect(a).toMatchObject({ submit: null, approved: null, findingDate: 60, imported: false });
  });

  it("submitted, in review: submit age only", () => {
    const a = caseAges(finding({ status: "HO_REVIEW" }), [t("SUBMIT", "DISTRICT_REVIEW", "2026-10-11")]);
    expect(a).toMatchObject({ submit: 20, approved: null });
  });

  it("approved: from the first move to Sent to Branch Manager", () => {
    const h = [t("SUBMIT", "DISTRICT_REVIEW", "2026-10-11"), t("QUEUE_BRANCH_MANAGER", "SENT_TO_BRANCH_MANAGER", "2026-10-21")];
    expect(caseAges(finding(), h)).toMatchObject({ submit: 20, approved: 10 });
  });

  it("returned and resubmitted, or reversed: counts from the FIRST submit / approval", () => {
    const h = [
      t("SUBMIT", "DISTRICT_REVIEW", "2026-10-01"),
      t("DISTRICT_RETURN", "RETURNED", "2026-10-02"),
      t("SUBMIT", "DISTRICT_REVIEW", "2026-10-20"),
      t("QUEUE_BRANCH_MANAGER", "SENT_TO_BRANCH_MANAGER", "2026-10-21"),
      t("REVERSE", "SENT_TO_BRANCH_MANAGER", "2026-10-29"),
    ];
    expect(caseAges(finding(), h)).toMatchObject({ submit: 30, approved: 10 });
  });

  it("transfers never reset it; closed stops at the close date", () => {
    const h = [
      t("SUBMIT", "DISTRICT_REVIEW", "2026-10-01"),
      t("QUEUE_BRANCH_MANAGER", "SENT_TO_BRANCH_MANAGER", "2026-10-01"),
      t("TRANSFER", "TRANSFERRED", "2026-10-15"),
      t("CLOSE", "CLOSED", "2026-10-21"),
    ];
    expect(caseAges(finding({ status: "CLOSED" }), h)).toMatchObject({ submit: 20, approved: 20, findingDate: 50 });
  });

  it("imported: one age (submit = approved, the import time)", () => {
    const h = [t("IMPORT_SUBMIT", "SUBMITTED", "2026-10-26"), t("IMPORT_APPROVE", "SENT_TO_BRANCH_MANAGER", "2026-10-26")];
    const a = caseAges(finding({ importBatchId: "b1", findingDate: "2025-10-31" }), h);
    expect(a).toMatchObject({ imported: true, submit: 5, approved: 5, findingDate: 365 });
    expect(ageSummary(a)).toBe("Submit / approved 5d · Finding date 365d");
  });

  it("as of an earlier moment (age at a transfer)", () => {
    const h = [t("SUBMIT", "DISTRICT_REVIEW", "2026-10-01"), t("QUEUE_BRANCH_MANAGER", "SENT_TO_BRANCH_MANAGER", "2026-10-03")];
    expect(caseAges(finding(), h, new Date("2026-10-13T09:00:00").getTime())).toMatchObject({ submit: 12, approved: 10 });
  });

  it("a future or blank Finding date: 0 / none, never negative", () => {
    expect(caseAges(finding({ findingDate: "2026-12-01" }), []).findingDate).toBe(0);
    expect(caseAges(finding({ findingDate: "" }), []).findingDate).toBeNull();
  });

  it("older data with no SUBMIT on record: registration stands in, marked estimated", () => {
    const a = caseAges(finding({ status: "PARTIALLY_RECTIFIED" }), []);
    expect(a).toMatchObject({ submit: 30, approved: 30, estimated: true });
  });

  it("the index and the backlog average (approved ages only)", () => {
    const db = { findingTransitions: [t("SUBMIT", "DISTRICT_REVIEW", "2026-10-01"), t("QUEUE_BRANCH_MANAGER", "SENT_TO_BRANCH_MANAGER", "2026-10-21")] };
    expect(caseAgeIndex(db)(finding()).approved).toBe(10);
    expect(averageApprovedAge(db, [finding(), { ...finding({ status: "DRAFT" }), id: "f2" }])).toBe(10);
    expect(averageApprovedAge(db, [])).toBeNull();
  });
});
