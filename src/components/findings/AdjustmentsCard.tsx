"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiSend } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/AddDialog";
import { StickyActions } from "@/components/ui/StickyActions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ADJUSTMENT_STATUS_LABELS, OPEN_ADJUSTMENT_STATUSES as OPEN_STATUSES, type AdjustmentStatus } from "@/lib/adjustments/types";
import type { AdjustmentsView, AdjustmentWithActions } from "@/lib/adjustments/view";
import type { Finding } from "@/types";

/**
 * Revolving findings (docs/revolving-findings.md §5): the finding page's
 * Adjustments card - the "Adjust outstanding" dialog and every adjustment
 * with the actions this user may take. Self-contained: loads its own data
 * from /api/findings/[id]/adjustments and refreshes the page after a change
 * (an approval changes the finding's figures).
 */

type FindingFigures = Pick<
  Finding,
  "id" | "currency" | "caseCount" | "amount" | "registeredCaseCount" | "registeredAmount" | "rectifiedCases" | "rectifiedAmount" | "closedCases" | "closedAmount"
>;

const STATUS_TONE: Record<AdjustmentStatus, "green" | "gray" | "amber" | "red" | "blue"> = {
  DRAFT: "gray",
  DISTRICT_REVIEW: "blue",
  HO_REVIEW: "blue",
  PENDING_BANK_APPROVAL: "blue",
  APPROVED: "green",
  RETURNED: "amber",
  REJECTED: "red",
  WITHDRAWN: "gray",
};

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatCurrency(Math.abs(n))}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function changeSummary(a: { addedCases: number; amountChange: number }, currency: string): string {
  const parts: string[] = [];
  if (a.addedCases > 0) parts.push(`+${plural(a.addedCases, "case")}`);
  if (a.amountChange !== 0) parts.push(`${currency} ${signed(a.amountChange)}`);
  return parts.join(" · ") || "No change";
}

