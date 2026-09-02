import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { transitionFinding, assertPeriodWritable } from "@/lib/findings";
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

// The optional single approval step for a bank-wide (HO/Admin)-registered
// finding (Settings.hoApproval.required - see submitFinding()'s branch in
// src/lib/findings.ts). Gated to the specific user(s) an admin assigned in
// Settings.hoApproval.approverUserIds, not a role/permission - "who
// approves" here is a deliberate per-person assignment, always drawn from
// BANK-scoped users only (enforced in the settings PATCH route), rather
// than "everyone holding some permission" the way every other review stage
// in this app works.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = readDb();
  if (!db.settings.hoApproval.approverUserIds.includes(auth.session.userId!)) {
    return NextResponse.json({ error: "You are not assigned as an approver for this" }, { status: 403 });
  }

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { decision, reason } = parsed.data;

  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (existing.status !== "PENDING_BANK_APPROVAL") {
    return NextResponse.json({ error: "This finding is not awaiting approval" }, { status: 409 });
  }

  // Self-return block at the bank-approval stage — the single-step
  // approval path for HO/Admin-registered findings (those that skipped
  // DISTRICT_REVIEW/HO_REVIEW because the submitting user had orgScope
  // === "BANK"). If the assigned approver is also the finding's creator,
  // returning it would send it back to themselves for editing — a
  // meaningless no-op. Approve and Reject are still allowed (the former
  // is actually the common case: a HO Controller self-approves their own
  // Internal Audit finding when Settings.hoApproval.required is on and
  // they're in the approver list); only the self-return loop is blocked.
  if (decision === "RETURN" && existing.createdBy === auth.session.userId) {
    return NextResponse.json(
      { error: "You cannot return for correction a finding you yourself created for bank approval. Use Reject instead if it should not proceed, or Approve to send it to the branch." },
      { status: 409 }
    );
  }

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

  const updated = updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;
    if (decision === "APPROVE") {
      transitionFinding(current, f, {
        toStatus: "SENT_TO_BRANCH_MANAGER",
        action: "BANK_APPROVE",
        userId: auth.session.userId!,
        userName: auth.session.name!,
      });
      notifyFindingsPermissionHolders(current, "rectify", { branchId: f.branchId }, {
        type: "BANK_APPROVED",
        title: `${f.reference} approved - awaiting rectification`,
        message: `${auth.session.name} approved this finding.`,
        entityType: "Finding",
        entityId: f.id,
      });
    } else {
      transitionFinding(current, f, {
        toStatus: decision === "REJECT" ? "REJECTED" : "RETURNED",
        action: decision === "REJECT" ? "BANK_REJECT" : "BANK_RETURN",
        userId: auth.session.userId!,
        userName: auth.session.name!,
        reason,
      });
      const recipients = new Set([f.createdBy]);
      if (decision === "RETURN") {
        // Same "keep the district in the loop" reasoning as HO's own
        // return, even though this finding never went through district
        // review - a district-review holder in this finding's district may
        // still care that a bank-registered finding for their district
        // just got sent back.
        for (const districtControllerId of usersWithFindingsPermission(current, "district-review", { districtId: f.districtId })) {
          recipients.add(districtControllerId);
        }
      }
      notifyUsers(current, [...recipients], {
        type: decision === "REJECT" ? "REJECTED" : "RETURNED",
        title: `${f.reference} ${decision === "REJECT" ? "rejected" : "returned"}`,
        message: reason ?? "",
        entityType: "Finding",
        entityId: f.id,
      });
    }
    return f;
  });

  return NextResponse.json({ finding: updated });
}
