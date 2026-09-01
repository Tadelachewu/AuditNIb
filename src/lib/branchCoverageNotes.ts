import { v4 as uuid } from "uuid";
import { appendAuditLog } from "@/lib/audit";
import type { Database, BranchCoverageNote } from "@/types";

// Shared upsert (at most one note per branch+period) used by both the
// single-branch note route and the bulk-apply route, so the two never
// drift on what "record a reason" actually does. Mutates `current` and
// appends the audit-log entry; callers run this inside their own
// updateDb() so every note in a bulk request lands in one write.
export function upsertBranchCoverageNote(
  current: Database,
  params: { branchId: string; periodId: string; reason: string; reasonId: string | null; userId: string; userName: string }
): BranchCoverageNote {
  const { branchId, periodId, reason, reasonId, userId, userName } = params;
  const now = new Date().toISOString();
  const existing = current.branchCoverageNotes.find((n) => n.branchId === branchId && n.periodId === periodId);
  if (existing) {
    existing.reason = reason;
    existing.reasonId = reasonId;
    existing.recordedBy = userId;
    existing.recordedByName = userName;
    existing.updatedAt = now;
    appendAuditLog(current, {
      userId,
      userName,
      action: "UPDATE",
      entityType: "BranchCoverageNote",
      entityId: existing.id,
      newValue: { reason, reasonId },
    });
    return existing;
  }
  const created: BranchCoverageNote = {
    id: uuid(),
    branchId,
    periodId,
    reason,
    reasonId,
    recordedBy: userId,
    recordedByName: userName,
    createdAt: now,
    updatedAt: now,
  };
  current.branchCoverageNotes.push(created);
  appendAuditLog(current, {
    userId,
    userName,
    action: "CREATE",
    entityType: "BranchCoverageNote",
    entityId: created.id,
    newValue: created,
  });
  return created;
}
