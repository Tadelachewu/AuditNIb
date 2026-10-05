import { NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { z } from "zod";
import { zDateTime, zText } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { outstandingTransferPreview } from "@/lib/findings";
import { withApiHandler } from "@/lib/api/handler";
import { listPageJson } from "@/lib/serverList";

async function handleGET(request: Request) {
  const auth = await requirePermission("reporting-periods.view");
  if (!auth.ok) return auth.response;
  const db = await readDb();
  // outstandingTransferableCount/transferDestinationCode let the Lock
  // dialog ask an informed "transfer N outstanding cases to <period>?"
  // question (see autoTransferOnLock()'s doc comment) without a second
  // round-trip - this route already requires only reporting-periods.view,
  // which everyone who can reach the Lock button already holds, unlike
  // settings.view.
  const periods = [...db.reportingPeriods].sort((a, b) => b.code.localeCompare(a.code)).map((p) => {
    const preview = outstandingTransferPreview(db, p);
    // Lets the admin UI disable "Edit Period" (its own date range) once
    // anything references it - editing startsAt/endsAt is only safe while
    // a period is genuinely empty (see the PATCH route's own comment for
    // why: reference numbers, dedupe keys, and every period-scoped stat
    // already keyed off the old dates would silently go stale otherwise).
    const findingCount = db.findings.filter((f) => f.periodId === p.id).length;
    return { ...p, outstandingTransferableCount: preview.count, transferDestinationCode: preview.destinationCode, findingCount };
  });
  // ?page=... -> one page of the Reporting Periods table (searched / filtered / sorted on the server).
  const paged = listPageJson(request, "reportingPeriods", periods, {
    fields: {
      code: (p) => p.code,
      name: (p) => p.name ?? "",
      range: (p) => p.startsAt,
      status: (p) => p.status,
      findingCount: (p) => p.findingCount,
      lastChange: (p) => p.lockReason ?? "",
    },
    search: ["code", "name", "status", "lastChange"],
    exact: ["status"],
  });
  if (paged) return NextResponse.json({ ...paged, autoTransferOnLock: db.settings.autoTransferOnLock });

  return NextResponse.json({ reportingPeriods: periods, autoTransferOnLock: db.settings.autoTransferOnLock });
}

// year/month are derived from `startsAt` (the reporting window's own
// start), not entered separately - one date range is the source of truth
// instead of three overlapping fields that could disagree. The submission
// window is a separate pair, independent of that range - it may run
// earlier, later, or beyond either edge of startsAt/endsAt (e.g. a
// grace period before/after the period itself) - see
// ReportingPeriod.submissionStartsAt's own doc comment (src/types/index.ts).
const createSchema = z
  .object({
    startsAt: zDateTime("Start date/time"),
    endsAt: zDateTime("End date/time"),
    submissionStartsAt: zDateTime("Submission window start"),
    submissionEndsAt: zDateTime("Submission window end"),
    // Optional human-readable label - see ReportingPeriod.name's own doc
    // comment. Never required, never derived - purely what the admin
    // types, or blank.
    name: zText("Name", 100).optional(),
  })
  .refine((v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(), {
    message: "End date/time must be after the start date/time",
    path: ["endsAt"],
  })
  .refine((v) => new Date(v.submissionEndsAt).getTime() > new Date(v.submissionStartsAt).getTime(), {
    message: "Submission window end must be after its start",
    path: ["submissionEndsAt"],
  });

async function handlePOST(request: Request) {
  const auth = await requirePermission("reporting-periods.create");
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { startsAt, endsAt, submissionStartsAt, submissionEndsAt, name } = parsed.data;
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid start date/time" }, { status: 400 });
  }
  const year = start.getFullYear();
  const month = start.getMonth() + 1;
  const code = `${year}-${String(month).padStart(2, "0")}`;

  const db = await readDb();
  if (db.reportingPeriods.some((p) => p.code === code)) {
    return NextResponse.json({ error: "That reporting period already exists" }, { status: 409 });
  }

  const now = new Date().toISOString();
  // Created LOCKED, not OPEN - a period starts closed to the full workflow
  // (submit/review/rectify/etc.) until an admin deliberately opens it, but
  // still accepts DRAFT findings by default (draftsAllowedWhileLocked)
  // so registration work isn't blocked in the meantime. See
  // src/lib/findings.ts's assertPeriodWritable() for the DRAFT exception.
  const period = {
    id: uuid(),
    year,
    month,
    code,
    name: name?.trim() || null,
    startsAt: start.toISOString(),
    endsAt: new Date(endsAt).toISOString(),
    submissionStartsAt: new Date(submissionStartsAt).toISOString(),
    submissionEndsAt: new Date(submissionEndsAt).toISOString(),
    status: "LOCKED" as const,
    lockedBy: auth.session.userId!,
    lockedAt: now,
    lockReason: "Created locked by default - open it to allow full submission/review workflow.",
    draftsAllowedWhileLocked: true,
    createdAt: now,
    updatedAt: now,
  };

  await updateDb((current) => {
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

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
