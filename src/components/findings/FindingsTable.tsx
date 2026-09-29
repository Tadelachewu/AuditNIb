"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MRT_ColumnDef, MRT_RowSelectionState } from "material-react-table";
import { AdminTable } from "@/components/ui/AdminTable";
import { useUrlTableState } from "@/lib/useUrlTableState";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FindingStatusBadge } from "@/components/findings/FindingStatusBadge";
import { apiSend, ApiError } from "@/lib/api-client";
import { formatDateTime, formatCurrency } from "@/lib/format";
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
  // Who registered it - submit/route.ts requires the caller to be the
  // finding's own creator, not just org-scope/permission, so bulk Submit
  // has to know this per row too (see isSubmittable() below).
  createdBy: string;
  // Set when this row is a period filter's *historical* residency for a
  // finding that has since transferred onward (see
  // findingsResidentInPeriod() in src/lib/findings.ts) - it's this period's
  // own past record, not the finding's live current state, so it's never
  // eligible for a bulk action here.
  isHistorical: boolean;
  transferredOutToCode: string | null;
}

export interface BulkPermissions {
  canDistrictReview: boolean;
  canHoReview: boolean;
  canBankApprove: boolean;
  canVerifyRectification: boolean;
  canReturnRectification: boolean;
  canClose: boolean;
  canSubmit: boolean;
  currentUserId: string;
}

type BulkActionKind = "submit" | "approve" | "reject" | "return-review" | "verify" | "return-rectification" | "close";

const REVIEW_STATUSES: FindingStatus[] = ["DISTRICT_REVIEW", "HO_REVIEW", "PENDING_BANK_APPROVAL"];
const RECTIFICATION_STATUSES: FindingStatus[] = ["PARTIALLY_RECTIFIED", "RECTIFIED", "TRANSFERRED"];
// Same set submit/route.ts itself accepts (DRAFT plus a RETURNED finding
// bounced back for correction before ever reaching review).
const SUBMITTABLE_STATUSES: FindingStatus[] = ["DRAFT", "RETURNED"];

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

// submit/route.ts requires the caller to be the finding's own creator, not
// just org-scope/permission - same ownership rule enforced here so the
// bulk toolbar only ever offers Submit for drafts the signed-in session
// could actually submit one at a time.
function isSubmittable(f: FindingRow, perms: BulkPermissions): boolean {
  return SUBMITTABLE_STATUSES.includes(f.status) && f.createdBy === perms.currentUserId;
}

function eligibleFor(kind: BulkActionKind, rows: FindingRow[], perms: BulkPermissions): FindingRow[] {
  const actionable = rows.filter((f) => !f.isHistorical);
  switch (kind) {
    case "submit":
      return actionable.filter((f) => perms.canSubmit && isSubmittable(f, perms));
    case "approve":
    case "reject":
    case "return-review":
      return actionable.filter((f) => REVIEW_STATUSES.includes(f.status) && canReview(f.status, perms));
    case "verify":
      return actionable.filter((f) => perms.canVerifyRectification && isVerifiable(f));
    case "return-rectification":
      return actionable.filter((f) => perms.canReturnRectification && RECTIFICATION_STATUSES.includes(f.status));
    case "close":
      return actionable.filter((f) => perms.canClose && isClosable(f));
  }
}

function requestFor(kind: BulkActionKind, f: FindingRow, reason: string): { url: string; body?: unknown } {
  if (kind === "submit") return { url: `/api/findings/${f.id}/submit` };
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
  submit: "Submit",
  approve: "Approve",
  reject: "Reject",
  "return-review": "Return",
  verify: "Verify",
  "return-rectification": "Return for Correction",
  close: "Accept",
};

const ACTION_VARIANTS: Record<BulkActionKind, "primary" | "danger" | "success"> = {
  submit: "primary",
  approve: "primary",
  reject: "danger",
  "return-review": "primary",
  verify: "primary",
  "return-rectification": "primary",
  close: "success",
};

/**
 * The Findings list - Material React Table (see AdminTable) in SERVER mode:
 * the page (src/app/(app)/findings/page.tsx) filters (FilterBar), searches
 * (q), sorts (sort/dir) and pages (page/pageSize) every matching finding
 * server-side and sends only the current page. This table drives those
 * through the URL, so a view is shareable and survives refresh; Export CSV
 * downloads every matching finding (not just this page) via
 * /api/findings/export with the same parameters.
 *
 * Bulk selection + bulk actions: "select all" covers this page (a bulk
 * action against every filtered result across every page is a much bigger
 * blast radius than this asks for), and the toolbar offers only the
 * review/verify/close actions the signed-in session can actually attempt on
 * at least one selected row. Each action still dispatches through the exact
 * same permission-gated single-finding routes the detail page uses - looped
 * client-side, one request per eligible finding - so there is no separate
 * bulk business logic to keep in sync with the single-finding rules.
 */
