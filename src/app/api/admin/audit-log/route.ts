import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";
import { paginate, parsePage } from "@/lib/pagination";

// The audit log is append-only and grows forever - every workflow,
// config, and auth event ever logged. Previously this returned a flat
// slice(0, 300) with no way to see anything older; now it's genuinely
// paginated so the full history stays reachable, page by page, without
// ever sending more than one page's worth of rows per request.
export async function GET(request: Request) {
  const auth = await requirePermission("audit-log.view");
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  // Newest first; already inserted at the head in src/lib/audit.ts.
  const result = paginate(readDb().auditLogs, parsePage(searchParams.get("page") ?? undefined), 50);
  return NextResponse.json({ auditLogs: result.items, total: result.total, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages });
}
