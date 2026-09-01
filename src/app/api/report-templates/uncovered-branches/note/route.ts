import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { upsertBranchCoverageNote } from "@/lib/branchCoverageNotes";

const noteSchema = z.object({
  branchId: z.string().min(1),
  periodId: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required"),
  // The canned UncoveredReason picked from the admin list, or null when the
  // reporter chose "Other" and typed `reason` by hand.
  reasonId: z.string().min(1).nullable().optional(),
});

// The Uncovered Branches report's one writable piece of state - why a
// branch has zero findings for a period. Upsert (at most one note per
// branch+period), gated by the same report-templates.uncovered-branches
// permission that lets you view the report at all (see the type's own doc
// comment in src/types/index.ts) - not tied to the reporting period's
// lock status, since recording a retrospective reason for an already-locked
// period is exactly the normal case, not an edge case to block. See
// note/bulk/route.ts for the multi-branch version of this same upsert.
export async function POST(request: Request) {
  const auth = await requirePermission("report-templates.uncovered-branches");
  if (!auth.ok) return auth.response;

  const parsed = noteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { branchId, periodId, reason, reasonId = null } = parsed.data;

  const db = readDb();
  const branch = db.branches.find((b) => b.id === branchId);
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  if (!db.reportingPeriods.some((p) => p.id === periodId)) {
    return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  }
  if (reasonId !== null && !db.uncoveredReasons.some((r) => r.id === reasonId)) {
    return NextResponse.json({ error: "Reason not found" }, { status: 404 });
  }

  // Same org-scope convention as assertFindingInScope() in
  // src/lib/findings-scope.ts - a DISTRICT-scoped session may only note
  // branches in its own district; BANK-scoped sessions aren't narrowed.
  if (auth.session.orgScope === "DISTRICT" && branch.districtId !== auth.session.districtId) {
    return NextResponse.json({ error: "This branch is outside your organizational scope." }, { status: 403 });
  }
  if (auth.session.orgScope === "BRANCH") {
    return NextResponse.json({ error: "This branch is outside your organizational scope." }, { status: 403 });
  }

  const note = updateDb((current) =>
    upsertBranchCoverageNote(current, {
      branchId,
      periodId,
      reason,
      reasonId,
      userId: auth.session.userId!,
      userName: auth.session.name!,
    })
  );

  return NextResponse.json({ note });
}
