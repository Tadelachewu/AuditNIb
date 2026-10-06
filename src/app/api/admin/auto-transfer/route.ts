import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { zUniqueList } from "@/lib/inputRules";
import { withApiHandler } from "@/lib/api/handler";
import { prismaAutoTransferStore, sweepDueAt } from "@/lib/autoTransfer";

/**
 * Automatic transfer at period end - its settings and each period's status
 * (src/lib/autoTransfer). Readable by whoever can see Settings or Reporting
 * Periods; only Settings › Edit can change it.
 *
 * GET -> { installed, config, runs, operationAreas, nextDue }
 */
async function handleGET() {
  const auth = await requirePermission("settings.view", "reporting-periods.view");
  if (!auth.ok) return auth.response;

  const [config, runs, db] = await Promise.all([prismaAutoTransferStore.getConfig(), prismaAutoTransferStore.listRuns(), readDb()]);
  // Choices for the exclusion list: the configured operation areas plus any
  // other value already used on findings (typed-in "Other" values).
  const used = new Map<string, string>();
  for (const a of [...db.settings.operationAreas, ...db.findings.map((f) => f.operationArea)]) {
    const v = (a ?? "").trim();
    if (v && !used.has(v.toLowerCase())) used.set(v.toLowerCase(), v);
  }
  // When each period not yet handled becomes due (for the status column).
  const dueAt = Object.fromEntries(db.reportingPeriods.map((p) => [p.id, new Date(sweepDueAt(p, config ?? { delayHours: 0 })).toISOString()]));

  return NextResponse.json({
    installed: config !== null,
    config,
    runs,
    dueAt,
    operationAreas: [...used.values()].sort((a, b) => a.localeCompare(b)),
  });
}

const updateSchema = z.object({
  enabled: z.boolean(),
  excludedOperationAreas: zUniqueList("Operation area"),
  delayHours: z.number().int().min(0, "Delay must be 0 or more hours").max(720, "Delay must be at most 720 hours (30 days)"),
});

async function handlePATCH(request: Request) {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const before = await prismaAutoTransferStore.getConfig();
  if (!before) {
    return NextResponse.json(
      { error: "Automatic transfer isn't installed on this database yet - apply its migration first (see docs/auto-transfer.md)." },
      { status: 409 }
    );
  }
  const config = await prismaAutoTransferStore.saveConfig(parsed.data, auth.session.name!);
  await updateDb((current) => {
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "AutoTransferConfig",
      entityId: "singleton",
      oldValue: { enabled: before.enabled, excludedOperationAreas: before.excludedOperationAreas, delayHours: before.delayHours },
      newValue: parsed.data,
    });
  });
  return NextResponse.json({ config });
}

export const GET = withApiHandler(handleGET);
export const PATCH = withApiHandler(handlePATCH);
