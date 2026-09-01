"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { ReasonPicker, reasonToPickerValue, resolveReason } from "@/components/reports/ReasonPicker";
import type { UncoveredReason } from "@/types";

// The Uncovered Branches report's one writable field - why a branch has no
// findings this period, picked from the admin-configured list (see
// ReasonPicker) or typed by hand via "Other". router.refresh() after save
// re-runs the parent Server Component so the fresh note comes back down as
// a prop, instead of this holding its own competing copy of server state.
export function UncoveredBranchNoteForm({
  branchId,
  periodId,
  reasons,
  note,
}: {
  branchId: string;
  periodId: string;
  reasons: UncoveredReason[];
  note: { reasonId: string | null; reason: string } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const initial = reasonToPickerValue(note);
  const [value, setValue] = useState(initial.value);
  const [customText, setCustomText] = useState(initial.customText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-700">{note?.reason || <span className="text-slate-400">No reason recorded</span>}</span>
        <Button
          variant="secondary"
          onClick={() => {
            setValue(initial.value);
            setCustomText(initial.customText);
            setError(null);
            setEditing(true);
          }}
        >
          {note?.reason ? "Edit" : "Add reason"}
        </Button>
      </div>
    );
  }

  const resolved = resolveReason(reasons, value, customText);

  async function save() {
    if (!resolved) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/report-templates/uncovered-branches/note", "POST", {
        branchId,
        periodId,
        reason: resolved.reason,
        reasonId: resolved.reasonId,
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-2">
      <ReasonPicker reasons={reasons} value={value} customText={customText} onValueChange={setValue} onCustomTextChange={setCustomText} />
      <div className="flex flex-col gap-1">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !resolved} onClick={save}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
