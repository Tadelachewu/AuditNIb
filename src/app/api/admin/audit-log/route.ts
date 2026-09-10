import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { paginate, parsePage } from "@/lib/pagination";
import { verifyAuditLogChain } from "@/lib/audit";

// The audit log is append-only and grows forever - every workflow,
// config, and auth event ever logged. Previously this returned a flat
// slice(0, 300) with no way to see anything older; now it's genuinely
// paginated so the full history stays reachable, page by page, without
// ever sending more than one page's worth of rows per request.
export async function GET(request: Request) {
  const auth = await requirePermission("audit-log.view");
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const db = await readDb();
  // Newest first by `sequence`, the chain's own authoritative order - not
  // array/read order, which Postgres doesn't guarantee without this
  // explicit sort (see src/lib/audit.ts's own doc comment on why sequence
  // exists at all).
  const sorted = [...db.auditLogs].sort((a, b) => b.sequence - a.sequence);
  const result = paginate(sorted, parsePage(searchParams.get("page") ?? undefined), 50);
  // O(n) over the whole log, but only on this admin-only viewer request,
  // not on every write - confirms no past entry has been altered, deleted,
  // or reordered directly in the database, bypassing appendAuditLog().
  const chain = verifyAuditLogChain(db.auditLogs);
  return NextResponse.json({
    auditLogs: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    chainValid: chain.valid,
    chainBrokenAtSequence: chain.brokenAtSequence,
  });
}
