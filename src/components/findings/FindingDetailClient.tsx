"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { useConfirm } from "@/components/ui/ConfirmDialog";
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
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyFile, setReplyFile] = useState<File | null>(null);

  const outstandingCases = finding.caseCount - finding.rectifiedCases;
  const outstandingAmount = finding.amount - finding.rectifiedAmount;
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
      title: "Delete this draft?",
      message: `"${finding.reference}" will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}`, "DELETE");
      router.push("/findings");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete finding");
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/submit`, "POST");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit finding");
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
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record decision");
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
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to verify rectification");
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
      if ((cases > 0) !== (amount > 0)) {
        setError("Enter both a rectified case count and its amount together - one can't be recorded without the other");
        return;
      }
      if (outstandingCases === 1 && (cases !== 1 || amount !== outstandingAmount)) {
        setError(`Only 1 case remains outstanding - rectify exactly 1 case for the full remaining amount (${outstandingAmount})`);
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
      setRectifying(false);
      setRectifyForm({ rectifiedCases: "", rectifiedAmount: "", note: "" });
      setSelectedCaseIds([]);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record rectification");
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
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to close finding");
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
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to return finding for correction");
    } finally {
      setBusy(false);
    }
  }

  async function handleResubmitRectification() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/resubmit-rectification`, "POST");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to resubmit finding");
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer() {
    const period = otherOpenPeriods.find((p) => p.id === transferPeriodId);
    const result = await confirm({
      title: `Transfer to ${period?.code ?? "next period"}?`,
      message: `Moves the outstanding ${finding.currency} ${outstandingAmount.toLocaleString()} (${outstandingCases} case(s)) forward. The finding stays open under this new period.`,
      confirmLabel: "Transfer",
      tone: "danger",
      needsReason: true,
    });
    if (result === false) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/transfer`, "POST", { toPeriodId: transferPeriodId, reason: result });
      setTransferring(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to transfer finding");
    } finally {
      setBusy(false);
    }
  }

  // Shared by finding-level evidence uploads and comment attachments
  // (BR-WF-018) - the only difference is whether commentId is set, which
  // the API route itself uses to decide findings.evidence vs
  // findings.comment as the required permission.
  async function uploadEvidence(file: File, commentId?: string) {
    const formData = new FormData();
    formData.append("file", file);
    if (commentId) formData.append("commentId", commentId);
    const res = await fetch(`/api/findings/${finding.id}/evidence`, { method: "POST", body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body?.error ?? "Upload failed", res.status);
  }

  async function handleEvidenceUpload(file: File) {
    setUploadingEvidence(true);
    setError(null);
    try {
      await uploadEvidence(file);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to upload evidence");
    } finally {
      setUploadingEvidence(false);
    }
  }

  async function postComment(text: string, parentCommentId?: string, file?: File | null) {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { comment } = await apiSend<{ comment: Comment }>(`/api/findings/${finding.id}/comments`, "POST", {
        text,
        parentCommentId,
      });
      if (file) await uploadEvidence(file, comment.id);
      setCommentText("");
      setCommentFile(null);
      setReplyTo(null);
      setReplyText("");
      setReplyFile(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to post comment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{finding.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <span className="font-mono text-xs text-slate-400">{finding.reference}</span> · {lookups.branchName} ·{" "}
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
              fixedDistrict={fixedDistrict}
              fixedBranch={fixedBranch}
              onCancel={() => setEditing(false)}
              onSaved={() => setEditing(false)}
            />
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Source</dt>
              <dd className="text-slate-900">{lookups.sourceName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Department</dt>
              <dd className="text-slate-900">{lookups.departmentName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Classified case</dt>
              <dd className="text-slate-900">{lookups.categoryName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Finding date</dt>
              <dd className="text-slate-900">{finding.findingDate}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Risk level</dt>
              <dd className="text-slate-900">{finding.riskLevel}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Priority</dt>
              <dd className="text-slate-900">{finding.priority}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Operation area</dt>
              <dd className="text-slate-900">{finding.operationArea}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Type of irregularity</dt>
              <dd className="text-slate-900">{finding.irregularityType}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Currency</dt>
              <dd className="text-slate-900">{finding.currency}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Amount involved</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatNumber(finding.amount)} ({finding.caseCount} case
                {finding.caseCount === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Outstanding</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatNumber(outstandingAmount)} ({outstandingCases} case
                {outstandingCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">District Verified</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatNumber(finding.districtVerifiedAmount)} ({finding.districtVerifiedCases} case
                {finding.districtVerifiedCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Closed</dt>
              <dd className="text-slate-900">
                {finding.currency} {formatNumber(finding.closedAmount)} ({finding.closedCases} case
                {finding.closedCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-400">Description</dt>
              <dd className="text-slate-900">{finding.description}</dd>
            </div>
            {finding.rootCause && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400">Root cause</dt>
                <dd className="text-slate-900">{finding.rootCause}</dd>
              </div>
            )}
            {finding.recommendation && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400">Recommendation</dt>
                <dd className="text-slate-900">{finding.recommendation}</dd>
              </div>
            )}
            {finding.evidenceNote && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400">Evidence note</dt>
                <dd className="text-slate-900">{finding.evidenceNote}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      {!editing && (permissions.canEdit || permissions.canDelete || permissions.canSubmit) && (
        <div className="flex flex-wrap gap-2">
          {permissions.canEdit && (
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {permissions.canSubmit && (
            <Button onClick={handleSubmit} disabled={busy}>
              {finding.status === "RETURNED" ? "Resubmit" : "Submit"}
            </Button>
          )}
          {permissions.canDelete && (
            <Button variant="danger" onClick={handleDelete} disabled={busy}>
              Delete
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
            <Button onClick={() => handleReview("district-review", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            {permissions.canDistrictReturnReview && (
              <Button variant="secondary" onClick={() => handleReview("district-review", "RETURN")} disabled={busy}>
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
            <Button onClick={() => handleReview("ho-review", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            {permissions.canHoReturnReview && (
              <Button variant="secondary" onClick={() => handleReview("ho-review", "RETURN")} disabled={busy}>
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
            <Button onClick={() => handleReview("bank-approval", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            {permissions.canBankReturnReview && (
              <Button variant="secondary" onClick={() => handleReview("bank-approval", "RETURN")} disabled={busy}>
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
            description={`Outstanding: ${finding.currency} ${formatNumber(outstandingAmount)} across ${outstandingCases} case(s)`}
          />
          {rectifying ? (
            <div className="flex flex-col gap-3 p-4">
              {isItemized ? (
                <div>
                  <Label>Select outstanding case(s) to rectify</Label>
                  <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-slate-200 p-2">
                    {outstandingFindingCases.length === 0 && (
                      <p className="p-2 text-sm text-slate-400">No cases currently outstanding.</p>
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
                        Case {fc.seq} — {finding.currency} {formatNumber(fc.amount)}
                      </label>
                    ))}
                  </div>
                  {selectedCaseIds.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Selected: {selectedCaseIds.length} case(s) / {finding.currency}{" "}
                      {formatNumber(
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
                  variant="secondary"
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
                return `${verifiableCases} case(s) / ${finding.currency} ${formatNumber(verifiableAmount)} rectified and awaiting your verification, before it can reach Head Office for final closure. Approve it, or send it back to the Branch Manager for correction.`;
              }
              if (permissions.canDistrictReturnRectification) {
                // District: can return even at SENT_TO_BRANCH_MANAGER (zero rectified)
                if (finding.status === "SENT_TO_BRANCH_MANAGER") {
                  return "Approved and sent to the branch, but nothing rectified yet. Send it back now if it needs correction before the branch acts on it.";
                }
                return "Recorded rectification awaiting District review. Approve it via Verify, or send it back to the Branch Manager for correction.";
              }
              if (permissions.canHoReturnRectification) {
                return `${finding.districtVerifiedCases} case(s) / ${finding.currency} ${formatNumber(finding.districtVerifiedAmount)} already District-verified. You can return this finding to the Branch Manager for further correction only after District verification — which this portion has already passed.`;
              }
              return "";
            })()}
          />
          <div className="flex gap-2 p-4">
            {permissions.canVerifyRectification && (
              <Button onClick={handleVerifyRectification} disabled={busy}>
                Verify
              </Button>
            )}
            {permissions.canDistrictReturnRectification && (
              <Button onClick={handleReturnRectification} disabled={busy}>
                Return for Correction (District)
              </Button>
            )}
            {permissions.canHoReturnRectification && (
              <Button onClick={handleReturnRectification} disabled={busy}>
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
            description={`${closableCases} case(s) / ${finding.currency} ${formatNumber(closableAmount)} district-verified and ready to close. ${outstandingCases} case(s) / ${finding.currency} ${formatNumber(outstandingAmount)} still unrectified and will stay open.`}
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
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                        {finding.currency} {formatNumber(finding.amount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Amount</dt>
                      <dd className="font-medium text-amber-700">
                        {finding.currency} {formatNumber(outstandingAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Original Case Count</dt>
                      <dd className="font-medium text-slate-900">{formatNumber(finding.caseCount)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Case Count</dt>
                      <dd className="font-medium text-amber-700">{formatNumber(outstandingCases)}</dd>
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
                  <Button variant="secondary" onClick={() => setTransferring(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="danger" onClick={handleTransfer} disabled={busy || !transferPeriodId}>
                    {busy ? "Transferring..." : "Transfer"}
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="p-4">
              <Button variant="secondary" onClick={() => setTransferring(true)}>
                Transfer to Next Period
              </Button>
            </div>
          )}
        </Card>
      )}

      {(permissions.canUploadEvidence || evidence.some((e) => !e.commentId)) && (
        <Card>
          <CardHeader title="Evidence" description="Optional supporting files (PDF, PNG, JPG, XLSX, DOCX, CSV - up to 10 MB). Comment attachments are shown inline under their comment instead." />
          <div className="flex flex-col gap-2 p-4">
            {permissions.canUploadEvidence && (
              <input
                type="file"
                disabled={uploadingEvidence}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleEvidenceUpload(file);
                }}
                className="text-sm text-slate-600"
              />
            )}
            {uploadingEvidence && <p className="text-xs text-slate-400">Uploading...</p>}
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
                      <p className="text-xs text-slate-400">
                        {formatBytes(e.size)} · {e.uploadedByName} · {formatDateTime(e.createdAt)}
                      </p>
                    </div>
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
                            <a
                              key={e.id}
                              href={`/api/findings/${finding.id}/evidence/${e.id}`}
                              className="mt-1 flex items-center gap-1 text-xs text-blue-700 hover:underline"
                            >
                              📎 {e.fileName} ({formatBytes(e.size)})
                            </a>
                          ))}
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-xs text-slate-400">{formatDateTime(c.createdAt)}</span>
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
                                  <a
                                    key={e.id}
                                    href={`/api/findings/${finding.id}/evidence/${e.id}`}
                                    className="mt-1 flex items-center gap-1 text-xs text-blue-700 hover:underline"
                                  >
                                    📎 {e.fileName} ({formatBytes(e.size)})
                                  </a>
                                ))}
                                <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>
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
                              <Button onClick={() => postComment(replyText, c.id, replyFile)} disabled={busy}>
                                Reply
                              </Button>
                            </div>
                            <input
                              type="file"
                              onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)}
                              className="text-xs text-slate-500"
                            />
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
                  <Button onClick={() => postComment(commentText, undefined, commentFile)} disabled={busy}>
                    Post
                  </Button>
                </div>
                <input
                  type="file"
                  onChange={(e) => setCommentFile(e.target.files?.[0] ?? null)}
                  className="text-xs text-slate-500"
                />
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
                    {formatNumber(fc.amount)}
                    {fc.status === "RECTIFIED" && fc.rectifiedByName && (
                      <span className="text-slate-400">
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
                    <span className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</span>
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
                        {finding.currency} {formatNumber(t.originalAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">Outstanding Amount</dt>
                      <dd className="font-medium text-amber-700">
                        {finding.currency} {formatNumber(t.amountTransferred)}
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
                  case(s) / {finding.currency} {formatNumber(r.rectifiedAmount)}
                  {r.note && <span className="text-slate-400"> — {r.note}</span>}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(r.createdAt)}</span>
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
                  {c.closedCases} case(s) / {finding.currency} {formatNumber(c.closedAmount)}
                </span>
                <span className="text-xs text-slate-400">{formatDateTime(c.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Transition History" />
        <div className="divide-y divide-slate-100">
          {transitions.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="text-slate-600">
                <span className="font-medium text-slate-900">{t.userName}</span> {t.action.replaceAll("_", " ").toLowerCase()}{" "}
                <span className="text-slate-400">
                  ({t.fromStatus.replaceAll("_", " ")} → {t.toStatus.replaceAll("_", " ")})
                </span>
                {t.reason && <span className="text-slate-500"> — {t.reason}</span>}
              </span>
              <span className="text-xs text-slate-400">{formatDateTime(t.createdAt)}</span>
            </div>
          ))}
        </div>
      </Card>
      {dialog}
    </div>
  );
}
