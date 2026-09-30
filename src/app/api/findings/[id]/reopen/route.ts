import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { assertPeriodWritable } from "@/lib/findings";
import { canReopen, periodsAffectedByReopen, reopenFinding } from "@/lib/findingReopen";
import { notifyFindingsPermissionHolders, notifyUsers } from "@/lib/notifications";
import { AuthorizationError, BusinessRuleError, NotFoundError } from "@/lib/errors";
import { fromZodError } from "@/lib/errors/normalize";
import { withApiHandler } from "@/lib/api/handler";

const bodySchema = z.object({ reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500) });

// Reopen a closed / partially closed finding back to a fresh "Sent to
// Branch Manager" (src/lib/findingReopen.ts). Permission: findings.reopen;
// the finding must be in the caller's scope and its period writable.
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
    if (!canReopen(f)) throw new BusinessRuleError("FINDING_NOT_REOPENABLE");
    // Reversing a closure changes the figures of every period it was
    // credited to (e.g. the origin period of a transferred finding), so
    // none of them may be locked.
    for (const pid of periodsAffectedByReopen(db, f)) {
      const periodError = assertPeriodWritable(db, pid);
      if (periodError) throw new BusinessRuleError("PERIOD_LOCKED", periodError);
    }
    return f;
  };
  check(await readDb());

  await updateDb((current) => {
    const f = check(current);
    const { toStatus } = reopenFinding(current, f, { userId: auth.session.userId!, userName: auth.session.name! }, parsed.data.reason);
    const opts = {
      type: "REOPENED" as const,
      title: `Finding ${f.reference} reopened`,
      message: `The closure of ${f.reference} was reversed by ${auth.session.name} - status is now ${toStatus.replaceAll("_", " ").toLowerCase()} and it can be reviewed and closed again. Reason: ${parsed.data.reason}`,
      entityType: "Finding",
      entityId: f.id,
    };
    // Whoever can close it again, plus the branch and the registrant.
    notifyFindingsPermissionHolders(current, "close", { districtId: f.districtId }, opts);
    notifyFindingsPermissionHolders(current, "rectify", { branchId: f.branchId }, opts);
    notifyUsers(current, [f.createdBy], opts);
  });
  return NextResponse.json({ ok: true });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
