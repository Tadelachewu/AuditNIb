import { redirect } from "next/navigation";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { canReopen } from "@/lib/findingReopen";
import { getCurrentUser } from "@/lib/session";
import { readDb } from "@/lib/db";
import { assertFindingInScope } from "@/lib/findings-scope";
import { caseAgeDays, userPerformedApprovalOrVerifyAction, hasRectificationAfterLastTransfer } from "@/lib/findings";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";
import { Card } from "@/components/ui/Card";
import { FindingDetailClient } from "@/components/findings/FindingDetailClient";

export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  if (!hasPermission(user.permissions, permissionKey("findings", "view"))) redirect("/dashboard");

  const { id } = await params;
  const db = await readDb();
  const finding = db.findings.find((f) => f.id === id);

  if (!finding) {
    return (
      <Card className="mx-auto max-w-lg p-4">
        <p className="text-sm text-slate-600">Finding not found.</p>
      </Card>
    );
  }

  const scopeError = assertFindingInScope(user, finding);
  if (scopeError) {
    return (
      <Card className="mx-auto max-w-lg p-4">
        <p className="text-sm text-red-600">{scopeError}</p>
      </Card>
    );
  }

  const transitions = db.findingTransitions
    .filter((t) => t.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rectifications = db.rectifications
    .filter((r) => r.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const transfers = db.findingTransfers
    .filter((t) => t.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const closures = db.findingClosures
    .filter((c) => c.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const findingCases = db.findingCases.filter((c) => c.findingId === id).sort((a, b) => a.seq - b.seq);
  const evidence = db.evidence
    .filter((e) => e.findingId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const comments = db.comments
    .filter((c) => c.findingId === id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const branch = db.branches.find((b) => b.id === finding.branchId);
  const district = db.districts.find((d) => d.id === finding.districtId);
  const source = db.sources.find((s) => s.id === finding.sourceId);
  const department = db.departments.find((d) => d.id === finding.departmentId);
  const category = db.categories.find((c) => c.id === finding.categoryId);
  const period = db.reportingPeriods.find((p) => p.id === finding.periodId);

  const otherOpenPeriods = db.reportingPeriods
    // Forward only (same rule as the transfer API).
    .filter((p) => p.status === "OPEN" && p.id !== finding.periodId && (!period || p.startsAt > period.startsAt))
    .map((p) => ({ id: p.id, code: p.code }));

  const has = (action: string) => hasPermission(user.permissions, permissionKey("findings", action));

  // Every non-terminal status is transferable - only CLOSED is excluded.
  // Kept in lockstep by hand with transfer/route.ts and
  // findings.ts's AUTO_TRANSFERABLE_STATUSES (see the latter's own doc
  // comment for the full reasoning).
  const TRANSFERABLE_STATUSES = ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "RECTIFIED", "RECTIFICATION_RETURNED", "TRANSFERRED"];
  // Deliberately excludes SENT_TO_BRANCH_MANAGER - see
  // return-rectification/route.ts's own doc comment: "return for
  // correction" only makes sense once there's a recorded rectification to
  // react to. A mistake in the finding's own earlier approval belongs to
  // District/HO Review's own Return instead, which only works while still
  // at that review stage.
  const RETURNABLE_STATUSES = ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"];

  // Split return-for-correction permissions into the District-scoped and
  // HO-scoped variants, matching the exact same gating logic enforced
  // server-side in return-rectification/route.ts:
  //
  //   * findings.return-rectification          (legacy/unrestricted) → treated as District variant
  //   * findings.district-return-rectification  (new, District only) → unrestricted, any RETURNABLE_STATUSES
  //   * findings.ho-return-rectification        (new, HO only)       → GATED: requires district verification first
  //
  // The HO gate (districtVerifiedCases > 0 || districtVerifiedAmount > 0)
  // enforces District's first-level gate before HO acts - HO steps in only
  // after District has already engaged with the recorded rectification.
  const hasReturnLegacy = has("return-rectification");
  const hasReturnDistrict = has("district-return-rectification");
  const hasReturnHo = has("ho-return-rectification");
  // Two more gates on top of the permission/status checks, mirroring
  // return-rectification/route.ts's own doc comment exactly - both apply
  // regardless of which permission variant is being used:
  //   1. Separation of duties, scoped to *this* rectification - the same
  //      person who already verified or closed it can't also return it.
  //      Return stays available before that happens even for someone who
  //      approved the finding itself at District/HO Review - that's a
  //      different, earlier decision (see userPerformedApprovalOrVerifyAction()).
  //   2. Post-transfer - a TRANSFERRED finding can't be returned until the
  //      branch has recorded new rectification after that transfer.
  const returnBlockedBySelfCheck = userPerformedApprovalOrVerifyAction(db, finding.id, user.userId!);
  const returnBlockedByPostTransfer = finding.status === "TRANSFERRED" && !hasRectificationAfterLastTransfer(db, finding);
  const returnGatesPass = !returnBlockedBySelfCheck && !returnBlockedByPostTransfer;
  // Finding.registeredByBankScope plays no role here - District's standing
  // to verify/return a recorded rectification is the same routine
  // oversight job regardless of how the original finding was approved, and
  // (per RETURNABLE_STATUSES above) there's no earlier "nothing rectified
  // yet" stage left for a bank-scope distinction to matter at.
  const canDistrictReturnRectification =
    (hasReturnLegacy || hasReturnDistrict) && RETURNABLE_STATUSES.includes(finding.status) && returnGatesPass;
  // HO-scoped return applies only when user holds ho-return-rectification
  // WITHOUT also holding the legacy or district variant (those would already
  // be covered by canDistrictReturnRectification above and don't need a gate).
  const hasReturnHoOnly = hasReturnHo && !hasReturnLegacy && !hasReturnDistrict;
  const districtHasVerified =
    finding.districtVerifiedCases > 0 || finding.districtVerifiedAmount > 0;
  const canHoReturnRectification =
    hasReturnHoOnly && RETURNABLE_STATUSES.includes(finding.status) && districtHasVerified && returnGatesPass;
  // Backward-compatible combined boolean. The UI also reads the two new
  // scoped booleans above separately for button labeling / tooltips.
  const canReturnRectification = canDistrictReturnRectification || canHoReturnRectification;

  return (
    <FindingDetailClient
      finding={finding}
      transitions={transitions}
      rectifications={rectifications}
      transfers={transfers}
      closures={closures}
      findingCases={findingCases}
      evidence={evidence}
      comments={comments}
      otherOpenPeriods={otherOpenPeriods}
      caseAgeDays={caseAgeDays(finding)}
      operationAreas={db.settings.operationAreas}
      priorityLevels={db.settings.priorityLevels}
      irregularityTypes={db.settings.irregularityTypes}
      requiredFields={db.settings.requiredFindingFields}
      allowOther={db.settings.allowOtherValueFields}
      editSources={db.sources.filter((s) => s.active || s.id === finding.sourceId)}
      editDepartments={db.departments.filter((d) => d.active || d.id === finding.departmentId)}
      editCategories={db.categories.filter((c) => c.active || c.id === finding.categoryId)}
      // Same OPEN-or-drafts-allowed-while-locked set as the Register
      // Finding form (see findings/new/page.tsx) - otherwise a DRAFT
      // finding already sitting in a locked-but-draftable period wouldn't
      // even show its own current period in this dropdown.
      editPeriods={db.reportingPeriods.filter((p) => p.status === "OPEN" || p.draftsAllowedWhileLocked)}
      editDistricts={db.districts.filter((d) => d.status === "ACTIVE")}
      editBranches={db.branches.filter((b) => b.status === "ACTIVE")}
      editCurrencies={db.settings.currencies}
      editRiskLevels={db.settings.riskLevels}
      fixedDistrict={user.orgScope === "BRANCH" && district ? { id: district.id, name: district.name } : undefined}
      fixedBranch={user.orgScope === "BRANCH" && branch ? { id: branch.id, name: branch.name } : undefined}
      lookups={{
        branchName: branch?.name ?? "Unknown branch",
        districtName: district?.name ?? "Unknown district",
        sourceName: source?.name ?? "Unknown source",
        departmentName: department?.name ?? "Unknown department",
        // finding.categoryId itself holds a typed-in "Other" value when it
        // doesn't match a real ClassifiedCategory - display that directly
        // rather than "Unknown category" (see OTHER_VALUE_ALLOWED_FIELDS's
        // categoryId doc comment in types/index.ts).
        categoryName: category?.name ?? (finding.categoryId || "Unknown category"),
        periodCode: period?.code ?? "Unknown period",
        // Used by the Transfer to Next Period card's pre-transfer summary
        // and by Transfer History rows to decode fromPeriodId/toPeriodId
        // into display codes (§15 Transfer Data of the workflow spec),
        // instead of showing opaque UUIDs. reportingPeriods[] is tiny so
        // sending the full map is cheaper than joining on every row.
        periodLookup: new Map(
          db.reportingPeriods.map((p) => [p.id, { code: p.code, year: p.year, month: p.month }])
        ),
      }}
      permissions={{
        // Ownership-restricted: edit/delete/submit are the pre-submission
        // authoring trio, only ever meaningful for the person who actually
        // registered this finding - enforced server-side too (see
        // [id]/route.ts PATCH/DELETE and submit/route.ts). Review/rectify/
        // verify/close stay unrestricted by design - those are legitimately
        // different-actor actions.
        canEdit: has("edit") && finding.createdBy === user.userId && ["DRAFT", "RETURNED"].includes(finding.status),
        canDelete: has("delete") && finding.createdBy === user.userId && finding.status === "DRAFT",
        // Deliberately no ownership check, unlike canDelete above - see
        // the registry's own doc comment on "delete-rejected": this is a
        // reviewer housekeeping action on a terminal outcome, not the
        // registrant cleaning up their own work.
        canDeleteRejected: has("delete-rejected") && finding.status === "REJECTED",
        // Closed / partially closed -> back to a fresh Sent to Branch Manager
        // (history kept) - src/lib/findingReopen.ts.
        canReopen: has("reopen") && canReopen(finding),
        canSubmit: has("submit") && finding.createdBy === user.userId && ["DRAFT", "RETURNED"].includes(finding.status),
        canDistrictReview: has("district-review") && finding.status === "DISTRICT_REVIEW",
        // At each review stage (District/HO/Bank), the "Return" option is
        // hidden when the reviewer is also the finding's creator — a
        // meaningless self-return loop that is also blocked server-side in
        // the three routes. Approve and Reject remain visible in all
        // cases (only the self-return is nonsensical).
        canDistrictReturnReview:
          has("district-review") && finding.status === "DISTRICT_REVIEW" && finding.createdBy !== user.userId,
        canHoReview: has("ho-review") && finding.status === "HO_REVIEW",
        canHoReturnReview:
          has("ho-review") && finding.status === "HO_REVIEW" && finding.createdBy !== user.userId,
        // Status membership alone isn't enough: TRANSFERRED and
        // RECTIFICATION_RETURNED both allow a finding that's already fully
        // self-reported rectified (rectifiedCases/Amount == caseCount/
        // amount) to sit in a "rectifiable" status - TRANSFERRED because a
        // RECTIFIED-but-not-yet-CLOSED finding can still be swept forward
        // by the Transfer Engine, RECTIFICATION_RETURNED because a return
        // never resets the rectified totals it's returning. Without this
        // extra check, the Record Rectification card stays open with
        // nothing left to actually rectify - every entry gets rejected by
        // rectify/route.ts's own bounds check ("cannot exceed the
        // outstanding 0"), a guaranteed-fail dead end rather than a real
        // choice.
        canRectify:
          has("rectify") &&
          ["SENT_TO_BRANCH_MANAGER", "PARTIALLY_RECTIFIED", "TRANSFERRED", "RECTIFICATION_RETURNED"].includes(finding.status) &&
          (finding.rectifiedCases < finding.caseCount || finding.rectifiedAmount < finding.amount),
        // Closeable whenever there's a district-verified-but-not-yet-closed
        // portion waiting, regardless of overall status - see
        // close/route.ts. Bounded by districtVerifiedCases/Amount, not just
        // rectifiedCases/Amount: a rectification must clear District's
        // verify-rectification gate first (the "before it reaches HO"
        // requirement). Excludes RECTIFICATION_RETURNED - a pending return
        // blocks closing until resubmitted.
        // NOTE: HO Controller holds findings.close by default, so HO can
        // already partially-close a PARTIALLY_RECTIFIED finding as long as
        // District has verified the portion — exactly the "HO can close
        // portion of partially rectified" requirement.
        canClose:
          has("close") &&
          finding.status !== "CLOSED" &&
          finding.status !== "RECTIFICATION_RETURNED" &&
          (Math.min(finding.rectifiedCases, finding.districtVerifiedCases) > finding.closedCases ||
            Math.min(finding.rectifiedAmount, finding.districtVerifiedAmount) > finding.closedAmount),
        canTransfer: has("transfer") && TRANSFERABLE_STATUSES.includes(finding.status),
        // District's gate on a recorded rectification, before HO (or
        // anyone) can close it - approve (verify) whatever's currently
        // rectified-but-unverified, or return it for correction instead.
        canVerifyRectification:
          has("verify-rectification") &&
          ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"].includes(finding.status) &&
          (finding.rectifiedCases > finding.districtVerifiedCases || finding.rectifiedAmount > finding.districtVerifiedAmount),
        // Split return-for-correction matrix. See computation above.
        canReturnRectification,
        canDistrictReturnRectification,
        canHoReturnRectification,
        canResubmitRectification: has("rectify") && finding.status === "RECTIFICATION_RETURNED",
        // Settings.hoApproval's single approval step for a bank-registered
        // finding - both gates required, matching bank-approval/route.ts's
        // own server-side check: the permission (an eligible role) and the
        // specific assigned approver (Settings.hoApproval.approverUserIds).
        // Purely a UI convenience showing/hiding these buttons - the real
        // enforcement is server-side in that route regardless of what
        // renders here.
        canBankApprove:
          has("bank-approval") &&
          finding.status === "PENDING_BANK_APPROVAL" &&
          db.settings.hoApproval.approverUserIds.includes(user.userId!),
        canBankReturnReview:
          has("bank-approval") &&
          finding.status === "PENDING_BANK_APPROVAL" &&
          db.settings.hoApproval.approverUserIds.includes(user.userId!) &&
          finding.createdBy !== user.userId,
        canUploadEvidence: has("evidence"),
        canComment: has("comment"),
        // Remove anyone's file; without it a user can still remove their own
        // upload while the finding isn't closed (see the evidence DELETE route).
        canDeleteAnyEvidence: has("delete-evidence"),
        currentUserId: user.userId!,
      }}
    />
  );
}
