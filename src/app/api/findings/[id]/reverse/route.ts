import { NextResponse } from "next/server";
import { z } from "zod";
import { zReason } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { canReverse, reverseFinding } from "@/lib/findingReverse";
import { notifyFindingsPermissionHolders, notifyUsers } from "@/lib/notifications";
import { AuthorizationError, BusinessRuleError, NotFoundError } from "@/lib/errors";
import { fromZodError } from "@/lib/errors/normalize";
import { withApiHandler } from "@/lib/api/handler";

const bodySchema = z.object({ reason: zReason() });

// Reverse what was closed in the finding's current period and send it back
// to "Sent to Branch Manager/R" (src/lib/findingReverse.ts). Permission key
// findings.reopen (stored in roles, so kept). The finding must be in the
// caller's scope; period locks don't block it.
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.reopen");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw fromZodError(parsed.error);

  const check = (db: Awaited<ReturnType<typeof readDb>>) => {
    const f = db.findings.find((x) => x.id === id);
    if (!f) throw new NotFoundError("finding");
    const scopeError = assertFindingInScope(auth.session, f);
    if (scopeError) throw new AuthorizationError(scopeError);
    if (!canReverse(db, f)) throw new BusinessRuleError("FINDING_NOT_REVERSIBLE");
    return f;
  };
  check(await readDb());

  await updateDb((current) => {
    const f = check(current);
    reverseFinding(current, f, { userId: auth.session.userId!, userName: auth.session.name! }, parsed.data.reason);
    const period = current.reportingPeriods.find((p) => p.id === f.periodId);
    const opts = {
      // Stored notification type (email-event setting) - name kept.
      type: "REOPENED" as const,
      title: `Finding ${f.reference} reversed`,
      message: `${f.reference} was reversed in ${period?.code ?? "its current period"} by ${auth.session.name} (status Sent to Branch Manager/R) and is back with the branch to rectify again. Reason: ${parsed.data.reason}`,
      entityType: "Finding",
      entityId: f.id,
    };
    // The branch that must rectify it again, and the registrant.
    notifyFindingsPermissionHolders(current, "rectify", { branchId: f.branchId }, opts);
    notifyUsers(current, [f.createdBy], opts);
  });
  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
