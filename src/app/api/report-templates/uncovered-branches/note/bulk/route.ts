import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { upsertBranchCoverageNote } from "@/lib/branchCoverageNotes";

const bulkSchema = z.object({
  branchIds: z.array(z.string().min(1)).min(1, "Select at least one branch"),
  periodId: z.string().min(1),
  reason: z.string().trim().min(1, "A reason is required"),
  reasonId: z.string().min(1).nullable().optional(),
});

// Multi-select version of note/route.ts's single-branch upsert - applies
// the same reason to every selected branch in one write, so a reporter
// clearing a whole page of "not yet dispatched" branches doesn't have to
// repeat the same pick N times. Same permission, same org-scope rule, same
// upsert helper (upsertBranchCoverageNote) as the single-branch route -
// just looped, and all-or-nothing on validation (one out-of-scope or
// unknown branch fails the whole batch rather than silently skipping it).
export async function POST(request: Request) {
  const auth = await requirePermission("report-templates.uncovered-branches");
  if (!auth.ok) return auth.response;

  const parsed = bulkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { branchIds, periodId, reason, reasonId = null } = parsed.data;

  const db = readDb();
  if (!db.reportingPeriods.some((p) => p.id === periodId)) {
    return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  }
  if (reasonId !== null && !db.uncoveredReasons.some((r) => r.id === reasonId)) {
    return NextResponse.json({ error: "Reason not found" }, { status: 404 });
  }

  const branches = branchIds.map((id) => db.branches.find((b) => b.id === id));
  const missingIndex = branches.findIndex((b) => !b);
  if (missingIndex !== -1) {
    return NextResponse.json({ error: `Branch not found: ${branchIds[missingIndex]}` }, { status: 404 });
  }

  if (auth.session.orgScope === "BRANCH") {
    return NextResponse.json({ error: "This branch is outside your organizational scope." }, { status: 403 });
  }
  if (
    auth.session.orgScope === "DISTRICT" &&
    branches.some((b) => b!.districtId !== auth.session.districtId)
  ) {
    return NextResponse.json({ error: "One or more selected branches are outside your organizational scope." }, { status: 403 });
  }

  const notes = updateDb((current) =>
    branchIds.map((branchId) =>
      upsertBranchCoverageNote(current, {
        branchId,
        periodId,
        reason,
        reasonId,
        userId: auth.session.userId!,
        userName: auth.session.name!,
      })
    )
  );

  return NextResponse.json({ notes });
}
