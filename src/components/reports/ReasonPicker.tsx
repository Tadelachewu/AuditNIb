"use client";

import { Select, Input } from "@/components/ui/Field";
import type { UncoveredReason } from "@/types";

// Sentinel value for the "Other (specify)" option - never a real
// UncoveredReason id, so it can share one <select> with the admin-
// configured list.
export const OTHER_VALUE = "__other__";

// Shared by the per-row "Add/Edit reason" form and the bulk-apply toolbar
// on the Uncovered Branches report, so both offer the exact same admin-
// configured list plus the same free-text fallback. `value` is the raw
// <select> value: "" (nothing chosen), an UncoveredReason id, or
// OTHER_VALUE - callers derive the actual (reasonId, reason text) pair to
// submit via resolveReason() below rather than re-deriving it themselves.
export function ReasonPicker({
  reasons,
  value,
  customText,
  onValueChange,
  onCustomTextChange,
  className,
}: {
  reasons: UncoveredReason[];
  value: string;
  customText: string;
  onValueChange: (value: string) => void;
  onCustomTextChange: (text: string) => void;
  className?: string;
}) {
  // Deactivated reasons drop out of the picklist for new selections, but a
  // note already pointing at one must keep showing it - otherwise the
  // <select> would silently fall back to its first option.
  const options = reasons.filter((r) => r.active || r.id === value);

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Select value={value} onChange={(e) => onValueChange(e.target.value)} className="max-w-56">
        <option value="" disabled>
          Select a reason...
        </option>
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
        <option value={OTHER_VALUE}>Other (specify)</option>
      </Select>
      {value === OTHER_VALUE && (
        <Input
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="Describe the reason"
          className="max-w-56"
        />
      )}
    </div>
  );
}

/** The <select> value that corresponds to an existing note, for pre-filling the picker when editing. */
export function reasonToPickerValue(note: { reasonId: string | null; reason: string } | null): { value: string; customText: string } {
  if (!note) return { value: "", customText: "" };
  if (note.reasonId) return { value: note.reasonId, customText: "" };
  return { value: OTHER_VALUE, customText: note.reason };
}

/** Resolves the picker's raw value/text into a submittable (reasonId, reason) pair, or null while incomplete. */
export function resolveReason(reasons: UncoveredReason[], value: string, customText: string): { reasonId: string | null; reason: string } | null {
  if (!value) return null;
  if (value === OTHER_VALUE) {
    const trimmed = customText.trim();
    return trimmed ? { reasonId: null, reason: trimmed } : null;
  }
  const found = reasons.find((r) => r.id === value);
  return found ? { reasonId: found.id, reason: found.name } : null;
}
