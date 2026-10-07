import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { updateDb } from "@/lib/db";
import { withApiHandler } from "@/lib/api/handler";
import { editAdjustment, getAdjustmentConfig, submitAdjustment, withdrawAdjustment } from "@/lib/adjustments";
import { updateAdjustmentSchema } from "@/lib/adjustments/schemas";

/**
 * The requester's actions on their adjustment (docs/revolving-findings.md R13):
 * { action: "edit", ...change, submit? } | { action: "submit" } | { action: "withdraw", reason? }
 */
async function handlePATCH(request: Request, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const auth = await requirePermission("findings.create");
  if (!auth.ok) return auth.response;
  const { id, adjId } = await params;
  const parsed = updateAdjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const body = parsed.data;

  const config = await getAdjustmentConfig();
  const adjustment = await updateDb((db) => {
    if (body.action === "withdraw") return withdrawAdjustment(db, auth.session, id, adjId, body.reason);
    if (body.action === "submit") return submitAdjustment(db, config, auth.session, id, adjId);
    const { submit, addedCases, amountChange, newCaseAmounts, caseAmountChanges, reason } = body;
    return editAdjustment(db, config, auth.session, id, adjId, { addedCases, amountChange, newCaseAmounts, caseAmountChanges, reason }, { submit });
  });
  return NextResponse.json({ adjustment });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const PATCH = withApiHandler(handlePATCH);
