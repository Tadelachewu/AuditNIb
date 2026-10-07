import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { updateDb } from "@/lib/db";
import { withApiHandler } from "@/lib/api/handler";
import { reviewAdjustment } from "@/lib/adjustments";
import { reviewAdjustmentSchema } from "@/lib/adjustments/schemas";

/**
 * Approve / return / reject an adjustment at its current step
 * (docs/revolving-findings.md R11, R12). The permission the step needs,
 * scope and separation of duties are checked by reviewerProblem().
 */
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string; adjId: string }> }) {
  const auth = await requirePermission("findings.district-review", "findings.ho-review", "findings.bank-approval");
  if (!auth.ok) return auth.response;
  const { id, adjId } = await params;
  const parsed = reviewAdjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const adjustment = await updateDb((db) => reviewAdjustment(db, auth.session, id, adjId, parsed.data.decision, parsed.data.reason));
  return NextResponse.json({ adjustment });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
