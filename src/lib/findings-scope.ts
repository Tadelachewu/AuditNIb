import type { Database, Finding } from "@/types";
import type { SessionData } from "@/lib/session";

/**
 * The BRD repeats this as a hard requirement in multiple places ("Filters
 * must never bypass organizational scope", "UI scope is not a security
 * boundary; server/API must enforce access"), so it's centralized here
 * rather than re-implemented per route. Every findings API route and every
 * list/queue view goes through one of these two functions - never a raw
 * `db.findings` filter of its own.
 */
export function isFindingInScope(session: SessionData, finding: Finding): boolean {
  switch (session.orgScope) {
    case "BANK":
      return true;
    case "DISTRICT":
      return finding.districtId === session.districtId;
    case "BRANCH":
      return finding.branchId === session.branchId;
    default:
      // No recognized scope on the session - deny rather than guess.
      return false;
  }
}

/** All findings the caller's session may see, before any further (narrowing-only) filter is applied. */
export function findingsInScope(db: Database, session: SessionData): Finding[] {
  return db.findings.filter((f) => isFindingInScope(session, f));
}

/** Returns an error message if the finding is outside the caller's org scope, or null if it's allowed. */
export function assertFindingInScope(session: SessionData, finding: Finding): string | null {
  if (!isFindingInScope(session, finding)) {
    return "This finding is outside your organizational scope.";
  }
  return null;
}

/**
 * Whether an import (its history entry and stored Excel file) is within the
 * caller's scope (security review M4). Bank-wide users see every import.
 * Anyone else only sees an import whose findings all lie within their own
 * branch / district - an import that also covers other branches or
 * districts, or whose findings no longer exist (a reversed import, which
 * can't be checked), stays bank-level.
 */
export function isImportBatchInScope(db: Database, session: SessionData, batch: { rows: { findingId?: string }[] }): boolean {
  if (session.orgScope === "BANK") return true;
  const ids = new Set(batch.rows.map((r) => r.findingId).filter((id): id is string => Boolean(id)));
  if (ids.size === 0) return false;
  const findings = db.findings.filter((f) => ids.has(f.id));
  return findings.length === ids.size && findings.every((f) => isFindingInScope(session, f));
}
