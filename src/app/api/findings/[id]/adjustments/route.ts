import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { withApiHandler } from "@/lib/api/handler";
import { adjustmentsView, createAdjustment, getAdjustmentConfig } from "@/lib/adjustments";
import { createAdjustmentSchema } from "@/lib/adjustments/schemas";

/**
 * Revolving findings (docs/revolving-findings.md): a finding's adjustments.
 *
 * GET  -> AdjustmentsView (src/lib/adjustments/view.ts)
 * POST -> start one - a draft, or { submit: true } to submit at once
 */
async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.view");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const [db, config] = await Promise.all([readDb(), getAdjustmentConfig()]);
  const f = db.findings.find((x) => x.id === id);
  if (!f) return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  const scopeError = assertFindingInScope(auth.session, f);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });
  return NextResponse.json(adjustmentsView(db, config, auth.session, f));
}

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.create");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = createAdjustmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const { submit, ...input } = parsed.data;

  const config = await getAdjustmentConfig();
  const adjustment = await updateDb((db) => createAdjustment(db, config, auth.session, id, input, { submit }));
  return NextResponse.json({ adjustment }, { status: 201 });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const GET = withApiHandler(handleGET);
export const POST = withApiHandler(handlePOST);
