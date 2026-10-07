import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { appendAuditLog } from "@/lib/audit";
import { withApiHandler } from "@/lib/api/handler";
import { getAdjustmentConfig, saveAdjustmentConfig } from "@/lib/adjustments";
import { adjustmentConfigSchema } from "@/lib/adjustments/schemas";

/**
 * Settings -> Revolving Findings (docs/revolving-findings.md R1, R17): the
 * operation areas whose findings can be adjusted.
 *
 * GET   -> { config, operationAreas (choices: configured + used on findings) }
 * PATCH -> { revolvingOperationAreas }
 */
async function handleGET() {
  const auth = await requirePermission("settings.view");
  if (!auth.ok) return auth.response;
  const [config, db] = await Promise.all([getAdjustmentConfig(), readDb()]);
  const used = new Map<string, string>();
  for (const a of [...db.settings.operationAreas, ...db.findings.map((f) => f.operationArea), ...config.revolvingOperationAreas]) {
    const v = (a ?? "").trim();
    if (v && !used.has(v.toLowerCase())) used.set(v.toLowerCase(), v);
  }
  return NextResponse.json({ config, operationAreas: [...used.values()].sort((a, b) => a.localeCompare(b)) });
}

async function handlePATCH(request: Request) {
  const auth = await requirePermission("settings.edit");
  if (!auth.ok) return auth.response;
  const parsed = adjustmentConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const before = await getAdjustmentConfig();
  const config = await saveAdjustmentConfig(parsed.data.revolvingOperationAreas, auth.session.name!);
  await updateDb((current) => {
    appendAuditLog(current, {
      userId: auth.session.userId!,
      userName: auth.session.name!,
      action: "UPDATE",
      entityType: "AdjustmentConfig",
      entityId: "singleton",
      oldValue: { revolvingOperationAreas: before.revolvingOperationAreas },
      newValue: { revolvingOperationAreas: config.revolvingOperationAreas },
    });
  });
  return NextResponse.json({ config });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const PATCH = withApiHandler(handlePATCH);