export function FindingsTable({
  rows,
  permissions,
  emptyText,
  paging,
  sort,
  searchText,
}: {
  rows: FindingRow[];
  permissions: BulkPermissions;
  emptyText: string;
  paging: { page: number; pageSize: number; total: number };
  sort: { id: string; desc: boolean };
  searchText: string;
}) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [rowSelection, setRowSelection] = useState<MRT_RowSelectionState>({});
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  // Page / page size / sort / search live in the URL; the page applies them.
  const url = useUrlTableState<FindingRow>({ paging, sort, searchText });

  // A new page of data (navigation) clears the selection.
  useEffect(() => {
    setRowSelection({});
  }, [rows]);

  // The whole row opens its finding, not just the reference link - which
  // stays a real <a> for keyboard users and right-click "open in new tab".
  // Behaves like a link: Ctrl/Cmd-click or middle-click opens a new tab.
  // Ignored when the click was on a control inside the row (link, button,
  // checkbox...) or ended a text selection (copying a title/reference).
  function openFromRow(e: React.MouseEvent<HTMLTableRowElement>, id: string) {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, [role=checkbox]")) return;
    if (window.getSelection()?.toString()) return;
    const href = `/findings/${id}`;
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  }

  const canBulkAct =
    permissions.canSubmit ||
    permissions.canDistrictReview ||
    permissions.canHoReview ||
    permissions.canBankApprove ||
    permissions.canVerifyRectification ||
    permissions.canReturnRectification ||
    permissions.canClose;

  const selectedRows = rows.filter((f) => rowSelection[f.id]);
  const actionKinds: BulkActionKind[] = (["submit", "approve", "return-review", "reject", "verify", "return-rectification", "close"] as const).filter(
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
          ? `${skipped} of your ${selectedRows.length} selected finding(s) are not eligible for "${label}" and will be skipped.`
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
    setRowSelection({});
    const parts = [`${succeeded} succeeded`];
    if (skipped > 0) parts.push(`${skipped} skipped (not eligible)`);
    if (failures.length > 0) parts.push(`${failures.length} failed`);
    setSummary(`${label}: ${parts.join(", ")}.${failures.length > 0 ? " " + failures.slice(0, 3).join("; ") : ""}`);
    router.refresh();
  }

  const columns = useMemo<MRT_ColumnDef<FindingRow>[]>(
    () => [
      {
        id: "reference",
        accessorKey: "reference",
        header: "Reference",
        size: 150,
        Cell: ({ row }) => (
          <Link href={`/findings/${row.original.id}`} className="font-mono text-xs text-blue-800 hover:underline">
            {row.original.reference}
          </Link>
        ),
      },
      { id: "title", accessorKey: "title", header: "Title", Cell: ({ row }) => <span className="text-slate-900">{row.original.title}</span> },
      { id: "branch", accessorKey: "branchName", header: "Branch" },
      { id: "department", accessorKey: "departmentName", header: "Department" },
      { id: "category", accessorKey: "categoryName", header: "Category" },
      { id: "source", accessorKey: "sourceName", header: "Source" },
      { id: "risk", accessorKey: "riskLevel", header: "Risk", size: 90 },
      {
        id: "amount",
        accessorKey: "amount",
        header: "Amount",
        Cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums text-slate-900">
            {row.original.currency} {formatCurrency(row.original.amount)}
          </span>
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        Cell: ({ row }) =>
          row.original.isHistorical ? (
            <span
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
              title="This period's own record for this finding - it has since transferred on. Its current status lives under the period it transferred to."
            >
              Transferred → {row.original.transferredOutToCode ?? "—"}
            </span>
          ) : (
            <FindingStatusBadge status={row.original.status} />
          ),
      },
      {
        id: "updatedAt",
        accessorKey: "updatedAt",
        header: "Updated",
        Cell: ({ row }) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.original.updatedAt)}</span>,
      },
    ],
    []
  );

  return (
    <div>
      {dialog}
      {summary && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span>{summary}</span>
          <button type="button" onClick={() => setSummary(null)} className="text-slate-500 hover:text-slate-600">
            Dismiss
          </button>
        </div>
      )}
      {canBulkAct && selectedRows.length > 0 && (
        // Sticks just under the top bar (h-16) while the list scrolls, so the
        // actions stay in reach however far down the selection goes.
        <div className="no-print sticky top-16 z-10 flex flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-4 py-2.5 shadow-sm">
          <span className="text-xs font-medium text-slate-600">{selectedRows.length} selected</span>
          {actionKinds.length === 0 ? (
            <span className="text-xs text-slate-500">No bulk actions apply to this selection.</span>
          ) : (
            actionKinds.map((kind) => (
              <Button key={kind} variant={ACTION_VARIANTS[kind]} disabled={busy} onClick={() => runBulkAction(kind)}>
                {ACTION_LABELS[kind]} ({eligibleFor(kind, selectedRows, permissions).length})
              </Button>
            ))
          )}
          <button type="button" onClick={() => setRowSelection({})} className="ml-auto text-xs text-slate-500 hover:underline">
            Clear selection
          </button>
        </div>
      )}
      <AdminTable
        columns={columns}
        data={rows}
        getRowId={(f) => f.id}
        onExport={(scope) => url.exportFrom("/api/findings/export", scope)}
        emptyText={emptyText}
        tableOptions={{
          ...url.tableOptions,
          enableColumnFilters: false, // filtering is the FilterBar above
          enableRowSelection: canBulkAct ? (row) => !row.original.isHistorical : false,
          enableSelectAll: canBulkAct,
          selectAllMode: "page",
          onRowSelectionChange: setRowSelection,
          state: { ...url.state, rowSelection },
          muiSearchTextFieldProps: { placeholder: "Search reference, title, branch, category...", size: "small", variant: "outlined" },
          muiTableBodyRowProps: ({ row }) => ({
            onClick: (e) => openFromRow(e, row.original.id),
            onAuxClick: (e) => openFromRow(e, row.original.id),
            title: `Open ${row.original.reference}`,
            sx: { cursor: "pointer" },
          }),
          muiSelectCheckboxProps: ({ row }) => ({
            title: row.original.isHistorical ? "Historical record for this period - not actionable here." : undefined,
          }),
        }}
      />
    </div>
  );
}
