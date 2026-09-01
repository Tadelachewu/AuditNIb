"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { FindingStatus } from "@/types";

export interface FindingRow {
  id: string;
  reference: string;
  title: string;
  branchName: string;
  departmentName: string;
  categoryName: string;
  sourceName: string;
  riskLevel: string;
  currency: string;
  amount: number;
  status: FindingStatus;
  updatedAt: string;
  rectifiedCases: number;
  rectifiedAmount: number;
  districtVerifiedCases: number;
  districtVerifiedAmount: number;
  closedCases: number;
  closedAmount: number;
}

export interface BulkPermissions {
  canDistrictReview: boolean;
  canHoReview: boolean;
  canBankApprove: boolean;
  canVerifyRectification: boolean;
  canReturnRectification: boolean;
  canClose: boolean;
}

type BulkActionKind = "approve" | "reject" | "return-review" | "verify" | "return-rectification" | "close";

const REVIEW_STATUSES: FindingStatus[] = ["DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL"];
const RECTIFICATION_STATUSES: FindingStatus[] = ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"];

function reviewStageFor(status: FindingStatus): "district-review" | "ho-review" | "bank-approval" | null {
  if (status === "DISTRICT_REVIEW") return "district-review";
  if (status === "HO_REVIEW") return "ho-review";
  if (status === "PENDING_BANK_APPROVAL") return "bank-approval";
  return null;
}

function canReview(status: FindingStatus, perms: BulkPermissions): boolean {
  if (status === "DISTRICT_REVIEW") return perms.canDistrictReview;
  if (status === "HO_REVIEW") return perms.canHoReview;
  if (status === "PENDING_BANK_APPROVAL") return perms.canBankApprove;
  return false;
}

function isVerifiable(f: FindingRow): boolean {
  return RECTIFICATION_STATUSES.includes(f.status) && (f.rectifiedCases > f.districtVerifiedCases || f.rectifiedAmount > f.districtVerifiedAmount);
}

function isClosable(f: FindingRow): boolean {
  return Math.min(f.rectifiedCases, f.districtVerifiedCases) > f.closedCases || Math.min(f.rectifiedAmount, f.districtVerifiedAmount) > f.closedAmount;
}

function eligibleFor(kind: BulkActionKind, rows: FindingRow[], perms: BulkPermissions): FindingRow[] {
  switch (kind) {
    case "approve":
    case "reject":
    case "return-review":
      return rows.filter((f) => REVIEW_STATUSES.includes(f.status) && canReview(f.status, perms));
    case "verify":
      return rows.filter((f) => perms.canVerifyRectification && isVerifiable(f));
    case "return-rectification":
      return rows.filter((f) => perms.canReturnRectification && RECTIFICATION_STATUSES.includes(f.status));
    case "close":
      return rows.filter((f) => perms.canClose && isClosable(f));
  }
}

function requestFor(kind: BulkActionKind, f: FindingRow, reason: string): { url: string; body?: unknown } {
  if (kind === "approve" || kind === "reject" || kind === "return-review") {
    const stage = reviewStageFor(f.status)!;
    const decision = kind === "approve" ? "APPROVE" : kind === "reject" ? "REJECT" : "RETURN";
    return { url: `/api/findings/${f.id}/${stage}`, body: { decision, reason: decision === "APPROVE" ? undefined : reason } };
  }
  if (kind === "verify") return { url: `/api/findings/${f.id}/verify-rectification` };
  if (kind === "return-rectification") return { url: `/api/findings/${f.id}/return-rectification`, body: { reason } };
  return { url: `/api/findings/${f.id}/close` };
}

const ACTION_LABELS: Record<BulkActionKind, string> = {
  approve: "Approve",
  reject: "Reject",
  "return-review": "Return",
  verify: "Verify",
  "return-rectification": "Return for Correction",
  close: "Accept",
};

const ACTION_VARIANTS: Record<BulkActionKind, "primary" | "danger" | "success"> = {
  approve: "primary",
  reject: "danger",
  "return-review": "primary",
  verify: "primary",
  "return-rectification": "primary",
  close: "success",
};

/**
 * Bulk selection + bulk actions for the Findings list - "select all" (on
 * this page; a bulk action against every filtered result across every
 * page is a much bigger blast radius than this asks for) plus per-row
 * checkboxes, and a toolbar offering only the review/verify/close actions
 * the signed-in session can actually attempt on at least one selected row
 * right now. Each action still dispatches through the exact same
 * permission-gated single-finding routes the detail page uses (district-
 * review/ho-review/bank-approval/verify-rectification/return-
 * rectification/close) - looped client-side, one request per eligible
 * finding - so there is no separate bulk business logic to keep in sync
 * with the single-finding rules (closable-amount bounds, period-locked
 * checks, org-scope checks, etc. all still apply per item).
 */
