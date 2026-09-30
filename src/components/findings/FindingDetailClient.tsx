"use client";

import { notify, notifications } from "@/lib/notify";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSend, errorMessage, apiUpload } from "@/lib/api-client";
import { formatDate, formatDateTime, formatNumber, formatCurrency } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, FileInput, FIELD_FOCUS } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Trash2 } from "lucide-react";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { NewFindingForm } from "@/components/findings/NewFindingForm";
import type {
  Finding,
  FindingTransition,
  RectificationEntry,
  FindingTransfer,
  FindingClosure,
  FindingCase,
  Evidence,
  Comment,
  Source,
  Department,
  ClassifiedCategory,
  ReportingPeriod,
  District,
  Branch,
  RequirableFindingField,
  OtherValueAllowedField,
} from "@/types";

interface Lookups {
  branchName: string;
  districtName: string;
  sourceName: string;
  departmentName: string;
  categoryName: string;
  periodCode: string;
  periodLookup: Map<string, { code: string; year: number; month: number }>;
}

interface Permissions {
  canEdit: boolean;
  canDelete: boolean;
  canDeleteRejected: boolean;
  canReopen: boolean;
  canSubmit: boolean;
  canDistrictReview: boolean;
  canDistrictReturnReview: boolean;
  canHoReview: boolean;
  canHoReturnReview: boolean;
  canRectify: boolean;
  canVerifyRectification: boolean;
  canClose: boolean;
  canTransfer: boolean;
  canReturnRectification: boolean;
  canDistrictReturnRectification: boolean;
  canHoReturnRectification: boolean;
  canResubmitRectification: boolean;
  canBankApprove: boolean;
  canBankReturnReview: boolean;
  canUploadEvidence: boolean;
  canComment: boolean;
  canDeleteAnyEvidence: boolean;
  currentUserId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FindingDetailClient({
  finding,
  transitions,
  rectifications,
  transfers,
  closures,
  findingCases,
  evidence,
  comments,
  otherOpenPeriods,
  caseAgeDays,
  operationAreas,
  priorityLevels,
  irregularityTypes,
  requiredFields,
  allowOther,
  editSources,
  editDepartments,
  editCategories,
  editPeriods,
  editDistricts,
  editBranches,
  editCurrencies,
  editRiskLevels,
  fixedDistrict,
  fixedBranch,
  lookups,
  permissions,
}: {
  finding: Finding;
  transitions: FindingTransition[];
  rectifications: RectificationEntry[];
  transfers: FindingTransfer[];
  closures: FindingClosure[];
  findingCases: FindingCase[];
  evidence: Evidence[];
  comments: Comment[];
  otherOpenPeriods: { id: string; code: string }[];
  caseAgeDays: number;
  operationAreas: string[];
  priorityLevels: string[];
  irregularityTypes: string[];
  requiredFields: Record<RequirableFindingField, boolean>;
  allowOther: Record<OtherValueAllowedField, boolean>;
  // All for the inline edit form (NewFindingForm in edit mode) - same
  // reference data the registration form itself uses.
  editSources: Source[];
  editDepartments: Department[];
  editCategories: ClassifiedCategory[];
  editPeriods: ReportingPeriod[];
  editDistricts: District[];
  editBranches: Branch[];
  editCurrencies: string[];
  editRiskLevels: string[];
  fixedDistrict?: { id: string; name: string };
  fixedBranch?: { id: string; name: string };
  lookups: Lookups;
  permissions: Permissions;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);

  const [rectifying, setRectifying] = useState(false);
  const [rectifyForm, setRectifyForm] = useState({ rectifiedCases: "", rectifiedAmount: "", note: "" });
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const outstandingFindingCases = findingCases.filter((fc) => fc.status === "OUTSTANDING");
  const isItemized = findingCases.length > 0;

  const [transferring, setTransferring] = useState(false);
  const [transferPeriodId, setTransferPeriodId] = useState(otherOpenPeriods[0]?.id ?? "");

  const [uploadingEvidence, setUploadingEvidence] = useState(false);

  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const outstandingCases = finding.caseCount - finding.rectifiedCases;
  const outstandingAmount = finding.amount - finding.rectifiedAmount;
  // Distinct from outstandingCases/Amount just above (which is "how much
  // is left for the branch to still rectify," used by the Record
  // Rectification/Verify & Close forms) - a transfer carries forward
  // everything not yet formally CLOSED, including a case that's already
  // been rectified (and even District-verified) but HO hasn't closed yet.
  // Must match transferFinding()'s own calculation in src/lib/findings.ts
  // exactly, since this is only ever a preview of what that function is
  // about to record.
  const transferOutstandingCases = finding.caseCount - finding.closedCases;
  const transferOutstandingAmount = finding.amount - finding.closedAmount;
  // A single remaining case is atomic (see rectify/route.ts's own doc
  // comment) - the non-itemized form locks to exactly 1 case / the full
  // remaining amount instead of leaving those fields freely editable, so
  // there's no way to type a mismatched value the server would reject
  // anyway.
  const singleCaseRemaining = !isItemized && outstandingCases === 1;
  // Bounded by what's actually district-verified, not just rectified -
  // mirrors close/route.ts's own calculation (District must verify a
  // rectification before it's closable at all).
  const closableCases = Math.min(finding.rectifiedCases, finding.districtVerifiedCases) - finding.closedCases;
  const closableAmount = Math.min(finding.rectifiedAmount, finding.districtVerifiedAmount) - finding.closedAmount;
  const verifiableCases = finding.rectifiedCases - finding.districtVerifiedCases;
  const verifiableAmount = finding.rectifiedAmount - finding.districtVerifiedAmount;

  function refresh() {
    router.refresh();
  }

  async function handleDelete() {
    const result = await confirm({
      title: finding.status === "REJECTED" ? "Delete this rejected finding?" : "Delete this draft?",
      message: `"${finding.reference}" will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}`, "DELETE");
      notify.success(notifications.finding.deleted);
      router.push("/findings");
    } catch (err) {
      setError(errorMessage(err, "Failed to delete finding"));
      setBusy(false);
    }
  }

  async function handleReopen() {
    const reason = await confirm({
      title: "Reopen this finding?",
      message: `"${finding.reference}" goes back to Sent to Branch Manager as if nothing had been rectified: its rectified, verified and closed cases and amounts are reset to zero and the branch must rectify it again. The full history and audit trail are kept.`,
      confirmLabel: "Reopen Finding",
      tone: "danger",
      needsReason: true,
    });
    if (reason === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/reopen`, "POST", { reason });
      notify.success(notifications.finding.reopened);
      await refresh();
    } catch (err) {
      notify.fromError(err, notifications.finding.reopenFailed);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/submit`, "POST");
      notify.success(notifications.finding.submitted);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to submit finding"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(
    stage: "district-review" | "ho-review" | "bank-approval",
    decision: "APPROVE" | "REJECT" | "RETURN"
  ) {
    let reason: string | undefined;
    if (decision !== "APPROVE") {
      const result = await confirm({
        title: decision === "REJECT" ? "Reject this finding?" : "Return this finding to the branch?",
        message:
          decision === "REJECT"
            ? "This is terminal - the finding cannot be resubmitted once rejected."
            : "The branch will be able to edit and resubmit it.",
        confirmLabel: decision === "REJECT" ? "Reject" : "Return",
        tone: "danger",
        needsReason: true,
      });
      if (result === false) return;
      reason = result;
    } else {
      const result = await confirm({
        title: "Approve this finding?",
        message:
          stage === "district-review"
            ? "It moves to Head Office review next."
            : "It moves to the Branch Manager for corrective action next.",
        confirmLabel: "Approve",
      });
      if (result === false) return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/${stage}`, "POST", { decision, reason });
      notify.success(decision === "APPROVE" ? notifications.finding.approved : decision === "REJECT" ? notifications.finding.rejected : notifications.finding.returned);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to record decision"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyRectification() {
    const result = await confirm({
      title: "Verify this rectification?",
      message: `Approves ${verifiableCases} case(s) / ${finding.currency} ${verifiableAmount.toLocaleString()} of the recorded rectification as correct, making it closable.`,
      confirmLabel: "Verify",
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/verify-rectification`, "POST");
      notify.success(notifications.finding.verified);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to verify rectification"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRectify() {
    setError(null);
    // Mirrors rectify/route.ts's own validation (see its doc comment) so a
    // mismatched entry is caught immediately instead of round-tripping to
    // the server first - that route is still the authoritative check.
    if (!isItemized) {
      const cases = Number(rectifyForm.rectifiedCases || 0);
      const amount = Number(rectifyForm.rectifiedAmount || 0);
      // A rectified amount with no case count doesn't represent a real
      // rectification. The reverse is valid: a case can genuinely rectify
      // to zero monetary impact (e.g. a documentation error rather than an
      // actual shortage), so cases > 0 with amount === 0 is allowed - a
      // zero-amount finding must still be rectifiable case by case.
      if (amount > 0 && cases === 0) {
        setError("A rectified amount must have at least one rectified case attached to it");
        return;
      }
      // Whenever this entry exhausts one dimension entirely (every
      // remaining case, or every remaining birr), it must exhaust the
      // other one too - see rectify/route.ts's own doc comment for why.
      if (cases === outstandingCases && amount !== outstandingAmount) {
        setError(
          `This rectifies every remaining case (${outstandingCases}) - the amount must be the full remaining balance (${outstandingAmount}), not a partial amount`
        );
        return;
      }
      // Guarded by outstandingAmount > 0 - see rectify/route.ts's own doc
      // comment: on a zero-amount finding this would otherwise fire on
      // every partial entry purely because there was never any money to
      // begin with, forcing every remaining case to be finished at once.
      if (outstandingAmount > 0 && amount === outstandingAmount && cases !== outstandingCases) {
        setError(
          `This rectifies the full remaining amount (${outstandingAmount}) - the case count must be the full remaining ${outstandingCases} case(s), not a partial count`
        );
        return;
      }
    }
    setBusy(true);
    try {
      await apiSend(
        `/api/findings/${finding.id}/rectify`,
        "POST",
        isItemized
          ? { caseIds: selectedCaseIds, note: rectifyForm.note || undefined }
          : {
            rectifiedCases: Number(rectifyForm.rectifiedCases || 0),
            rectifiedAmount: Number(rectifyForm.rectifiedAmount || 0),
            note: rectifyForm.note || undefined,
          }
      );
      notify.success(notifications.finding.rectified);
      setRectifying(false);
      setRectifyForm({ rectifiedCases: "", rectifiedAmount: "", note: "" });
      setSelectedCaseIds([]);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to record rectification"));
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    const willFullyClose =
      finding.closedCases + closableCases >= finding.caseCount && finding.closedAmount + closableAmount >= finding.amount;
    const result = await confirm({
      title: willFullyClose ? "Close this finding?" : "Close the rectified portion?",
      message: willFullyClose
        ? "This verifies the rectification and is terminal - the finding cannot be reopened."
        : `This verifies and closes ${closableCases} case(s) / ${finding.currency} ${closableAmount.toLocaleString()} that's been rectified so far. The remaining ${outstandingCases} case(s) / ${finding.currency} ${outstandingAmount.toLocaleString()} stays open until it's rectified and closed too.`,
      confirmLabel: "Accept",
      tone: "success",
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/close`, "POST");
      notify.success(willFullyClose ? notifications.finding.closed : notifications.finding.partiallyClosed);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to close finding"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReturnRectification() {
    const result = await confirm({
      title: "Return for correction?",
      message:
        "Sends this back to the Branch Manager for correction. They'll need to address the issue and resubmit before it can be rectified further, closed, or transferred.",
      confirmLabel: "Return for Correction",
      needsReason: true,
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/return-rectification`, "POST", { reason: result });
      notify.success(notifications.finding.rectificationReturned);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to return finding for correction"));
    } finally {
      setBusy(false);
    }
  }

  async function handleResubmitRectification() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/resubmit-rectification`, "POST");
      notify.success(notifications.finding.rectificationResubmitted);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to resubmit finding"));
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer() {
    const period = otherOpenPeriods.find((p) => p.id === transferPeriodId);
    const result = await confirm({
      title: `Transfer to ${period?.code ?? "next period"}?`,
      message: `Moves the outstanding ${finding.currency} ${transferOutstandingAmount.toLocaleString()} (${transferOutstandingCases} case(s)) forward. The finding stays open under this new period.`,
      confirmLabel: "Transfer",
      tone: "danger",
      needsReason: true,
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/transfer`, "POST", { toPeriodId: transferPeriodId, reason: result });
      notify.success(notifications.finding.transferred);
      setTransferring(false);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to transfer finding"));
    } finally {
      setBusy(false);
    }
  }

  // Finding-level evidence upload. (Comments are text only - comment
  // attachments are no longer accepted; older ones still show under their
  // comment and can be downloaded/removed.)
  async function uploadEvidence(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    await apiUpload(`/api/findings/${finding.id}/evidence`, formData);
    notify.success(notifications.finding.evidenceUploaded);
  }

  // Mirrors the DELETE route's rule (the real check is server-side):
  // anyone's file with Delete Any Evidence, otherwise only your own upload
  // while the finding isn't closed.
  function canRemoveFile(e: Evidence): boolean {
    if (permissions.canDeleteAnyEvidence) return true;
    const canUploadHere = e.commentId ? permissions.canComment : permissions.canUploadEvidence;
    return e.uploadedBy === permissions.currentUserId && canUploadHere && finding.status !== "CLOSED";
  }

  async function removeFile(e: Evidence) {
    const result = await confirm({
      title: "Remove this file?",
      message: `"${e.fileName}" will be permanently removed from this finding and from storage. This is recorded in the audit log.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/evidence/${e.id}`, "DELETE");
      notify.success(notifications.finding.evidenceRemoved);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to remove the file"));
    } finally {
      setBusy(false);
    }
  }

  function removeFileButton(file: Evidence) {
    if (!canRemoveFile(file)) return null;
    return (
      <button
        type="button"
        onClick={() => void removeFile(file)}
        disabled={busy}
        title={`Remove ${file.fileName}`}
        aria-label={`Remove ${file.fileName}`}
        className="inline-flex items-center rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  async function handleEvidenceUpload(file: File) {
    setUploadingEvidence(true);
    setError(null);
    try {
      await uploadEvidence(file);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to upload evidence"));
    } finally {
      setUploadingEvidence(false);
    }
  }

  // Comments are text only - files go in the Evidence section instead.
  async function postComment(text: string, parentCommentId?: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend<{ comment: Comment }>(`/api/findings/${finding.id}/comments`, "POST", {
        text,
        parentCommentId,
      });
      setCommentText("");
      setReplyTo(null);
      setReplyText("");
      notify.success(notifications.finding.commentPosted);
      await refresh();
    } catch (err) {
      setError(errorMessage(err, "Failed to post comment"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link
            href="/findings"
            className="inline-flex items-center rounded-md bg-brand-gold px-3 py-1.5 text-sm font-bold text-on-gold transition-colors hover:bg-brand-gold-dark"
          >
            ← Back
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{finding.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-mono text-xs text-slate-500">{finding.reference}</span> · {lookups.branchName} ·{" "}
            {lookups.districtName} · {lookups.periodCode}
          </p>
        </div>
        <FindingStatusBadge status={finding.status} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader title="Finding Details" />
        {editing ? (
          <div className="p-4">
            <NewFindingForm
              finding={finding}
              sources={editSources}
              departments={editDepartments}
              categories={editCategories}
              periods={editPeriods}
              districts={editDistricts}
              branches={editBranches}
              currencies={editCurrencies}
              riskLevels={editRiskLevels}
              operationAreas={operationAreas}
              priorityLevels={priorityLevels}
              irregularityTypes={irregularityTypes}
              requiredFields={requiredFields}
              allowOther={allowOther}
              fixedDistrict={fixedDistrict}
              fixedBranch={fixedBranch}
              onCancel={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Source</dt>
              <dd className="text-slate-900">{lookups.sourceName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Department</dt>
              <dd className="text-slate-900">{lookups.departmentName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Classified case</dt>
              <dd className="text-slate-900">{lookups.categoryName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Finding date</dt>
              <dd className="text-slate-900">{finding.findingDate}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Case age</dt>
              <dd className="text-slate-900">
                {caseAgeDays} day{caseAgeDays === 1 ? "" : "s"}
              </dd>
            </div>
            {/* Imported findings only: the source system's own id for it
                (Excel import's "External Reference" column). */}
            {(finding.importBatchId || finding.externalReference) && (
              <div>
                <dt className="text-xs text-slate-500">External reference</dt>
                <dd className={finding.externalReference ? "font-mono text-slate-900" : "italic text-slate-500"}>
                  {finding.externalReference || "Not provided"}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-500">Risk level</dt>
              <dd className="text-slate-900">{finding.riskLevel}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Priority</dt>
              <dd className="text-slate-900">{finding.priority}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Operation area</dt>
              <dd className="text-slate-900">{finding.operationArea}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Type of irregularity</dt>
              <dd className="text-slate-900">{finding.irregularityType}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Currency</dt>
              <dd className="text-slate-900">{finding.currency}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Amount involved</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatCurrency(finding.amount)} ({finding.caseCount} case
                {finding.caseCount === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Outstanding</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatCurrency(outstandingAmount)} ({outstandingCases} case
                {outstandingCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">District Verified</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatCurrency(finding.districtVerifiedAmount)} ({finding.districtVerifiedCases} case
                {finding.districtVerifiedCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Closed</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatCurrency(finding.closedAmount)} ({finding.closedCases} case
                {finding.closedCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Description</dt>
              <dd className="text-slate-900">{finding.description}</dd>
            </div>
            {/* Always shown (optional fields) - "Not provided" rather than
                a missing row, so a blank field reads as blank, not as lost. */}
            {(
              [
                ["Root cause", finding.rootCause],
                ["Recommendation", finding.recommendation],
                ["Evidence note", finding.evidenceNote],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="sm:col-span-2">
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className={value ? "whitespace-pre-wrap text-slate-900" : "italic text-slate-500"}>{value || "Not provided"}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      {!editing && (permissions.canEdit || permissions.canDelete || permissions.canDeleteRejected || permissions.canSubmit || permissions.canReopen) && (
        <div className="flex flex-wrap gap-2">
          {permissions.canEdit && (
            <Button variant="neutral" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {permissions.canSubmit && (
            <Button variant="info" onClick={handleSubmit} disabled={busy}>
              {finding.status === "RETURNED" ? "Resubmit" : "Submit"}
            </Button>
          )}
          {(permissions.canDelete || permissions.canDeleteRejected) && (
            <Button variant="danger" onClick={handleDelete} disabled={busy}>
              Delete
            </Button>
          )}
          {permissions.canReopen && (
            <Button variant="warning" onClick={handleReopen} disabled={busy} title="Reset to Sent to Branch Manager - history is kept">
              Reopen
            </Button>
          )}
        </div>
      )}

      {permissions.canDistrictReview && (
        <Card>
          <CardHeader
            title="District Review"
            description={
              permissions.canDistrictReturnReview
                ? "Approve, reject, or return this finding to the branch."
                : "Approve or reject this finding. (Return is not available because you registered this finding.)"
            }
          />
          <div className="flex gap-2 p-4">
            <Button variant="success" onClick={() => handleReview("district-review", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            {permissions.canDistrictReturnReview && (
              <Button variant="warning" onClick={() => handleReview("district-review", "RETURN")} disabled={busy}>
                Return
              </Button>
            )}
            <Button variant="danger" onClick={() => handleReview("district-review", "REJECT")} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {permissions.canHoReview && (
        <Card>
          <CardHeader
            title="Head Office Review"
            description={
              permissions.canHoReturnReview
                ? "Second approval. Routes to the Branch Manager once approved."
                : "Second approval. (Return is not available because you registered this finding — use Reject instead if needed.)"
            }
          />
          <div className="flex gap-2 p-4">
            <Button variant="success" onClick={() => handleReview("ho-review", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            {permissions.canHoReturnReview && (
              <Button variant="warning" onClick={() => handleReview("ho-review", "RETURN")} disabled={busy}>
                Return
              </Button>
            )}
            <Button variant="danger" onClick={() => handleReview("ho-review", "REJECT")} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {permissions.canBankApprove && (
        <Card>
          <CardHeader
            title="Approval"
            description={
              permissions.canBankReturnReview
                ? "Bank-registered finding awaiting your approval before it's sent to the branch."
                : "Bank-registered finding awaiting your approval. (Return is not available because you registered this finding — use Approve to send it forward or Reject to stop it.)"
            }
          />
          <div className="flex gap-2 p-4">
            <Button variant="success" onClick={() => handleReview("bank-approval", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            {permissions.canBankReturnReview && (
              <Button variant="warning" onClick={() => handleReview("bank-approval", "RETURN")} disabled={busy}>
                Return
              </Button>
            )}
            <Button variant="danger" onClick={() => handleReview("bank-approval", "REJECT")} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {permissions.canRectify && (
        <Card>
          <CardHeader
            title="Record Rectification"
            description={`Outstanding: ${finding.currency} ${formatCurrency(outstandingAmount)} across ${outstandingCases} case(s)`}
          />
          {rectifying ? (
            <div className="flex flex-col gap-3 p-4">
              {isItemized ? (
                <div>
                  <Label>Select outstanding case(s) to rectify</Label>
                  <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-slate-200 p-2">
                    {outstandingFindingCases.length === 0 && (
                      <p className="p-2 text-sm text-slate-500">No cases currently outstanding.</p>
                    )}
                    {outstandingFindingCases.map((fc) => (
                      <label key={fc.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selectedCaseIds.includes(fc.id)}
                          onChange={(e) =>
                            setSelectedCaseIds((prev) =>
                              e.target.checked ? [...prev, fc.id] : prev.filter((id) => id !== fc.id)
                            )
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        Case {fc.seq} — {finding.currency} {formatCurrency(fc.amount)}
                      </label>
                    ))}
                  </div>
                  {selectedCaseIds.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Selected: {selectedCaseIds.length} case(s) / {finding.currency}{" "}
                      {formatCurrency(
                        outstandingFindingCases
                          .filter((fc) => selectedCaseIds.includes(fc.id))
                          .reduce((sum, fc) => sum + fc.amount, 0)
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {singleCaseRemaining && (
                    <p className="text-xs text-slate-500">
                      Only 1 case remains outstanding - it must be rectified in full, so these are locked to that.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="r-cases">Rectified cases (this entry)</Label>
                      <Input
                        id="r-cases"
                        type="number"
                        min="0"
                        max={outstandingCases}
                        step="1"
                        disabled={singleCaseRemaining}
                        value={rectifyForm.rectifiedCases}
                        onChange={(e) => setRectifyForm({ ...rectifyForm, rectifiedCases: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="r-amount">Rectified amount (this entry)</Label>
                      <Input
                        id="r-amount"
                        type="number"
                        min="0"
                        max={outstandingAmount}
                        step="0.01"
                        disabled={singleCaseRemaining}
                        value={rectifyForm.rectifiedAmount}
                        onChange={(e) => setRectifyForm({ ...rectifyForm, rectifiedAmount: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="r-note">Note (optional)</Label>
                <Input id="r-note" value={rectifyForm.note} onChange={(e) => setRectifyForm({ ...rectifyForm, note: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="cancel"
                  onClick={() => {
                    setRectifying(false);
                    setSelectedCaseIds([]);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button onClick={handleRectify} disabled={busy || (isItemized && selectedCaseIds.length === 0)}>
                  {busy ? "Saving..." : "Record Rectification"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <Button
                onClick={() => {
                  if (singleCaseRemaining) {
                    setRectifyForm((f) => ({ ...f, rectifiedCases: "1", rectifiedAmount: String(outstandingAmount) }));
                  }
                  setRectifying(true);
                }}
              >
                Record Rectification
              </Button>
            </div>
          )}
        </Card>
      )}

      {(permissions.canVerifyRectification || permissions.canReturnRectification) && (
        <Card>
          <CardHeader
            title="Verify Rectification"
            description={(() => {
              if (permissions.canVerifyRectification) {
                return `${verifiableCases} case(s) / ${finding.currency} ${formatCurrency(verifiableAmount)} rectified and awaiting your verification, before it can reach Head Office for final closure. Approve it, or send it back to the Branch Manager for correction.`;
              }
              // Neither canVerifyRectification nor canDistrictReturnRectification/
              // canHoReturnRectification can ever hold before a real
              // rectification exists (RETURNABLE_STATUSES in
              // (app)/findings/[id]/page.tsx excludes SENT_TO_BRANCH_MANAGER) -
              // this card doesn't render at all until the Branch Manager has
              // recorded something to react to.
              if (permissions.canDistrictReturnRectification) {
                return "Recorded rectification awaiting District review. Approve it via Verify, or send it back to the Branch Manager for correction.";
              }
              if (permissions.canHoReturnRectification) {
                return `${finding.districtVerifiedCases} case(s) / ${finding.currency} ${formatCurrency(finding.districtVerifiedAmount)} already District-verified. You can return this finding to the Branch Manager for further correction only after District verification — which this portion has already passed.`;
              }
              return "";
            })()}
          />
          <div className="flex gap-2 p-4">
            {permissions.canVerifyRectification && (
              <Button variant="info" onClick={handleVerifyRectification} disabled={busy}>
                Verify
              </Button>
            )}
            {permissions.canDistrictReturnRectification && (
              <Button variant="warning" onClick={handleReturnRectification} disabled={busy}>
                Return for Correction (District)
              </Button>
            )}
            {permissions.canHoReturnRectification && (
              <Button variant="warning" onClick={handleReturnRectification} disabled={busy}>
                Return for Correction (HO)
              </Button>
            )}
          </div>
        </Card>
      )}

      {permissions.canClose && (
        <Card>
          <CardHeader
            title="Verify & Close"
            description={`${closableCases} case(s) / ${finding.currency} ${formatCurrency(closableAmount)} district-verified and ready to close. ${outstandingCases} case(s) / ${finding.currency} ${formatCurrency(outstandingAmount)} still unrectified and will stay open.`}
          />
          <div className="flex gap-2 p-4">
            <Button variant="success" onClick={handleClose} disabled={busy}>
              Accept
            </Button>
          </div>
        </Card>
      )}

      {permissions.canResubmitRectification && (
        <Card>
          <CardHeader
            title="Sent Back for Correction"
            description={
              transitions.find((t) => t.action === "RETURN_RECTIFICATION")?.reason ??
              "A controller returned this finding - address the issue and resubmit."
            }
          />
          <div className="p-4">
            <Button onClick={handleResubmitRectification} disabled={busy}>
              {busy ? "Resubmitting..." : "Resubmit for Verification"}
            </Button>
          </div>
        </Card>
      )}

      {permissions.canTransfer && (
        <Card>
          <CardHeader
            title="Transfer to Next Period"
            description={`Case age: ${caseAgeDays} day${caseAgeDays === 1 ? "" : "s"} since original finding date.`}
          />
          {transferring ? (
            otherOpenPeriods.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No other open reporting period is available to transfer into.</p>
            ) : (
              <div className="flex flex-col gap-3 p-4">
                <div>
                  <Label htmlFor="t-period">Destination period</Label>
                  <select
                    id="t-period"
                    className={`w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ${FIELD_FOCUS}`}
                    value={transferPeriodId}
                    onChange={(e) => setTransferPeriodId(e.target.value)}
                  >
                    {otherOpenPeriods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code}
                      </option>
                    ))}
                  </select>
                </div>

                {/* §15 Transfer Data — pre-transfer preview of every field
                    that will be persisted in the FindingTransfer row, so the
                    Controller can verify all 15 data points before clicking
                    Transfer. Outstanding = total - closed (what's actually
                    being moved forward), not just rectified. */}
                <div className="rounded-md border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    15. Transfer Data — Preview
                  </div>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 p-3 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Finding ID</dt>
                      <dd className="font-mono text-xs text-slate-900">{finding.id}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Previous Reporting Month</dt>
                      <dd className="font-medium text-slate-900">{lookups.periodCode}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">New Reporting Month</dt>
                      <dd className="font-medium text-slate-900">
                        {otherOpenPeriods.find((p) => p.id === transferPeriodId)?.code ?? "--"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Amount</dt>
                      <dd className="font-medium text-slate-900">
                        {finding.currency} {formatCurrency(finding.amount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Amount</dt>
                      <dd className="font-medium text-amber-700">
                        {finding.currency} {formatCurrency(transferOutstandingAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Case Count</dt>
                      <dd className="font-medium text-slate-900">{formatNumber(finding.caseCount)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Case Count</dt>
                      <dd className="font-medium text-amber-700">{formatNumber(transferOutstandingCases)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Transfer Date</dt>
                      <dd className="font-medium text-slate-900">{new Date().toISOString().slice(0, 10)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Transferred By</dt>
                      <dd className="font-medium text-slate-900">You (current user)</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Case Age (days)</dt>
                      <dd className="font-medium text-slate-900">{caseAgeDays}</dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:col-span-2">
                      <dt className="text-slate-500">Transfer History (prior hops)</dt>
                      <dd className="font-medium text-slate-900">
                        {transfers.length === 0 ? "None — first transfer." : `${transfers.length} prior transfer(s).`}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:col-span-2">
                      <dt className="text-slate-500">Transfer Reason</dt>
                      <dd className="text-slate-700">Entered at confirmation step (required).</dd>
                    </div>
                  </dl>
                </div>

                <div className="flex gap-2">
                  <Button variant="cancel" onClick={() => setTransferring(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="info" onClick={handleTransfer} disabled={busy || !transferPeriodId}>
                    {busy ? "Transferring..." : "Transfer"}
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="p-4">
              <Button variant="info" onClick={() => setTransferring(true)}>
                Transfer to Next Period
              </Button>
            </div>
          )}
        </Card>
      )}

      {(permissions.canUploadEvidence || evidence.some((e) => !e.commentId)) && (
        <Card>
          <CardHeader title="Evidence" description="Optional supporting files (PDF, PNG, JPG, XLSX, DOCX, CSV - up to 10 MB). This is the one place to attach files - comments are text only." />
          <div className="flex flex-col gap-2 p-4">
            {permissions.canUploadEvidence && (
              <FileInput
                disabled={uploadingEvidence}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleEvidenceUpload(file);
                }}
              />
            )}
            {uploadingEvidence && <p className="text-xs text-slate-500">Uploading...</p>}
            {evidence.filter((e) => !e.commentId).length === 0 ? (
              <p className="text-sm text-slate-500">No evidence uploaded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {evidence.filter((e) => !e.commentId).map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <a
                        href={`/api/findings/${finding.id}/evidence/${e.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {e.fileName}
                      </a>
                      <p className="text-xs text-slate-500">
                        {formatBytes(e.size)} · {e.uploadedByName} · {formatDateTime(e.createdAt)}
                      </p>
                    </div>
                    {removeFileButton(e)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {(permissions.canComment || comments.length > 0) && (
        <Card>
          <CardHeader title="Comments" description="Attachments on a comment are optional (BR-WF-018)." />
          <div className="flex flex-col gap-3 p-4">
            {comments.length === 0 ? (
              <p className="text-sm text-slate-500">No comments yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {comments
                  .filter((c) => !c.parentCommentId)
                  .map((c) => {
                    const commentEvidence = evidence.filter((e) => e.commentId === c.id);
                    return (
                      <div key={c.id} className="flex flex-col gap-2">
                        <div className="rounded-md bg-slate-50 p-2 text-sm">
                          <p className="text-slate-700">
                            <span className="font-medium text-slate-900">{c.authorName}</span> {c.text}
                          </p>
                          {commentEvidence.map((e) => (
                            <div key={e.id} className="mt-1 flex items-center gap-1">
                              <a
                                href={`/api/findings/${finding.id}/evidence/${e.id}`}
                                className="flex items-center gap-1 text-xs text-blue-700 hover:underline"
                              >
                                📎 {e.fileName} ({formatBytes(e.size)})
                              </a>
                              {removeFileButton(e)}
                            </div>
                          ))}
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-xs text-slate-500">{formatDateTime(c.createdAt)}</span>
                            {permissions.canComment && (
                              <button
                                type="button"
                                className="text-xs text-blue-700 hover:underline"
                                onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}
                              >
                                Reply
                              </button>
                            )}
                          </div>
                        </div>
                        {comments
                          .filter((r) => r.parentCommentId === c.id)
                          .map((r) => {
                            const replyEvidence = evidence.filter((e) => e.commentId === r.id);
                            return (
                              <div key={r.id} className="ml-6 rounded-md bg-slate-50 p-2 text-sm">
                                <p className="text-slate-700">
                                  <span className="font-medium text-slate-900">{r.authorName}</span> {r.text}
                                </p>
                                {replyEvidence.map((e) => (
                                  <div key={e.id} className="mt-1 flex items-center gap-1">
                                    <a
                                      href={`/api/findings/${finding.id}/evidence/${e.id}`}
                                      className="flex items-center gap-1 text-xs text-blue-700 hover:underline"
                                    >
                                      📎 {e.fileName} ({formatBytes(e.size)})
                                    </a>
                                    {removeFileButton(e)}
                                  </div>
                                ))}
                                <span className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
                              </div>
                            );
                          })}
                        {replyTo === c.id && (
                          <div className="ml-6 flex flex-col gap-1.5">
                            <div className="flex gap-2">
                              <Input
                                value={replyText}
                                onChange={(e) => setReplyText(e.target.value)}
                                placeholder="Write a reply..."
                              />
                              <Button onClick={() => postComment(replyText, c.id)} disabled={busy}>
                                Reply
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
            {permissions.canComment && (
              <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3">
                <div className="flex gap-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add a comment..."
                  />
                  <Button onClick={() => postComment(commentText)} disabled={busy}>
                    Post
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {isItemized && (
        <Card>
          <CardHeader title="Cases" description="Individually tracked cases within this finding (Document_3 §12)" />
          <div className="divide-y divide-slate-100">
            {findingCases
              .slice()
              .sort((a, b) => a.seq - b.seq)
              .map((fc) => (
                <div key={fc.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-slate-600">
                    <span className="font-medium text-slate-900">Case {fc.seq}</span> — {finding.currency}{" "}
                    {formatCurrency(fc.amount)}
                    {fc.status === "RECTIFIED" && fc.rectifiedByName && (
                      <span className="text-slate-500">
                        {" "}
                        — rectified by {fc.rectifiedByName}
                        {fc.rectifiedAt && ` on ${formatDate(fc.rectifiedAt)}`}
                      </span>
                    )}
                  </span>
                  <Badge tone={fc.status === "RECTIFIED" ? "green" : "amber"}>{fc.status === "RECTIFIED" ? "Rectified" : "Outstanding"}</Badge>
                </div>
              ))}
          </div>
        </Card>
      )}

      {transfers.length > 0 && (
        <Card>
          <CardHeader
            title={`Transfer History (${transfers.length} hop${transfers.length === 1 ? "" : "s"})`}
            description="Full §15 Transfer Data record per transfer hop (Original/Outstanding, From/To Period, Transfer Date, By, Reason, Case Age)."
          />
          <div className="flex flex-col gap-3 divide-y divide-slate-100 p-4">
            {transfers.map((t) => {
              const fromPeriod = lookups.periodLookup.get(t.fromPeriodId);
              const toPeriod = lookups.periodLookup.get(t.toPeriodId);
              return (
                <div key={t.id} className="flex flex-col gap-2 pt-3 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={t.method === "AUTOMATIC" ? "blue" : "gray"}>
                        {t.method === "AUTOMATIC" ? "Auto Transfer" : "Manual Transfer"}
                      </Badge>
                      <span className="text-slate-500">
                        Period:{" "}
                        <span className="font-medium text-slate-800">{fromPeriod?.code ?? t.fromPeriodId}</span>{" "}
                        <span aria-hidden>→</span>{" "}
                        <span className="font-medium text-slate-900">{toPeriod?.code ?? t.toPeriodId}</span>
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</span>
                  </div>

                  {/* §15 Transfer Data — 12 field rows, 2-column layout on wide screens. */}
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md bg-slate-50 p-3 text-xs sm:grid-cols-2 sm:text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Finding ID</dt>
                      <dd className="font-mono text-slate-800">{t.findingId}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Case Age at Transfer</dt>
                      <dd className="font-medium text-slate-800">
                        {t.caseAgeAtTransferDays} day{t.caseAgeAtTransferDays === 1 ? "" : "s"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Previous Reporting Month</dt>
                      <dd className="font-medium text-slate-800">{fromPeriod?.code ?? t.fromPeriodId}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">New Reporting Month</dt>
                      <dd className="font-medium text-slate-800">{toPeriod?.code ?? t.toPeriodId}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Amount</dt>
                      <dd className="font-medium text-slate-800">
                        {finding.currency} {formatCurrency(t.originalAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Amount</dt>
                      <dd className="font-medium text-amber-700">
                        {finding.currency} {formatCurrency(t.amountTransferred)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Case Count</dt>
                      <dd className="font-medium text-slate-800">{formatNumber(t.originalCaseCount)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Case Count</dt>
                      <dd className="font-medium text-amber-700">{formatNumber(t.casesTransferred)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Transfer Date</dt>
                      <dd className="font-medium text-slate-800">{t.createdAt.slice(0, 10)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Transferred By</dt>
                      <dd className="font-medium text-slate-800">{t.createdByName}</dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:col-span-2">
                      <dt className="text-slate-500">Transfer Reason</dt>
                      <dd className="text-slate-800">{t.reason}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {rectifications.length > 0 && (
        <Card>
          <CardHeader title="Rectification Ledger" />
          <div className="divide-y divide-slate-100">
            {rectifications.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-900">{r.submittedByName}</span> recorded {r.rectifiedCases}{" "}
                  case(s) / {finding.currency} {formatCurrency(r.rectifiedAmount)}
                  {r.note && <span className="text-slate-500"> — {r.note}</span>}
                </span>
                <span className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {closures.length > 0 && (
        <Card>
          <CardHeader title="Closure Ledger" />
          <div className="divide-y divide-slate-100">
            {closures.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">
                  <span className="font-medium text-slate-900">{c.submittedByName}</span> verified and closed{" "}
                  {c.closedCases} case(s) / {finding.currency} {formatCurrency(c.closedAmount)}
                </span>
                <span className="text-xs text-slate-500">{formatDateTime(c.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Transition History" />
        <div className="divide-y divide-slate-100">
          {transitions.map((t) => {
            // Return/reject events (sent back for correction, or rejected
            // outright) get their reason behind a "View Reason" button
            // instead of shown inline - these are exactly the events
            // someone reviewing this finding's history most needs to
            // actually read (why was this bounced back?), so they're
            // called out rather than blending into the same gray inline
            // text every other transition's reason uses. Colored to match
            // FindingStatusBadge's own severity convention (amber for a
            // recoverable return, red for the one truly terminal REJECTED).
            const isReturnEvent = ["RETURNED", "REJECTED", "RECTIFICATION_RETURNED"].includes(t.toStatus);
            const header = (
              <span className="text-slate-600">
                <span className="font-medium text-slate-900">{t.userName}</span> {t.action.replaceAll("_", " ").toLowerCase()}{" "}
                <span className="text-slate-500">
                  ({t.fromStatus.replaceAll("_", " ")} → {t.toStatus.replaceAll("_", " ")})
                </span>
                {t.reason && !isReturnEvent && <span className="text-slate-500"> — {t.reason}</span>}
              </span>
            );
            if (isReturnEvent && t.reason) {
              const buttonTone = t.toStatus === "REJECTED" ? "bg-[#b91c1c] hover:bg-[#991b1b]" : "bg-[#d97706] hover:bg-[#b45309]";
              return (
                <details key={t.id} className="group px-4 py-2 text-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:content-none">
                    {header}
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-md px-2.5 py-1 text-xs font-bold text-on-dark transition-colors ${buttonTone}`}>
                        View Reason
                      </span>
                      <span className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</span>
                    </span>
                  </summary>
                  <p className="mt-1.5 border-t border-slate-100 pt-1.5 text-sm text-slate-600">{t.reason}</p>
                </details>
              );
            }
            return (
              <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                {header}
                <span className="text-xs text-slate-500">{formatDateTime(t.createdAt)}</span>
              </div>
            );
          })}
        </div>
      </Card>
      {dialog}
    </div>
  );
}
