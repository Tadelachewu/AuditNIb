import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, hoApproveFinding, assertPeriodWritable } from "@/lib/findings";
import { notifyFindingsPermissionHolders, notifyUsers, usersWithFindingsPermission } from "@/lib/notifications";

const reviewSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT", "RETURN"]),
    reason: z.string().optional(),
  })
  .refine((v) => v.decision === "APPROVE" || (v.reason && v.reason.trim().length >= 5), {
    message: "A reason of at least 5 characters is required to reject or return a finding",
    path: ["reason"],
  });

// Head Office Internal Controller's second-approval stage. Only acts on
// findings currently in HO_REVIEW; HO's orgScope is BANK-wide, so
// assertFindingInScope allows any district/branch here by design.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("findings.ho-review");
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

  if (existing.status !== "HO_REVIEW") {
    return NextResponse.json({ error: "This finding is not awaiting HO review" }, { status: 409 });
  }

  // Same separation-of-duties gate as district-review and bank-approval:
  // an HO reviewer cannot return for correction a finding they themselves
  // originally registered. Would be a no-op (returning it to themselves
  // to edit and resubmit) and defeats the two-eye reviewer/creator split.
  // Approve and Reject remain structurally allowed (the BRD doesn't ban
  // self-approval outright — only the self-return loop is nonsensical).
  if (decision === "RETURN" && existing.createdBy === auth.session.userId) {
    return NextResponse.json(
      { error: "You cannot return for correction a finding you yourself created at HO review. Use Reject instead if the finding should not proceed." },
      { status: 409 }
    );
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    if (decision === "APPROVE") {
      hoApproveFinding(current, f, auth.session.userId!, auth.session.name!);
      notifyFindingsPermissionHolders(current, "rectify", { branchId: f.branchId }, {
        type: "HO_APPROVED",
        title: `${f.reference} approved - awaiting rectification`,
        message: `${auth.session.name} approved this finding at HO level.`,
        entityType: "Finding",
        entityId: f.id,
      });
    } else {
      transitionFinding(current, f, {
        toStatus: decision === "REJECT" ? "REJECTED" : "RETURNED",
        action: decision === "REJECT" ? "HO_REJECT" : "HO_RETURN",
        userId: auth.session.userId!,
        userName: auth.session.name!,
        reason,
      });
      // Document_3 §9/§30: HO's return is depicted as HO -> District ->
      // Branch Controller, not a single hop straight to whoever created
      // it. The finding itself still lands with the creator to fix
      // (resubmitting naturally routes back through DISTRICT_REVIEW
      // before HO sees it again - submitFinding() already does that), but
      // the District Controller needs to be notified at the moment of
      // the return too, not just once a resubmission happens to reach
      // them - otherwise they're not "kept in the loop" as the doc's
      // diagram shows.
      const recipients = new Set([f.createdBy]);
      if (decision === "RETURN") {
        for (const districtControllerId of usersWithFindingsPermission(current, "district-review", { districtId: f.districtId })) {
          recipients.add(districtControllerId);
        }
      }
      notifyUsers(current, [...recipients], {
        type: decision === "REJECT" ? "REJECTED" : "RETURNED",
        title: `${f.reference} ${decision === "REJECT" ? "rejected" : "returned"} by HO`,
        message: reason ?? "",
        entityType: "Finding",
        entityId: f.id,
      });
    }
    return f;
  });

  return NextResponse.json({ finding: updated });
}
