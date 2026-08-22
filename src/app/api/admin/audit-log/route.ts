import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb } from "@/lib/db";

export async function GET() {
  const auth = await requirePermission("audit-log.view");
  if (!auth.ok) return auth.response;
  // Newest first; already inserted at the head in src/lib/audit.ts.
  return NextResponse.json({ auditLogs: readDb().auditLogs.slice(0, 300) });
}
