import { describe, expect, it } from "vitest";
import { appendAuditLog, verifyAuditLogChain } from "@/lib/audit";
import { assertAuditLogAppendOnly, AuditLogTamperError, auditFindingFieldChanges } from "@/lib/auditCompleteness";
import type { Database, Finding } from "@/types";

// Audit completeness (src/lib/auditCompleteness.ts), applied by updateDb()
// to every change: each changed finding field is logged with its old and new
// value, and existing audit entries can't be edited or removed.

const finding = (over: Partial<Finding> = {}) =>
  ({ id: "f1", reference: "F-1", status: "SENT_TO_BRANCH_MANAGER", caseCount: 5, amount: 500, rectifiedCases: 0, rectifiedAmount: 0, periodId: "sep", updatedAt: "2026-10-01T00:00:00Z", ...over }) as Finding;
const db = (findings: Finding[]): Database => ({ findings, auditLogs: [], users: [] }) as unknown as Database;
const clone = (d: Database): Database => JSON.parse(JSON.stringify(d));
const actor = { userId: "u1", userName: "Abebe" };

describe("every changed finding field is audited", () => {
  it("a status transition entry gets the figures it doesn't show (rectified cases / amount)", () => {
    const before = db([finding()]);
    const after = clone(before);
    Object.assign(after.findings[0], { status: "PARTIALLY_RECTIFIED", rectifiedCases: 2, rectifiedAmount: 200, updatedAt: "2026-10-20T00:00:00Z" });
    // What transitionFinding() logs: the status only.
    appendAuditLog(after, { ...actor, action: "RECTIFY", entityType: "Finding", entityId: "f1", oldValue: { status: "SENT_TO_BRANCH_MANAGER" }, newValue: { status: "PARTIALLY_RECTIFIED" } });

    auditFindingFieldChanges(before, after, actor);

    const extra = after.auditLogs.find((e) => e.action === "FIELDS_CHANGED")!;
    expect(extra.entityId).toBe("f1");
    expect(extra.oldValue).toEqual({ rectifiedCases: 0, rectifiedAmount: 0 });
    expect(extra.newValue).toEqual({ rectifiedCases: 2, rectifiedAmount: 200 });
    expect(extra.reason).toBe("With RECTIFY");
    expect(extra.userName).toBe("Abebe");
    // Still a valid tamper-evident chain.
    expect(verifyAuditLogChain(after.auditLogs).valid).toBe(true);
  });

  it("an entry that already shows every changed field (an edit) gets nothing extra", () => {
    const before = db([finding()]);
    const after = clone(before);
    after.findings[0].amount = 900;
    appendAuditLog(after, { ...actor, action: "UPDATE", entityType: "Finding", entityId: "f1", oldValue: before.findings[0], newValue: after.findings[0] });
    auditFindingFieldChanges(before, after, actor);
    expect(after.auditLogs.map((e) => e.action)).toEqual(["UPDATE"]);
  });

  it("a change no route logged (e.g. a transfer moving the period) is still logged, by the system for jobs", () => {
    const before = db([finding()]);
    const after = clone(before);
    after.findings[0].periodId = "oct";
    auditFindingFieldChanges(before, after, { userId: "system", userName: "System" });
    expect(after.auditLogs).toHaveLength(1);
    expect(after.auditLogs[0]).toMatchObject({ action: "FIELDS_CHANGED", userName: "System", oldValue: { periodId: "sep" }, newValue: { periodId: "oct" } });
    expect(after.auditLogs[0].reason).toBeUndefined();
  });

  it("only updatedAt changing, or a new finding (it has its own CREATE entry), adds nothing", () => {
    const before = db([finding()]);
    const after = clone(before);
    after.findings[0].updatedAt = "2026-10-21T00:00:00Z";
    after.findings.push(finding({ id: "f2" }));
    auditFindingFieldChanges(before, after, actor);
    expect(after.auditLogs).toHaveLength(0);
  });
});

describe("the audit log is append-only", () => {
  const withEntry = () => {
    const d = db([finding()]);
    appendAuditLog(d, { ...actor, action: "CREATE", entityType: "Finding", entityId: "f1" });
    return d;
  };
  it("adding entries is fine", () => {
    const before = withEntry();
    const after = clone(before);
    appendAuditLog(after, { ...actor, action: "SUBMIT", entityType: "Finding", entityId: "f1" });
    expect(() => assertAuditLogAppendOnly(before, after)).not.toThrow();
  });
  it("editing an entry is refused", () => {
    const before = withEntry();
    const after = clone(before);
    after.auditLogs[0].userName = "Someone else";
    expect(() => assertAuditLogAppendOnly(before, after)).toThrow(AuditLogTamperError);
  });
  it("removing an entry is refused", () => {
    const before = withEntry();
    const after = clone(before);
    after.auditLogs = [];
    expect(() => assertAuditLogAppendOnly(before, after)).toThrow(AuditLogTamperError);
  });
});