export function AdjustmentsCard({ finding }: { finding: FindingFigures }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<AdjustmentsView | null>(null);
  const [editing, setEditing] = useState<AdjustmentWithActions | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/findings/${finding.id}/adjustments`;

  const load = useCallback(async () => {
    try {
      setView(await apiGet<AdjustmentsView>(base));
    } catch (err) {
      notify.fromError(err, notifications.adjustment.loadFailed);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load, finding.caseCount, finding.amount]);

  async function act(run: () => Promise<unknown>, success: (typeof notifications.adjustment)[keyof typeof notifications.adjustment]) {
    setBusy(true);
    try {
      await run();
      notify.success(success);
      await load();
      router.refresh();
    } catch (err) {
      notify.fromError(err, notifications.adjustment.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(a: AdjustmentWithActions) {
    const ok = await confirm({ title: "Withdraw this adjustment?", message: "It stays in the history as Withdrawn and is never applied.", confirmLabel: "Withdraw", tone: "danger" });
    if (ok === false) return;
    await act(() => apiSend(`${base}/${a.id}`, "PATCH", { action: "withdraw" }), notifications.adjustment.withdrawn);
  }

  async function remove(a: AdjustmentWithActions) {
    const ok = await confirm({
      title: "Delete this adjustment?",
      message: `This ${ADJUSTMENT_STATUS_LABELS[a.status].toLowerCase()} adjustment (${changeSummary(a, finding.currency)}) will be permanently removed. It was never applied, so the finding's figures don't change. The audit log keeps a record.`,
      confirmLabel: "Delete Permanently",
      tone: "danger",
    });
    if (ok === false) return;
    await act(() => apiSend(`${base}/${a.id}`, "DELETE"), notifications.adjustment.deleted);
  }

  async function submit(a: AdjustmentWithActions) {
    await act(() => apiSend(`${base}/${a.id}`, "PATCH", { action: "submit" }), notifications.adjustment.submitted);
  }

  async function review(a: AdjustmentWithActions, decision: "APPROVE" | "RETURN" | "REJECT") {
    const step = ADJUSTMENT_STATUS_LABELS[a.status];
    const result = await confirm(
      decision === "APPROVE"
        ? {
            title: "Approve this adjustment?",
            message: `${step}: ${changeSummary(a, finding.currency)}.${a.status === "DISTRICT_REVIEW" ? " It then goes to HO review." : " It is applied to the finding's outstanding at once."}`,
            confirmLabel: "Approve",
            tone: "success",
          }
        : {
            title: decision === "RETURN" ? "Return for correction?" : "Reject this adjustment?",
            message: decision === "RETURN" ? "The requester can correct and resubmit it." : "It will never be applied. The requester is notified.",
            confirmLabel: decision === "RETURN" ? "Return" : "Reject",
            tone: "danger",
            needsReason: true,
          }
    );
    if (result === false) return;
    const notice = decision === "APPROVE" ? notifications.adjustment.approved : decision === "RETURN" ? notifications.adjustment.returned : notifications.adjustment.rejected;
    await act(() => apiSend(`${base}/${a.id}/review`, "POST", { decision, reason: result || undefined }), notice);
  }

  if (!view) return null;
  // Nothing to show on a finding whose area isn't revolving and never was adjusted.
  if (!view.revolving && view.adjustments.length === 0) return null;

  const original = finding.registeredCaseCount !== finding.caseCount || finding.registeredAmount !== finding.amount;
  // Shown in the header, so the collapsed card still says what's going on.
  const actionable = view.adjustments.filter((a) => a.can.review || a.can.submit).length;
  const open = view.adjustments.filter((a) => OPEN_STATUSES.includes(a.status)).length;
  const summary = [
    original ? `Current ${plural(finding.caseCount, "case")} · ${finding.currency} ${formatCurrency(finding.amount)} (originally ${finding.registeredCaseCount} · ${formatCurrency(finding.registeredAmount)})` : null,
    open > 0 ? `${open} in progress` : null,
    actionable > 0 ? `${actionable} awaiting you` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <CollapsibleCard
        title={`Adjustments (${view.adjustments.length})`}
        description={summary || "Revolving finding: add cases or increase / decrease the outstanding, each approved like a registration."}
      >
      <div className="flex flex-col gap-3 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs text-slate-500">
            Added cases and amount changes, each approved like a registration. The original registration never changes.
          </p>
          {view.canStart && (
            <Button variant="info" onClick={() => setEditing("new")} disabled={busy}>
              Adjust outstanding
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-500">Originally registered</dt>
            <dd className="text-slate-900">
              {finding.currency} {formatCurrency(finding.registeredAmount)} ({plural(finding.registeredCaseCount, "case")})
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Current (original + approved adjustments)</dt>
            <dd className={original ? "font-semibold text-slate-900" : "text-slate-900"}>
              {finding.currency} {formatCurrency(finding.amount)} ({plural(finding.caseCount, "case")})
            </dd>
          </div>
        </dl>

        {view.adjustments.length === 0 ? (
          <p className="text-slate-500">No adjustments yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.adjustments.map((a) => (
              <li key={a.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS_TONE[a.status]}>{ADJUSTMENT_STATUS_LABELS[a.status]}</Badge>
                    <span className="font-medium text-slate-900">{changeSummary(a, finding.currency)}</span>
                    {a.applied && (
                      <span className="text-xs text-slate-500">
                        {plural(a.applied.before.caseCount, "case")} / {formatCurrency(a.applied.before.amount)} → {plural(a.applied.after.caseCount, "case")} /{" "}
                        {formatCurrency(a.applied.after.amount)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.can.edit && (
                      <Button variant="neutral" onClick={() => setEditing(a)} disabled={busy}>
                        Edit
                      </Button>
                    )}
                    {a.can.submit && (
                      <Button variant="info" onClick={() => submit(a)} disabled={busy || Boolean(view.submitProblem)} title={view.submitProblem ?? undefined}>
                        {a.status === "RETURNED" ? "Resubmit" : "Submit"}
                      </Button>
                    )}
                    {a.can.withdraw && (
                      <Button variant="cancel" onClick={() => withdraw(a)} disabled={busy}>
                        Withdraw
                      </Button>
                    )}
                    {a.can.delete && (
                      <Button variant="danger" onClick={() => remove(a)} disabled={busy}>
                        Delete
                      </Button>
                    )}
                    {a.can.review && (
                      <>
                        <Button variant="success" onClick={() => review(a, "APPROVE")} disabled={busy}>
                          Approve
                        </Button>
                        <Button variant="warning" onClick={() => review(a, "RETURN")} disabled={busy}>
                          Return
                        </Button>
                        <Button variant="danger" onClick={() => review(a, "REJECT")} disabled={busy}>
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-slate-700">{a.reason}</p>
                {(a.newCaseAmounts.length > 0 || a.caseAmountChanges.length > 0) && (
                  <p className="mt-1 text-xs text-slate-500">
                    {a.newCaseAmounts.length > 0 && `New case amounts: ${a.newCaseAmounts.map(formatCurrency).join(", ")}. `}
                    {a.caseAmountChanges.length > 0 &&
                      `Changed: ${a.caseAmountChanges.map((c) => `case ${c.seq} ${c.to > c.from ? "+" : "-"}${formatCurrency(Math.abs(c.to - c.from))} (${formatCurrency(c.from)} → ${formatCurrency(c.to)})`).join(", ")}.`}
                  </p>
                )}
                <ol className="mt-2 flex flex-col gap-0.5 text-xs text-slate-500">
                  <li>Requested by {a.requestedByName} · {formatDateTime(a.createdAt)}</li>
                  {a.decisions.map((d, i) => (
                    <li key={i}>
                      {d.decision.charAt(0) + d.decision.slice(1).toLowerCase()} by {d.byName} · {formatDateTime(d.at)}
                      {d.reason ? ` - ${d.reason}` : ""}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </div>
      </CollapsibleCard>

      {editing && (
        <AdjustDialog
          finding={finding}
          view={view}
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (submitted) => {
            setEditing(null);
            notify.success(submitted ? notifications.adjustment.submitted : editing === "new" ? notifications.adjustment.draftSaved : notifications.adjustment.updated);
            await load();
            router.refresh();
          }}
        />
      )}
      {dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// The Adjust outstanding dialog (new or edit)

function AdjustDialog({
  finding,
  view,
  existing,
  onClose,
  onSaved,
}: {
  finding: FindingFigures;
  view: AdjustmentsView;
  existing: AdjustmentWithActions | null;
  onClose: () => void;
  onSaved: (submitted: boolean) => Promise<void>;
}) {
  const outstandingRows = view.cases.filter((c) => c.status === "OUTSTANDING");
  const [addedCases, setAddedCases] = useState(existing ? String(existing.addedCases) : "");
  const [amountChange, setAmountChange] = useState(existing && !view.itemized ? String(existing.amountChange) : "");
  const [newAmounts, setNewAmounts] = useState<string[]>(existing ? existing.newCaseAmounts.map(String) : []);
  // Itemized: the +/- change of each outstanding case (never a typed-over amount).
  const [caseChanges, setCaseChanges] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const c of outstandingRows) {
      const prior = existing?.caseAmountChanges.find((x) => x.caseId === c.id);
      initial[c.id] = prior ? String(Math.round((prior.to - prior.from) * 100) / 100) : "";
    }
    return initial;
  });
  const caseDelta = (id: string) => Number(caseChanges[id]) || 0;
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const added = Math.max(0, Math.floor(Number(addedCases) || 0));
  // Keep one amount field per added case (itemized findings).
  useEffect(() => {
    if (!view.itemized) return;
    setNewAmounts((prev) => (prev.length === added ? prev : Array.from({ length: added }, (_, i) => prev[i] ?? "")));
  }, [added, view.itemized]);

  const change = useMemo(() => {
    if (!view.itemized) return Number(amountChange) || 0;
    const fromNew = newAmounts.reduce((s, v) => s + (Number(v) || 0), 0);
    const fromChanged = outstandingRows.reduce((s, c) => s + caseDelta(c.id), 0);
    return Math.round((fromNew + fromChanged) * 100) / 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.itemized, amountChange, newAmounts, outstandingRows, caseChanges]);

  const resultCases = finding.caseCount + added;
  const resultAmount = Math.round((finding.amount + change) * 100) / 100;

  function body(submit: boolean) {
    const payload: Record<string, unknown> = { addedCases: added, reason: reason.trim(), submit };
    if (view.itemized) {
      payload.newCaseAmounts = newAmounts.map((v) => Number(v));
      // Sent as the resulting amount; the server records from -> to and re-checks it.
      payload.caseAmountChanges = outstandingRows
        .filter((c) => caseDelta(c.id) !== 0)
        .map((c) => ({ caseId: c.id, to: Math.round((c.amount + caseDelta(c.id)) * 100) / 100 }));
    } else {
      payload.amountChange = Number(amountChange) || 0;
    }
    return payload;
  }

  async function save(submit: boolean) {
    setError(null);
    // Each added case needs a value - 0 is fine, blank is not (it would silently count as 0).
    if (view.itemized && newAmounts.some((v) => v.trim() === "")) {
      setError("Enter an amount for each added case (0 is allowed)");
      return;
    }
    setSaving(true);
    try {
      const url = `/api/findings/${finding.id}/adjustments`;
      if (existing) await apiSend(`${url}/${existing.id}`, "PATCH", { action: "edit", ...body(submit) });
      else await apiSend(url, "POST", body(submit));
      await onSaved(submit);
    } catch (err) {
      setError(err instanceof Error ? err.message : notifications.adjustment.saveFailed.message);
    } finally {
      setSaving(false);
    }
  }

  // An adjustment already in review is edited in place (no separate submit).
  const inReview = existing && existing.status !== "DRAFT" && existing.status !== "RETURNED";

  return (
    <Modal
      title={existing ? "Edit adjustment" : "Adjust outstanding"}
      description={
        view.itemized
          ? "Add cases (each with its amount) and/or increase or decrease outstanding cases. Rectified cases never change."
          : "Add cases and/or increase or decrease the amount. Cases can only be added; the amount can't go below what's already rectified."
      }
      size="xl"
      onClose={onClose}
    >
      <form
        className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save(!inReview);
        }}
      >
        <div className="rounded-md bg-slate-50 p-3 text-sm sm:col-span-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <span className="text-xs text-slate-500">Current</span>
              <div className="text-slate-900">
                {plural(finding.caseCount, "case")} · {finding.currency} {formatCurrency(finding.amount)}
              </div>
              <div className="text-xs text-slate-500">
                Rectified {plural(finding.rectifiedCases, "case")} / {formatCurrency(finding.rectifiedAmount)} · closed {plural(finding.closedCases, "case")} /{" "}
                {formatCurrency(finding.closedAmount)}
              </div>
            </div>
            <div>
              <span className="text-xs text-slate-500">After this adjustment</span>
              <div className="font-semibold text-slate-900">
                {plural(resultCases, "case")} · {finding.currency} {formatCurrency(resultAmount)}
              </div>
              <div className="text-xs text-slate-500">Change: {changeSummary({ addedCases: added, amountChange: change }, finding.currency)}</div>
            </div>
          </div>
        </div>

        <div>
          <Label htmlFor="adj-cases">Cases to add</Label>
          <Input id="adj-cases" type="number" min={0} step={1} inputMode="numeric" placeholder="0" value={addedCases} onChange={(e) => setAddedCases(e.target.value)} />
        </div>
        {!view.itemized && (
          <div>
            <Label htmlFor="adj-amount">Amount change ({finding.currency}, + increase / - decrease)</Label>
            <Input id="adj-amount" type="number" step="0.01" placeholder="0.00" value={amountChange} onChange={(e) => setAmountChange(e.target.value)} />
          </div>
        )}

        {view.itemized && added > 0 && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">Amount of each added case ({finding.currency}, 0 or more)</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {newAmounts.map((v, i) => (
                <div key={i}>
                  <Label htmlFor={`adj-new-${i}`}>New case {view.cases.length + i + 1}</Label>
                  <Input
                    id={`adj-new-${i}`}
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={v}
                    onChange={(e) => setNewAmounts((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        )}

        {view.itemized && outstandingRows.length > 0 && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-slate-700">
              Change an outstanding case ({finding.currency}, e.g. 1000 to increase, -1000 to decrease) - leave blank if unchanged
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {outstandingRows.map((c) => {
                const delta = caseDelta(c.id);
                const after = Math.round((c.amount + delta) * 100) / 100;
                return (
                  <div key={c.id}>
                    <Label htmlFor={`adj-case-${c.id}`}>
                      Case {c.seq} (now {formatCurrency(c.amount)})
                    </Label>
                    <Input
                      id={`adj-case-${c.id}`}
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={caseChanges[c.id] ?? ""}
                      onChange={(e) => setCaseChanges((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                    {delta !== 0 && (
                      <p className={`mt-0.5 text-xs ${after > 0 ? "text-slate-500" : "text-red-600"}`}>
                        {formatCurrency(c.amount)} {delta > 0 ? "+" : "-"} {formatCurrency(Math.abs(delta))} = {formatCurrency(after)}
                        {after > 0 ? "" : " - must stay above 0"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="sm:col-span-2">
          <Label htmlFor="adj-reason">Reason (required)</Label>
          <Textarea id="adj-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the outstanding changed (e.g. 2 more dormant accounts found in October)" />
          <p className="mt-1 text-xs text-slate-500">Supporting files go in the finding&apos;s Evidence card (optional).</p>
        </div>

        <div className="sm:col-span-2">
          <StickyActions error={error} hint={!inReview && view.submitProblem ? view.submitProblem : undefined} hintTone="warning">
            <Button type="button" variant="cancel" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {inReview ? (
              <Button type="submit" variant="info" disabled={saving}>
                Save changes
              </Button>
            ) : (
              <>
                <Button type="button" variant="neutral" onClick={() => save(false)} disabled={saving}>
                  Save draft
                </Button>
                <Button type="submit" variant="info" disabled={saving || Boolean(view.submitProblem)}>
                  Submit
                </Button>
              </>
            )}
          </StickyActions>
        </div>
      </form>
    </Modal>
  );
}
