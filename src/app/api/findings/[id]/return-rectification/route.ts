import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/guard";
import { readDb, updateDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import {
  transitionFinding,
  assertPeriodWritable,
  userPerformedApprovalOrVerifyAction,
  hasRectificationAfterLastTransfer,
} from "@/lib/findings";
import { usersWithFindingsPermission, notifyUsers } from "@/lib/notifications";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";

// SENT_TO_BRANCH_MANAGER (approved, nothing rectified yet) is included
// alongside the three post-rectification statuses - without it, a
// Controller who approves a finding and then, before the branch has
// rectified anything at all, realizes it needs correction has no way to
// send it back at all: District/HO Review's own Return only works while
// still *at* that review stage (findings/[id]/district-review,ho-review),
// and this route previously only accepted a finding that already had a
// recorded rectification. See resubmit-rectification/route.ts's matching
// fix for how it recovers a finding returned from this zero-rectified state.
const RETURNABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"];

const returnSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
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
//                                            only AFTER District has first done
//                                            verify-rectification (there must be
//                                            at least some district-verified cases
//                                            or amount already on the finding).
//                                            This ensures District's first-level
//                                            gate isn't bypassed and prevents HO
//                                            from sending a still-SENT_TO_BRANCH
//                                            finding (nothing rectified yet,
//                                            especially one HO themselves created
//                                            and approved) back for correction.
//
// Exception: Finding.registeredByBankScope, narrowly scoped to the one
// moment District truly has no standing at all - SENT_TO_BRANCH_MANAGER
// with nothing rectified yet. A bank-registered finding skipped District
// Review entirely at the approval stage (submitFinding()'s own doc
// comment - "there's no natural district to review a finding HO itself
// registered"), so District can't preemptively bounce it back before the
// branch has even attempted a fix; only HO can (and HO's own district-
// verification-first gate is waived here too, since there's nothing for
// District to have verified yet either way). The MOMENT the branch
// actually records a rectification, ordinary District oversight resumes
// in full (both this route's district-return-rectification AND
// verify-rectification elsewhere) - checking the branch's actual work is
// District's routine job regardless of how the original finding was
// approved, and verify/return are the two outcomes of that same review,
// so blocking one while leaving the other intact would be incoherent
// (District could rubber-stamp a bank-registered finding's rectification
// as correct but not send it back if it wasn't - the riskier gap, not the
// safer one).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // See this file's own top-of-file doc comment - narrowly scoped to
  // "nothing rectified yet," not the whole lifecycle.
  const bankScopeStillUnrectified = existing.registeredByBankScope && existing.status === "SENT_TO_BRANCH_MANAGER";

  if (bankScopeStillUnrectified && hasDistrict && !hasLegacy && !hasHo) {
    return NextResponse.json(
      {
        error:
          "This bank-registered finding hasn't had any rectification recorded yet - only Head Office can return it for correction at this stage, not the District Controller.",
      },
      { status: 403 }
    );
  }

  // HO-scoped gate: if user holds ONLY ho-return-rectification (not the
  // legacy unrestricted one, not the District variant), they can't return
  // until District has first verified at least some portion of a recorded
  // rectification. This (a) enforces the District-first verification gate
  // before HO acts, and (b) automatically means HO cannot return a finding
  // still sitting at SENT_TO_BRANCH_MANAGER (zero rectified / zero
  // verified), including findings HO themselves created and approved.
  // Waived only for that same narrow bank-scope-and-unrectified case above -
  // there's nothing for District to have verified yet either way, and
  // District has no standing to act first at that exact moment. Once real
  // rectification exists, this gate applies normally even to a
  // bank-registered finding, since District is expected to verify it just
  // like any other finding by that point.
  if (hasHoOnly && !bankScopeStillUnrectified) {
    const verifiedCases = existing.districtVerifiedCases;
    const verifiedAmount = existing.districtVerifiedAmount;
    if (verifiedCases <= 0 && verifiedAmount <= 0) {
      return NextResponse.json(
        {
          error:
            "Head Office cannot return this finding for correction until the District Controller has first verified the recorded rectification. Please wait for District verification.",
        },
        { status: 409 }
      );
    }
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

  const periodError = assertPeriodWritable(db, existing.periodId);
  if (periodError) return NextResponse.json({ error: periodError }, { status: 409 });

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
