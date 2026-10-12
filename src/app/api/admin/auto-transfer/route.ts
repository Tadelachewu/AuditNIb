import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { looseListItemError } from "@/lib/inputRules";
import { withApiHandler } from "@/lib/api/handler";
import { AutoTransferNotMigratedError, prismaAutoTransferStore, sweepDueAt } from "@/lib/autoTransfer";

/**
 * Automatic transfer at period end - its settings and each period's status
 * (src/lib/autoTransfer). Readable by whoever can see Settings or Reporting
 * Periods; only Settings › Edit can change it.
 *
 * GET -> { installed, config, runs, operationAreas, sources, dueAt }
 */
async function handleGET() {
  const auth = await requirePermission("settings.view", "reporting-periods.view");
  if (!auth.ok) return auth.response;

  const [config, runs, db] = await Promise.all([prismaAutoTransferStore.getConfig(), prismaAutoTransferStore.listRuns(), readDb()]);
  // Choices for the areas to transfer: the configured operation areas plus any
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
    // The columns of the area x source grid.
    sources: db.sources.map((s) => ({ id: s.id, code: s.code, name: s.name, active: s.active })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

const updateSchema = z.object({
  enabled: z.boolean(),
  // Per operation area, the sources transferred. Areas may be values typed as
  // "Other" on findings, so not the strict Configurable List rule.
  includedAreaSources: z
    .array(
      z.object({
        operationArea: z.string().trim().superRefine((v, ctx) => {
          const problem = looseListItemError(v, "Operation area");
          if (problem) ctx.addIssue({ code: "custom", message: `${problem} ("${v}")` });
        }),
        sourceIds: z.array(z.string().min(1)).min(1, "Tick at least one source for each operation area"),
      })
    )
    .max(500)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      for (const r of rows) {
        const key = r.operationArea.replace(/\s+/g, " ").toLowerCase();
        if (seen.has(key)) ctx.addIssue({ code: "custom", message: `Operation area "${r.operationArea}" is listed twice` });
        seen.add(key);
      }
    }),
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
  if (before.legacy) return NextResponse.json({ error: new AutoTransferNotMigratedError().message }, { status: 409 });
  const known = new Set((await readDb()).sources.map((s) => s.id));
  const includedAreaSources = parsed.data.includedAreaSources.map((r) => ({ operationArea: r.operationArea, sourceIds: [...new Set(r.sourceIds)] }));
  if (includedAreaSources.some((r) => r.sourceIds.some((id) => !known.has(id)))) {
    return NextResponse.json({ error: "One of the ticked sources no longer exists. Reload the page and try again." }, { status: 400 });
  }
  const data = { ...parsed.data, includedAreaSources };
  const config = await prismaAutoTransferStore.saveConfig(data, auth.session.name!);
  await updateDb((current) => {
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "AutoTransferConfig",
      entityId: "singleton",
      oldValue: { enabled: before.enabled, includedAreaSources: before.includedAreaSources, delayHours: before.delayHours },
      newValue: data,
    });
  });
  return NextResponse.json({ config });
}

export const GET = withApiHandler(handleGET);
export const PATCH = withApiHandler(handlePATCH);
