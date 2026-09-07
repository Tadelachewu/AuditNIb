"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
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
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState("");
  const [bulkCustomText, setBulkCustomText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // A long branch list (410+ branches bank-wide) is otherwise a scroll-and-
  // scan exercise for the one person looking for their own branch to add a
  // reason - client-side, so it filters instantly against data already on
  // the page rather than round-tripping the server on every keystroke.
  // Matches branch name OR district name, so "West" finds every uncovered
  // branch in the West district too, not just a branch literally named it.
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.branch.name.toLowerCase().includes(q) || (r.district?.name.toLowerCase().includes(q) ?? false));
  }, [rows, search]);

  // "Select all" only ever selects what's currently visible - selecting a
  // branch the search has filtered out would be invisible and confusing to
  // undo. A selection made before narrowing the search still survives
  // (selected is keyed by branch id, not by row position), it just won't
  // show a checked checkbox while its row is hidden.
  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.branch.id));

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        for (const r of visibleRows) next.delete(r.branch.id);
        return next;
      }
      return new Set([...prev, ...visibleRows.map((r) => r.branch.id)]);
    });
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

      <div className="no-print flex items-center gap-2 px-4 pt-4">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by branch or district name..."
          aria-label="Search branches"
          className="max-w-xs"
        />
        {search && (
          <span className="text-xs text-slate-400">
            {visibleRows.length} of {rows.length} branch(es)
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase text-slate-400">
            <tr>
              <th className="no-print w-8 px-4 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={visibleRows.length === 0}
                  aria-label="Select all visible branches"
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
            {rows.length > 0 && visibleRows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={5}>
                  No branches match &quot;{search}&quot;.
                </td>
              </tr>
            )}
            {visibleRows.map((r, i) => (
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
