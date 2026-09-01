"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { ReasonPicker, resolveReason } from "@/components/reports/ReasonPicker";
import { UncoveredBranchNoteForm } from "@/components/reports/UncoveredBranchNoteForm";
import type { UncoveredReason, Branch, District, BranchCoverageNote } from "@/types";

interface Row {
  branch: Branch;
  district: District | undefined;
  note: BranchCoverageNote | null;
}

// Owns the one piece of state a plain per-row form can't: which branches
// are checkbox-selected, shared across every row so a bulk "apply this
// reason to all of them" toolbar can act on the set. Per-row editing still
// goes through UncoveredBranchNoteForm unchanged - this only adds the
// selection layer and the shared ReasonPicker used for the bulk apply.
export function UncoveredBranchesTable({ rows, periodId, reasons }: { rows: Row[]; periodId: string; reasons: UncoveredReason[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState("");
  const [bulkCustomText, setBulkCustomText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.branch.id)));
  }
  function toggleOne(branchId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }

  const bulkResolved = resolveReason(reasons, bulkValue, bulkCustomText);

  async function applyBulk() {
    if (!bulkResolved || selected.size === 0) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      await apiSend("/api/report-templates/uncovered-branches/note/bulk", "POST", {
        branchIds: [...selected],
        periodId,
        reason: bulkResolved.reason,
        reasonId: bulkResolved.reasonId,
      });
      setSelected(new Set());
      setBulkValue("");
      setBulkCustomText("");
      router.refresh();
    } catch (err) {
      setBulkError(err instanceof ApiError ? err.message : "Failed to apply");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="no-print mx-4 mb-3 mt-4 flex flex-wrap items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <span className="mt-2 text-sm font-medium text-slate-700">{selected.size} branch(es) selected</span>
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
                {bulkBusy ? "Applying..." : `Apply to ${selected.size} branch(es)`}
              </Button>
              <Button variant="secondary" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
            <tr>
              <th className="no-print w-8 px-4 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={rows.length === 0}
                  aria-label="Select all branches"
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
              </th>
              <th className="px-4 py-2 font-medium">Ser. No</th>
              <th className="px-4 py-2 font-medium">Name of Branches</th>
              <th className="px-4 py-2 font-medium">Name of Districts</th>
              <th className="px-4 py-2 font-medium">Reasons for failing to uncover</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={5}>
                  Every active branch submitted at least one finding this period.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.branch.id}>
                <td className="no-print px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.branch.id)}
                    onChange={() => toggleOne(r.branch.id)}
                    aria-label={`Select ${r.branch.name}`}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                </td>
                <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                <td className="px-4 py-2 text-slate-900">{r.branch.name}</td>
                <td className="px-4 py-2 text-slate-600">{r.district?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <UncoveredBranchNoteForm branchId={r.branch.id} periodId={periodId} reasons={reasons} note={r.note} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
