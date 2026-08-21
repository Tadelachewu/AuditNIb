import { v4 as uuid } from "uuid";
import type { Database, AuditLogEntry } from "@/types";

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
  const record: AuditLogEntry = {
    id: uuid(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  db.auditLogs.unshift(record);
  return record;
}