export function FindingsTable({ rows, permissions, emptyText }: { rows: FindingRow[]; permissions: BulkPermissions; emptyText: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const canBulkAct =
    permissions.canDistrictReview ||
    permissions.canHoReview ||
    permissions.canBankApprove ||
    permissions.canVerifyRectification ||
    permissions.canReturnRectification ||
    permissions.canClose;

  const allSelected = rows.length > 0 && rows.every((f) => selected.has(f.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((f) => f.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedRows = rows.filter((f) => selected.has(f.id));
  const actionKinds: BulkActionKind[] = (["approve", "return-review", "reject", "verify", "return-rectification", "close"] as const).filter(
    (kind) => eligibleFor(kind, selectedRows, permissions).length > 0
  );

  async function runBulkAction(kind: BulkActionKind) {
    const eligible = eligibleFor(kind, selectedRows, permissions);
    if (eligible.length === 0) return;

    const needsReason = kind === "reject" || kind === "return-review" || kind === "return-rectification";
    const label = ACTION_LABELS[kind];
    const skipped = selectedRows.length - eligible.length;
    const result = await confirm({
      title: `${label} ${eligible.length} finding(s)?`,
      message:
        skipped > 0
          ? `${skipped} of your ${selectedRows.length} selected finding(s) aren't eligible for "${label}" and will be skipped.`
          : `This applies "${label}" to all ${eligible.length} selected finding(s).`,
      confirmLabel: label,
      tone: kind === "reject" ? "danger" : kind === "close" ? "success" : "default",
      needsReason,
    });
    if (result === false) return;
    const reason = typeof result === "string" ? result : "";

    setBusy(true);
    setSummary(null);
    let succeeded = 0;
    const failures: string[] = [];
    for (const f of eligible) {
      const { url, body } = requestFor(kind, f, reason);
      try {
        await apiSend(url, "POST", body);
        succeeded++;
      } catch (err) {
        failures.push(`${f.reference}: ${err instanceof ApiError ? err.message : "Failed"}`);
      }
    }
    setBusy(false);
    setSelected(new Set());
    const parts = [`${succeeded} succeeded`];
    if (skipped > 0) parts.push(`${skipped} skipped (not eligible)`);
    if (failures.length > 0) parts.push(`${failures.length} failed`);
    setSummary(`${label}: ${parts.join(", ")}.${failures.length > 0 ? " " + failures.slice(0, 3).join("; ") : ""}`);
    router.refresh();
  }

  return (
    <div>
      {dialog}
      {summary && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span>{summary}</span>
          <button type="button" onClick={() => setSummary(null)} className="text-slate-400 hover:text-slate-600">
            Dismiss
          </button>
        </div>
      )}
      {canBulkAct && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-blue-50/50 px-4 py-2.5">
          <span className="text-xs font-medium text-slate-600">{selected.size} selected</span>
          {actionKinds.length === 0 ? (
            <span className="text-xs text-slate-400">No bulk actions apply to this selection.</span>
          ) : (
            actionKinds.map((kind) => (
              <Button key={kind} variant={ACTION_VARIANTS[kind]} disabled={busy} onClick={() => runBulkAction(kind)}>
                {ACTION_LABELS[kind]} ({eligibleFor(kind, selectedRows, permissions).length})
              </Button>
            ))
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs text-slate-500 hover:underline">
            Clear selection
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
            <tr>
              {canBulkAct && (
                <th className="w-8 px-4 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all on this page" />
                </th>
              )}
              <th className="px-4 py-2 font-medium">Reference</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Branch</th>
              <th className="px-4 py-2 font-medium">Department</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">Risk</th>
              <th className="px-4 py-2 font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={canBulkAct ? 11 : 10}>
                  {emptyText}
                </td>
              </tr>
            )}
            {rows.map((f) => (
              <tr key={f.id} className={`hover:bg-slate-50 ${selected.has(f.id) ? "bg-blue-50/40" : ""}`}>
                {canBulkAct && (
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleOne(f.id)} aria-label={`Select ${f.reference}`} />
                  </td>
                )}
                <td className="px-4 py-2">
                  <Link href={`/findings/${f.id}`} className="font-mono text-xs text-blue-800 hover:underline">
                    {f.reference}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-900">{f.title}</td>
                <td className="px-4 py-2 text-slate-600">{f.branchName}</td>
                <td className="px-4 py-2 text-slate-600">{f.departmentName}</td>
                <td className="px-4 py-2 text-slate-600">{f.categoryName}</td>
                <td className="px-4 py-2 text-slate-600">{f.sourceName}</td>
                <td className="px-4 py-2 text-slate-600">{f.riskLevel}</td>
                <td className="px-4 py-2 text-slate-900">
                  {f.currency} {formatNumber(f.amount)}
                </td>
                <td className="px-4 py-2">
                  <FindingStatusBadge status={f.status} />
                </td>
                <td className="px-4 py-2 text-xs text-slate-400">{formatDateTime(f.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
