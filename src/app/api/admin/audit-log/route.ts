import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { ALL_ROWS, paginate, parsePage } from "@/lib/pagination";
import { verifyAuditLogChain } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import type { AuditLogEntry } from "@/types";

function seqCompare(a: string, b: string): number {
  const ai = BigInt(a);
  const bi = BigInt(b);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * Server-side search / filter / sort / paging for the Audit Log table (the
 * log can grow far too large to ship to the browser whole):
 *   q          - text search across actor, action, entity type/id, reason
 *   action     - exact action (e.g. UPDATE, EVIDENCE_DOWNLOAD)
 *   entityType - exact entity type (e.g. Finding, Settings)
 *   actor      - text match on the actor's name
 *   from, to   - ISO dates (inclusive), by entry timestamp
 *   sort       - "asc" | "desc" (by sequence = time order; default desc)
 *   page, pageSize (max ALL_ROWS - the "All" choice)
 *   format=csv - every matching entry (not just one page) as a CSV file
 */
export async function GET(request: Request) {
  const auth = await requirePermission("audit-log.view");
  if (!auth.ok) return auth.response;
  const { searchParams: sp } = new URL(request.url);
  const db = await readDb();

  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  const action = sp.get("action") ?? "";
  const entityType = sp.get("entityType") ?? "";
  const actor = (sp.get("actor") ?? "").trim().toLowerCase();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const dir = sp.get("sort") === "asc" ? 1 : -1;

  const matches = (l: AuditLogEntry) => {
    if (action && l.action !== action) return false;
    if (entityType && l.entityType !== entityType) return false;
    if (actor && !(l.userName ?? "").toLowerCase().includes(actor)) return false;
    if (from && l.timestamp.slice(0, 10) < from) return false;
    if (to && l.timestamp.slice(0, 10) > to) return false;
    if (words.length) {
      const hay = [l.userName, l.action, l.entityType, l.entityId, l.reason].filter(Boolean).join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  };
  const filtered = db.auditLogs.filter(matches).sort((a, b) => seqCompare(a.sequence, b.sequence) * dir);

  if (sp.get("format") === "csv") {
    const csv = toCsv(filtered, [
      { header: "Sequence", value: (l) => l.sequence },
      { header: "Time (UTC)", value: (l) => l.timestamp },
      { header: "Actor", value: (l) => l.userName },
      { header: "Action", value: (l) => l.action },
      { header: "Entity", value: (l) => l.entityType },
      { header: "Entity ID", value: (l) => l.entityId },
      { header: "Reason", value: (l) => l.reason ?? "" },
    ]);
    return new NextResponse("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Up to ALL_ROWS: the table's "All" rows-per-page choice.
  const pageSize = Math.min(ALL_ROWS, Math.max(1, Number(sp.get("pageSize")) || 50));
  const result = paginate(filtered, parsePage(sp.get("page") ?? undefined), pageSize);
  const chain = verifyAuditLogChain(db.auditLogs);
  return NextResponse.json({
    auditLogs: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    // Filter choices for the table's dropdowns.
    actions: [...new Set(db.auditLogs.map((l) => l.action))].sort(),
    entityTypes: [...new Set(db.auditLogs.map((l) => l.entityType))].sort(),
    chainValid: chain.valid,
    chainBrokenAtSequence: chain.brokenAtSequence,
  });
}
