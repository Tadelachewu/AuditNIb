import { appendAuditLog } from "@/lib/audit";
import type { Database, Finding } from "@/types";

/**
 * Audit completeness (docs/data-integrity.md), applied by updateDb() to every
 * change before it's saved - so no route can forget it:
 *
 * 1. Every changed field of a finding is in the audit log with its old and
 *    new value. Routes log their own entry (a status transition, an edit);
 *    any field that entry doesn't already show - rectified / verified /
 *    closed cases and amounts, the period after a transfer, totals after an
 *    adjustment, ... - is added in one "FIELDS_CHANGED" entry beside it.
 * 2. The audit log is append-only: a change that edits or removes an
 *    existing entry is refused (the hash chain in src/lib/audit.ts would
 *    also expose it, but this stops it from being saved at all).
 */

/** Bookkeeping, not business data. */
const IGNORED_FIELDS = new Set<string>(["updatedAt"]);

export class AuditLogTamperError extends Error {
  override name = "AuditLogTamperError";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function changedFields(was: Finding, now: Finding): string[] {
  const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
  return [...keys].filter((k) => !IGNORED_FIELDS.has(k) && !same((was as unknown as Record<string, unknown>)[k], (now as unknown as Record<string, unknown>)[k]));
}

function hasKey(v: unknown, k: string): boolean {
  return Boolean(v) && typeof v === "object" && Object.prototype.hasOwnProperty.call(v, k);
}

/** Throws AuditLogTamperError when `after` edits or drops an entry `before` had. */
export function assertAuditLogAppendOnly(before: Database, after: Database): void {
  const afterById = new Map(after.auditLogs.map((e) => [e.id, e]));
  for (const e of before.auditLogs) {
    const now = afterById.get(e.id);
    if (!now) throw new AuditLogTamperError(`Audit entry ${e.id} would be deleted`);
    if (!same(now, e)) throw new AuditLogTamperError(`Audit entry ${e.id} would be changed`);
  }
}

/**
 * Adds a FIELDS_CHANGED entry for each finding whose changed fields the
 * change's own audit entries don't already show (old and new value).
 */
export function auditFindingFieldChanges(before: Database, after: Database, actor: { userId: string; userName: string }): void {
  const beforeIds = new Set(before.auditLogs.map((e) => e.id));
  const added = after.auditLogs.filter((e) => !beforeIds.has(e.id) && e.entityType === "Finding");
  const wasById = new Map(before.findings.map((f) => [f.id, f]));

  for (const f of after.findings) {
    const was = wasById.get(f.id);
    if (!was) continue; // a new finding: its CREATE entry records it
    const changed = changedFields(was, f);
    if (changed.length === 0) continue;
    const own = added.filter((e) => e.entityId === f.id);
    const missing = changed.filter((k) => !own.some((e) => hasKey(e.oldValue, k) && hasKey(e.newValue, k)));
    if (missing.length === 0) continue;
    const pick = (src: Finding) => Object.fromEntries(missing.map((k) => [k, (src as unknown as Record<string, unknown>)[k] ?? null]));
    appendAuditLog(after, {
      userId: actor.userId,
      userName: actor.userName,
      action: "FIELDS_CHANGED",
      entityType: "Finding",
      entityId: f.id,
      oldValue: pick(was),
      newValue: pick(f),
      reason: own.length > 0 ? `With ${[...new Set(own.map((e) => e.action))].join(", ")}` : undefined,
    });
  }
}
