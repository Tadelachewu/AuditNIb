"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import type { Finding, FindingTransition, RectificationEntry } from "@/types";

interface Lookups {
  branchName: string;
  districtName: string;
  sourceName: string;
  categoryName: string;
  periodCode: string;
}

interface Permissions {
  canEdit: boolean;
  canDelete: boolean;
  canSubmit: boolean;
  canDistrictReview: boolean;
  canHoReview: boolean;
  canRectify: boolean;
  canClose: boolean;
}

export function FindingDetailClient({
  finding,
  transitions,
  rectifications,
  lookups,
  permissions,
}: {
  finding: Finding;
  transitions: FindingTransition[];
  rectifications: RectificationEntry[];
  lookups: Lookups;
  permissions: Permissions;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    operationArea: finding.operationArea,
    irregularityType: finding.irregularityType,
    amount: String(finding.amount),
    caseCount: String(finding.caseCount),
    description: finding.description,
    recommendation: finding.recommendation ?? "",
    evidenceNote: finding.evidenceNote ?? "",
  });

  const [rectifying, setRectifying] = useState(false);
  const [rectifyForm, setRectifyForm] = useState({ rectifiedCases: "", rectifiedAmount: "", note: "" });

  const outstandingCases = finding.caseCount - finding.rectifiedCases;
  const outstandingAmount = finding.amount - finding.rectifiedAmount;

  function refresh() {
    router.refresh();
  }

  async function saveEdit() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}`, "PATCH", {
        operationArea: editForm.operationArea,
        irregularityType: editForm.irregularityType,
        amount: Number(editForm.amount),
        caseCount: Number(editForm.caseCount),
        description: editForm.description,
        recommendation: editForm.recommendation || undefined,
        evidenceNote: editForm.evidenceNote || undefined,
      });
      setEditing(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setBusy(false);
    }
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

  async function handleReview(stage: "district-review" | "ho-review", decision: "APPROVE" | "REJECT" | "RETURN") {
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

  async function handleRectify() {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/findings/${finding.id}/rectify`, "POST", {
        rectifiedCases: Number(rectifyForm.rectifiedCases || 0),
        rectifiedAmount: Number(rectifyForm.rectifiedAmount || 0),
        note: rectifyForm.note || undefined,
      });
      setRectifying(false);
      setRectifyForm({ rectifiedCases: "", rectifiedAmount: "", note: "" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record rectification");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    const result = await confirm({
      title: "Close this finding?",
      message: "This verifies the rectification and is terminal - the finding cannot be reopened.",
      confirmLabel: "Close",
      tone: "danger",
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-mono text-lg font-semibold text-slate-900">{finding.reference}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {lookups.branchName} · {lookups.districtName} · {lookups.periodCode}
          </p>
        </div>
        <FindingStatusBadge status={finding.status} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader title="Finding Details" />
        {editing ? (
          <div className="flex flex-col gap-3 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="e-operationArea">Operation area</Label>
                <Input
                  id="e-operationArea"
                  value={editForm.operationArea}
                  onChange={(e) => setEditForm({ ...editForm, operationArea: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-irregularityType">Type of irregularity</Label>
                <Input
                  id="e-irregularityType"
                  value={editForm.irregularityType}
                  onChange={(e) => setEditForm({ ...editForm, irregularityType: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-amount">Amount ({finding.currency})</Label>
                <Input
                  id="e-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editForm.amount}
                  onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-caseCount">Number of cases</Label>
                <Input
                  id="e-caseCount"
                  type="number"
                  min="1"
                  step="1"
                  value={editForm.caseCount}
                  onChange={(e) => setEditForm({ ...editForm, caseCount: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="e-description">Description</Label>
              <Textarea
                id="e-description"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="e-recommendation">Recommendation</Label>
              <Textarea
                id="e-recommendation"
                rows={2}
                value={editForm.recommendation}
                onChange={(e) => setEditForm({ ...editForm, recommendation: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="e-evidenceNote">Evidence note</Label>
              <Input
                id="e-evidenceNote"
                value={editForm.evidenceNote}
                onChange={(e) => setEditForm({ ...editForm, evidenceNote: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={saveEdit} disabled={busy}>
                {busy ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Source</dt>
              <dd className="text-slate-900">{lookups.sourceName}</dd>
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
              <dt className="text-xs text-slate-400">Operation area</dt>
              <dd className="text-slate-900">{finding.operationArea}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Type of irregularity</dt>
              <dd className="text-slate-900">{finding.irregularityType}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Amount</dt>
              <dd className="text-slate-900">
                {finding.currency} {finding.amount.toLocaleString()} ({finding.caseCount} case
                {finding.caseCount === 1 ? "" : "s"})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Outstanding</dt>
              <dd className="text-slate-900">
                {finding.currency} {outstandingAmount.toLocaleString()} ({outstandingCases} case
                {outstandingCases === 1 ? "" : "s"})
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-400">Description</dt>
              <dd className="text-slate-900">{finding.description}</dd>
            </div>
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
          <CardHeader title="District Review" description="Approve, reject, or return this finding to the branch." />
          <div className="flex gap-2 p-4">
            <Button onClick={() => handleReview("district-review", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            <Button variant="secondary" onClick={() => handleReview("district-review", "RETURN")} disabled={busy}>
              Return
            </Button>
            <Button variant="danger" onClick={() => handleReview("district-review", "REJECT")} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {permissions.canHoReview && (
        <Card>
          <CardHeader title="Head Office Review" description="Second approval. Routes to the Branch Manager once approved." />
          <div className="flex gap-2 p-4">
            <Button onClick={() => handleReview("ho-review", "APPROVE")} disabled={busy}>
              Approve
            </Button>
            <Button variant="secondary" onClick={() => handleReview("ho-review", "RETURN")} disabled={busy}>
              Return
            </Button>
            <Button variant="danger" onClick={() => handleReview("ho-review", "REJECT")} disabled={busy}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      {permissions.canRectify && (
        <Card>
          <CardHeader
            title="Record Rectification"
            description={`Outstanding: ${finding.currency} ${outstandingAmount.toLocaleString()} across ${outstandingCases} case(s)`}
          />
          {rectifying ? (
            <div className="flex flex-col gap-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="r-cases">Rectified cases (this entry)</Label>
                  <Input
                    id="r-cases"
                    type="number"
                    min="0"
                    max={outstandingCases}
                    step="1"
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
                    value={rectifyForm.rectifiedAmount}
                    onChange={(e) => setRectifyForm({ ...rectifyForm, rectifiedAmount: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="r-note">Note (optional)</Label>
                <Input id="r-note" value={rectifyForm.note} onChange={(e) => setRectifyForm({ ...rectifyForm, note: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setRectifying(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={handleRectify} disabled={busy}>
                  {busy ? "Saving..." : "Record Rectification"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <Button onClick={() => setRectifying(true)}>Record Rectification</Button>
            </div>
          )}
        </Card>
      )}

      {permissions.canClose && (
        <Card>
          <CardHeader title="Verify & Close" description="Confirms the rectification and closes the finding." />
          <div className="p-4">
            <Button variant="danger" onClick={handleClose} disabled={busy}>
              Close
            </Button>
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
                  case(s) / {finding.currency} {r.rectifiedAmount.toLocaleString()}
                  {r.note && <span className="text-slate-400"> — {r.note}</span>}
                </span>
                <span className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
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
              <span className="text-xs text-slate-400">{new Date(t.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>
      {dialog}
    </div>
  );
}
