import { v4 as uuid } from "uuid";
import crypto from "node:crypto";
import type { Database, AuditLogEntry } from "@/types";

// Tamper-evidence chain: each entry's hash covers its own fields plus the
// previous entry's hash, so altering or deleting any past row - directly in
// the database, bypassing the app entirely - breaks every hash after it.
// verifyAuditLogChain() below detects that without needing a separate,
// external authority to compare against.
//
// `sequence` (not `timestamp`, which is client-set and not monotonic, and
// not array/insertion order, which Postgres doesn't guarantee without an
// explicit ORDER BY) is what actually orders the chain. It has to be
// assigned here, in application code, before the row is ever inserted -
// a database autoincrement is only assigned at insert time, too late to
// include in a hash computed beforehand.
export const AUDIT_CHAIN_GENESIS_HASH = "0".repeat(64);

// Plain JSON.stringify is NOT safe to hash here: oldValue/newValue round-trip
// through a Postgres `jsonb` column (see AuditLogEntry.oldValue/newValue in
// schema.prisma), which normalizes stored JSON and does not preserve
// object key order. A hash computed at write time (over the caller's
// object, in whatever key order it happened to be constructed) would then
// silently fail to match the same hash recomputed after a read - not
// because anything was tampered with, but because `{a:1,b:2}` and
// `{b:2,a:1}` stringify differently despite being the same data. Sorting
// keys recursively before stringifying makes the serialization depend only
// on content, immune to any storage-layer reordering.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

function computeEntryHash(
  previousHash: string,
  entry: {
    sequence: number;
    timestamp: string;
    userId: string;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  }
): string {
  const payload = canonicalStringify({
    previousHash,
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    userId: entry.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    reason: entry.reason ?? null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function appendAuditLog(
  db: Database,
  entry: {
    userId: string;
    userName: string;
    action: string;
    entityType: string;
    entityId: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  }
): AuditLogEntry {
  // Order-independent - correct regardless of what order db.auditLogs
  // happens to be in, which matters since it's read fresh from Postgres
  // (see readDb() in src/lib/db.ts) with no guaranteed row order.
  let maxSequence = 0;
  let previousHash = AUDIT_CHAIN_GENESIS_HASH;
  for (const e of db.auditLogs) {
    if (e.sequence > maxSequence) {
      maxSequence = e.sequence;
      previousHash = e.hash;
    }
  }
  const sequence = maxSequence + 1;

  const timestamp = new Date().toISOString();
  const hash = computeEntryHash(previousHash, { ...entry, sequence, timestamp });

  const record: AuditLogEntry = {
    id: uuid(),
    timestamp,
    sequence,
    previousHash,
    hash,
    ...entry,
  };
  db.auditLogs.unshift(record);
  return record;
}

export interface AuditChainVerification {
  valid: boolean;
  brokenAtId?: string;
  brokenAtSequence?: number;
}

// Recomputes the chain from genesis and compares against what's stored -
// any edited field, deleted entry, or reordered sequence on any past row
// shows up as a mismatch starting at the first altered entry. O(n) over
// the full audit log; called from the admin Audit Log viewer, not on every
// write.
export function verifyAuditLogChain(auditLogs: AuditLogEntry[]): AuditChainVerification {
  const sorted = [...auditLogs].sort((a, b) => a.sequence - b.sequence);

  let expectedPrevious = AUDIT_CHAIN_GENESIS_HASH;
  let expectedSequence = 1;
  for (const entry of sorted) {
    if (entry.sequence !== expectedSequence || entry.previousHash !== expectedPrevious) {
      return { valid: false, brokenAtId: entry.id, brokenAtSequence: entry.sequence };
    }
    const recomputed = computeEntryHash(expectedPrevious, entry);
    if (recomputed !== entry.hash) {
      return { valid: false, brokenAtId: entry.id, brokenAtSequence: entry.sequence };
    }
    expectedPrevious = entry.hash;
    expectedSequence++;
  }
  return { valid: true };
}

type RawAuditEntry = Pick<
  AuditLogEntry,
  "id" | "userId" | "userName" | "action" | "entityType" | "entityId" | "oldValue" | "newValue" | "reason" | "timestamp"
>;

// One-time bootstrap for entries that predate this chain (the one-time
// JSON→Postgres ETL's existing history, or this feature's own rollout onto
// an already-populated audit_logs table) - never called from a live route.
// Orders by `timestamp` since that's the only ordering signal old data
// has; every entry appended through appendAuditLog() from here on is
// ordered by `sequence` instead, which doesn't have that limitation.
export function buildAuditLogChainFromScratch(entries: RawAuditEntry[]): AuditLogEntry[] {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  let previousHash = AUDIT_CHAIN_GENESIS_HASH;
  let sequence = 0;
  return sorted.map((entry) => {
    sequence++;
    const hash = computeEntryHash(previousHash, { ...entry, sequence });
    const result: AuditLogEntry = { ...entry, sequence, previousHash, hash };
    previousHash = hash;
    return result;
  });
}
