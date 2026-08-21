import { NextResponse } from "next/server";
import { requireRole } from "@/lib/guard";
import { readDb } from "@/lib/db";

export async function GET() {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return auth.response;
  // Newest first; already inserted at the head in src/lib/audit.ts.
  return NextResponse.json({ auditLogs: readDb().auditLogs.slice(0, 300) });
}
