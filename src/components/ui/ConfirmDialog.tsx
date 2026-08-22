"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
  /** When true, the dialog collects a short text reason and returns it instead of "". */
  needsReason?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (result: string | false) => void;
}

const initialState: ConfirmState = { open: false, title: "", message: "" };

/**
 * Promise-based confirmation modal for risky admin actions (deactivate,
 * activate a scoring rule, lock/unlock a period, ...). Usage:
 *
 *   const { confirm, dialog } = useConfirm();
 *   const result = await confirm({ title: "...", message: "...", tone: "danger" });
 *   if (result === false) return; // cancelled
 *
 * Render `{dialog}` once anywhere in the page. When `needsReason` is set,
 * a successful confirm resolves with the typed reason string instead of "".
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(initialState);
  const [reason, setReason] = useState("");

  function confirm(options: ConfirmOptions): Promise<string | false> {
    return new Promise((resolve) => {
      setReason("");
      setState({ ...options, open: true, resolve });
    });
  }

  function handleConfirm() {
    state.resolve?.(state.needsReason ? reason : "");
    setState(initialState);
  }

  function handleCancel() {
    state.resolve?.(false);
    setState(initialState);
  }

  const reasonTooShort = Boolean(state.needsReason) && reason.trim().length < 5;

  const dialog = state.open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-sm font-semibold text-slate-900">{state.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{state.message}</p>
        {state.needsReason && (
          <div className="mt-3">
            <Label htmlFor="confirm-reason">Reason</Label>
            <Input id="confirm-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant={state.tone === "danger" ? "danger" : "primary"} disabled={reasonTooShort} onClick={handleConfirm}>
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
