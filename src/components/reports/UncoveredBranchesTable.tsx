"use client";

import { useState, useMemo } from "react";
import type { MRT_ColumnDef, MRT_RowSelectionState } from "material-react-table";
import { useRouter } from "next/navigation";
import { apiSend, errorMessage } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { AdminTable } from "@/components/ui/AdminTable";
import { ReasonPicker, resolveReason } from "@/components/reports/ReasonPicker";
import { UncoveredBranchNoteForm } from "@/components/reports/UncoveredBranchNoteForm";
import type { UncoveredReason, Branch, District, BranchCoverageNote } from "@/types";
import { notify, notifications } from "@/lib/notify";

interface Row {
  branch: Branch;
  district: District | undefined;
  note: BranchCoverageNote | null;
}

// Material React Table (AdminTable) over every uncovered branch: search
// (branch or district name), sort, column filters, export CSV, and
// checkbox selection shared across rows so a bulk "apply this reason to
// all of them" toolbar can act on the set. Per-row editing still goes
// through UncoveredBranchNoteForm unchanged. No pagination: this is an
// official template that must print (and scan) every branch at once.
export function UncoveredBranchesTable({ rows, periodId, reasons }: { rows: Row[]; periodId: string; reasons: UncoveredReason[] }) {
  const router = useRouter();
  const [rowSelection, setRowSelection] = useState<MRT_RowSelectionState>({});
  const [bulkValue, setBulkValue] = useState("");
  const [bulkCustomText, setBulkCustomText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Keyed by branch id, so a selection survives narrowing the search.
  const selected = useMemo(() => Object.keys(rowSelection).filter((id) => rowSelection[id]), [rowSelection]);

  const columns = useMemo<MRT_ColumnDef<Row>[]>(
    () => [
      {
        id: "serNo",
        header: "Ser. No",
        size: 70,
        enableSorting: false,
        enableColumnFilter: false,
        Cell: ({ staticRowIndex }) => <span className="text-slate-500">{(staticRowIndex ?? 0) + 1}</span>,
      },
      { id: "branch", header: "Name of Branches", accessorFn: (r) => r.branch.name },
      { id: "district", header: "Name of Districts", accessorFn: (r) => r.district?.name ?? "—", filterVariant: "select" },
      {
        id: "reason",
        header: "Reasons for failing to uncover",
        accessorFn: (r) => r.note?.reason ?? "",
        enableSorting: false,
        size: 360,
        Cell: ({ row }) => <UncoveredBranchNoteForm branchId={row.original.branch.id} periodId={periodId} reasons={reasons} note={row.original.note} />,
      },
    ],
    [periodId, reasons]
  );

  const bulkResolved = resolveReason(reasons, bulkValue, bulkCustomText);

  async function applyBulk() {
    if (!bulkResolved || selected.length === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      await apiSend("/api/report-templates/uncovered-branches/note/bulk", "POST", {
        branchIds: selected,
        periodId,
        reason: bulkResolved.reason,
        reasonId: bulkResolved.reasonId,
      });
      notify.success(notifications.uncoveredNote.bulkSaved);
      setRowSelection({});
      setBulkValue("");
      setBulkCustomText("");
      router.refresh();
    } catch (err) {
      setBulkError(errorMessage(err, "Failed to apply"));
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      {selected.length > 0 && (
        <div className="no-print sticky top-16 z-10 mx-4 mb-3 mt-4 flex flex-wrap items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 shadow-sm">
          <span className="mt-2 text-sm font-medium text-slate-700">{selected.length} branch(es) selected</span>
          <ReasonPicker
            reasons={reasons}
            value={bulkValue}
            customText={bulkCustomText}
            onValueChange={setBulkValue}
            onCustomTextChange={setBulkCustomText}
          />
          <div className="flex flex-col gap-1">
            {bulkError && <span className="text-xs text-red-600">{bulkError}</span>}
            <div className="flex gap-2">
              <Button disabled={bulkBusy || !bulkResolved} onClick={applyBulk}>
                {bulkBusy ? "Applying..." : `Apply to ${selected.length} branch(es)`}
              </Button>
              <Button variant="secondary" onClick={() => setRowSelection({})}>
                Clear selection
              </Button>
            </div>
          </div>
        </div>
      )}

      <AdminTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.branch.id}
        exportFileName="uncovered-branches"
        emptyText="Every active branch submitted at least one finding this period."
        tableOptions={{
          enablePagination: false,
          enableRowSelection: true,
          selectAllMode: "all", // "select all" = every row the search/filters leave visible
          onRowSelectionChange: setRowSelection,
          state: { rowSelection },
          initialState: { density: "compact", showGlobalFilter: true },
          muiSearchTextFieldProps: { placeholder: "Search by branch or district name...", size: "small", variant: "outlined" },
          displayColumnDefOptions: {
            "mrt-row-select": { muiTableHeadCellProps: { className: "no-print" }, muiTableBodyCellProps: { className: "no-print" } },
          },
        }}
      />
    </>
  );
}
