import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, districtApproveFinding, assertPeriodWritable } from "@/lib/findings";
import { notifyFindingsPermissionHolders, notifyUsers } from "@/lib/notifications";

const reviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
    reason: z.string().optional(),
  })
  .refine((v) => v.decision === "APPROVE" || (v.reason && v.reason.trim().length >= 5), {
    message: "A reason of at least 5 characters is required to reject or return a finding",
    path: ["reason"],
  });

// District Internal Controller's "Review branch submissions... Approve or
// return findings" (icfms.txt). Only acts on findings currently in
// DISTRICT_REVIEW; the org-scope check (via requirePermission's session +
// assertFindingInScope) is what actually stops a controller from acting on
// another district's finding, not this route's own logic.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.district-review");
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { decision, reason } = parsed.data;

  const db = readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "DISTRICT_REVIEW") {
    return NextResponse.json({ error: "This finding is not awaiting district review" }, { status: 409 });
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    if (decision === "APPROVE") {
      districtApproveFinding(current, f, auth.session.userId!, auth.session.name!);
      notifyFindingsPermissionHolders(current, "ho-review", {}, {
        type: "DISTRICT_APPROVED",
        title: `${f.reference} awaiting HO review`,
        message: `${auth.session.name} approved this finding at district level.`,
        entityType: "Finding",
        entityId: f.id,
      });
    } else {
      transitionFinding(current, f, {
        toStatus: decision === "REJECT" ? "REJECTED" : "RETURNED",
        action: decision === "REJECT" ? "DISTRICT_REJECT" : "DISTRICT_RETURN",
        userId: auth.session.userId!,
        userName: auth.session.name!,
        reason,
      });
      notifyUsers(current, [f.createdBy], {
        type: decision === "REJECT" ? "REJECTED" : "RETURNED",
        title: `${f.reference} ${decision === "REJECT" ? "rejected" : "returned"} by district`,
        message: reason ?? "",
        entityType: "Finding",
        entityId: f.id,
      });
    }
    return f;
  });

  return NextResponse.json({ finding: updated });
}
