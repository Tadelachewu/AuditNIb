import { NextResponse } from "next/server";
import { z } from "zod";
import { zReason } from "@/lib/inputRules";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import {
  transitionFinding,
  userPerformedApprovalOrVerifyAction,
  hasRectificationAfterLastTransfer,
  hoReturnBlockedReason,
} from "@/lib/findings";
import { usersWithFindingsPermission, notifyUsers } from "@/lib/notifications";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { withApiHandler } from "@/lib/api/handler";

// Deliberately excludes SENT_TO_BRANCH_MANAGER - "return for correction"
// only ever makes sense once the Branch Manager has actually recorded
// something to react to. Before that, the finding is just waiting on the
// branch; there's nothing yet for a Controller to judge as correct or not,
// so nobody (District or HO, on any finding, bank-registered or not) can
// return it at that stage. A mistake in the finding's own earlier approval
// belongs to District/HO Review's own Return (findings/[id]/district-
// review,ho-review) instead - that only works while still *at* that review
// stage, which is exactly the point: this endpoint is about the recorded
// rectification, not a do-over of the approval decision.
const RETURNABLE_STATUSES = ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"];

const returnSchema = z.object({
  reason: zReason(),
});

// Post-approval return-for-correction endpoint. Now uses a split permission
// model (see FINDINGS_WORKFLOW.md §2 matrix and registry.ts):
//
//   findings.return-rectification         → legacy / unrestricted (backward compat)
//   findings.district-return-rectification → District Controller: unrestricted,
//                                            can return before OR after district
//                                            verification (including before the
//                                            branch has recorded any rectification)
//   findings.ho-return-rectification       → HO Controller: GATED - can return
//                                            only AFTER District has verified ALL
//                                            recorded rectification (nothing still
//                                            awaiting District) and some of it is
//                                            not yet closed - hoReturnBlockedReason().
//                                            This enforces District's first-level
//                                            gate before HO acts - HO steps in
//                                            only after District has already
//                                            engaged with the recorded
//                                            rectification, never ahead of them.
//
// Finding.registeredByBankScope plays no role in this route - District's
// standing to verify/return a recorded rectification is the same routine
// oversight job regardless of how the original finding was approved, and
// (per RETURNABLE_STATUSES above) there's no earlier "nothing rectified
// yet" stage left for a bank-scope distinction to matter at.
async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(
    permissionKey("findings", "return-rectification"),
    permissionKey("findings", "district-return-rectification"),
    permissionKey("findings", "ho-return-rectification")
  );
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const parsed = returnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { reason } = parsed.data;

  const db = await readDb();
  const existing = db.findings.find((f) => f.id === id);
  if (!existing) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

  const scopeError = assertFindingInScope(auth.session, existing);
  if (scopeError) return NextResponse.json({ error: scopeError }, { status: 403 });

  if (!RETURNABLE_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "This finding can't be returned for correction from its current status" }, { status: 409 });
  }

  const hasLegacy = hasPermission(auth.session.permissions, permissionKey("findings", "return-rectification"));
  const hasDistrict = hasPermission(auth.session.permissions, permissionKey("findings", "district-return-rectification"));
  const hasHo = hasPermission(auth.session.permissions, permissionKey("findings", "ho-return-rectification"));
  const hasHoOnly = hasHo && !hasLegacy && !hasDistrict;

  // HO-scoped gate: if user holds ONLY ho-return-rectification (not the
  // legacy unrestricted one, not the District variant), they can't return
  // until District has first verified at least some portion of a recorded
  // rectification - District's first-level gate isn't bypassed, HO only
  // steps in after District has already engaged with it.
  if (hasHoOnly) {
    const blocked = hoReturnBlockedReason(existing);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
  }

  // Separation of duties, scoped to *this* rectification: whoever already
  // verified or closed it can't also be the one to return it - that's the
  // same identity signing off on the rectification and then reversing it.
  // Return must stay possible before that verify/close happens - it's the
  // finding's own earlier DISTRICT_APPROVE/HO_APPROVE that must NOT count
  // here (see userPerformedApprovalOrVerifyAction()'s own doc comment), or
  // the District Controller who approved the finding at District Review
  // would be locked out of ever returning its later rectification. A
  // different person holding the same permission still can.
  if (userPerformedApprovalOrVerifyAction(db, existing.id, auth.session.userId!)) {
    return NextResponse.json(
      {
        error:
          "You already verified or closed part of this finding's rectification - it can't be returned for correction by the same person who signed off on it.",
      },
      { status: 409 }
    );
  }

  // Post-transfer: a finding sitting at TRANSFERRED can't be returned until
  // the branch has recorded new rectification after that transfer -
  // otherwise "return" would just be re-litigating the outstanding balance
  // the transfer already carried forward untouched, with nothing new on
  // record to actually be wrong.
  if (existing.status === "TRANSFERRED" && !hasRectificationAfterLastTransfer(db, existing)) {
    return NextResponse.json(
      {
        error:
          "This finding was just transferred into its current period - it can't be returned for correction until the Branch Manager records new rectification here.",
      },
      { status: 409 }
    );
  }

  // A locked period only blocks submission - not this action.

  const updated = await updateDb((current) => {
    const f = current.findings.find((x) => x.id === id)!;

    transitionFinding(current, f, {
      toStatus: "RECTIFICATION_RETURNED",
      action: "RETURN_RECTIFICATION",
      userId: auth.session.userId!,
      userName: auth.session.name!,
      reason,
    });

    const branchRecipients = usersWithFindingsPermission(current, "rectify", { branchId: f.branchId });
    if (branchRecipients.length > 0) {
      notifyUsers(current, branchRecipients, {
        type: "RECTIFICATION_RETURNED",
        title: `${f.reference} sent back for correction`,
        message: `${auth.session.name}: ${reason}`,
        entityType: "Finding",
        entityId: f.id,
      });
    }

    // HO is the last decision-maker in this chain (Branch rectifies ->
    // District verifies -> HO can close or return) - when HO is the one
    // returning it (hasHoOnly, the same gate that required District to
    // have verified first, above), the District Controller who already
    // verified this rectification needs to know their sign-off just got
    // overridden - same "keep the middle approver in the loop" reasoning
    // ho-review/route.ts applies to a finding-level HO Return/Reject, just
    // one stage further down the workflow.
    if (hasHoOnly) {
      const districtRecipients = usersWithFindingsPermission(current, "verify-rectification", { districtId: f.districtId });
      if (districtRecipients.length > 0) {
        notifyUsers(current, districtRecipients, {
          type: "RECTIFICATION_RETURNED",
          title: `${f.reference} sent back for correction by HO`,
          message: `${auth.session.name}: ${reason}`,
          entityType: "Finding",
          entityId: f.id,
        });
      }
    }

    return f;
  });

  return NextResponse.json({ finding: updated });
}

// Central error handling, request ID and access logging: src/lib/api/handler.ts
export const POST = withApiHandler(handlePOST);
