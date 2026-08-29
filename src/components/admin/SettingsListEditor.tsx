"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

// Replaces the old single comma-separated text field for each of
// Settings' configurable lists (currencies, risk levels, operation areas,
// priority levels, irregularity types) with a collapsible accordion:
// a vertical list of items, each individually removable, plus an
// "Add" row - so an admin adds/removes one value at a time instead of
// hand-editing a comma-separated string.
export function SettingsListEditor({
  title,
  description,
  items,
  onChange,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [newItem, setNewItem] = useState("");

  function addItem() {
    const trimmed = newItem.trim();
    if (!trimmed || items.includes(trimmed)) return;
    onChange([...items, trimmed]);
    setNewItem("");
  }

  function removeItem(item: string) {
    onChange(items.filter((i) => i !== item));
  }

  return (
    <div className="rounded-md border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        <div>
          <p className="text-sm font-medium text-slate-800">{title}</p>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-slate-400">{items.length}</span>
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-3">
          <div className="flex flex-col gap-1.5">
            {items.length === 0 && <p className="px-1 text-xs text-slate-400">No items yet.</p>}
            {items.map((item) => (
              <div key={item} className="flex items-center justify-between rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                <span className="text-slate-800">{item}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              value={newItem}
              placeholder="Add new..."
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addItem();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={addItem} disabled={!newItem.trim()}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
