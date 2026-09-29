import { appendAuditLog } from "@/lib/audit";
import type { Database, ScoringAdjustment } from "@/types";

/** A valid adjusted score: 0-100 inclusive, at most two decimals. */
export function isValidAdjustmentValue(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * Keeps at most ONE active adjustment per target + period: when `keep`
 * becomes active (created, or re-activated), every other ACTIVE adjustment
 * for the same branch/district and period is deactivated, each with its
 * own audit entry naming the adjustment that replaced it. Previously older
 * ones stayed "Active" in the list while only the newest actually counted
 * (getActiveScoringAdjustment() picks the newest), which made it unclear
 * which figure was in force. Call inside updateDb(). Returns how many were
 * deactivated.
 */
export function supersedeOtherActiveAdjustments(
  db: Database,
  keep: ScoringAdjustment,
  actor: { userId: string; userName: string }
): number {
  let count = 0;
  for (const other of db.scoringAdjustments) {
    if (
      other.id === keep.id ||
      other.status !== "ACTIVE" ||
      other.targetType !== keep.targetType ||
      other.targetId !== keep.targetId ||
      other.periodId !== keep.periodId
    ) {
      continue;
    }
    other.status = "INACTIVE";
    appendAuditLog(db, {
      userId: actor.userId,
      userName: actor.userName,
      action: "UPDATE",
      entityType: "ScoringAdjustment",
      entityId: other.id,
      oldValue: { status: "ACTIVE" },
      newValue: { status: "INACTIVE" },
      reason: `Automatically deactivated - replaced by adjustment ${keep.id} (${keep.value}%) for the same target and period`,
    });
    count++;
  }
  return count;
}
