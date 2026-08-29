import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";

export async function GET() {
  const auth = await requirePermission("reporting-periods.view");
  if (!auth.ok) return auth.response;
  const periods = [...readDb().reportingPeriods].sort((a, b) => b.code.localeCompare(a.code));
  return NextResponse.json({ reportingPeriods: periods });
}

// year/month are derived from `startsAt` (the reporting window's own
// start), not entered separately - one date range is the source of truth
// instead of three overlapping fields that could disagree.
const createSchema = z
  .object({
    startsAt: z.string().min(1, "Start date/time is required"),
    endsAt: z.string().min(1, "End date/time is required"),
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    message: "End date/time must be after the start date/time",
    path: ["endsAt"],
  });

export async function POST(request: Request) {
  const auth = await requirePermission("reporting-periods.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { startsAt, endsAt } = parsed.data;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid start date/time" }, { status: 400 });
  }
  const year = start.getFullYear();
  const month = start.getMonth() + 1;
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
    startsAt: start.toISOString(),
    endsAt: new Date(endsAt).toISOString(),
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
