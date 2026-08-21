import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requireRole } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

export async function GET() {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return auth.response;
  const periods = [...readDb().reportingPeriods].sort((a, b) => b.code.localeCompare(a.code));
  return NextResponse.json({ reportingPeriods: periods });
}

const createSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
});

export async function POST(request: Request) {
  const auth = await requireRole("ADMIN");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { year, month } = parsed.data;
  const code = `${year}-${String(month).padStart(2, "0")}`;

  const db = readDb();
  if (db.reportingPeriods.some((p) => p.code === code)) {
    return NextResponse.json({ error: "That reporting period already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const period = {
    id: uuid(),
    year,
    month,
    code,
    status: "OPEN" as const,
    lockedBy: null,
    lockedAt: null,
    lockReason: null,
    createdAt: now,
    updatedAt: now,
  };

  updateDb((current) => {
    current.reportingPeriods.push(period);
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "CREATE",
      entityType: "ReportingPeriod",
      entityId: period.id,
      newValue: period,
    });
  });

  return NextResponse.json({ reportingPeriod: period }, { status: 201 });
}
