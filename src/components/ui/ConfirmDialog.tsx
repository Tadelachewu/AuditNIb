"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Field";
import { Modal } from "@/components/ui/AddDialog";
import { StickyActions } from "@/components/ui/StickyActions";
import { RuleInput } from "@/components/ui/RuleInput";
import { LIMITS, reasonError } from "@/lib/inputRules";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "default" | "success";
  /** When true, the dialog collects a short text reason and returns it instead of "". */
  needsReason?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (result: string | false) => void;
}

const initialState: ConfirmState = { open: false, title: "", message: "" };

/**
 * Promise-based confirmation for risky actions (deactivate, delete, lock,
 * reject, return, transfer, reverse, ...). Usage:
 *
 *   const { confirm, dialog } = useConfirm();
 *   const result = await confirm({ title: "...", message: "...", tone: "danger" });
 *   if (result === false) return; // cancelled
 *
 * Render `{dialog}` once anywhere in the page. When `needsReason` is set,
 * a successful confirm resolves with the typed reason string instead of "".
 *
 * Uses the app's one dialog look (Modal + StickyActions footer - the same as
 * every Add / Edit dialog). Escape or the X cancels; with no reason field,
 * Cancel has focus, so a stray Enter never confirms a destructive action.
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
    state.resolve?.(state.needsReason ? reason.trim() : "");
    setState(initialState);
  }

  function handleCancel() {
    state.resolve?.(false);
    setState(initialState);
  }

  const reasonProblem = state.needsReason ? reasonError(reason) : null;

  const dialog = state.open ? (
    // Same layout as every Add / Edit dialog (reference: "Open a New Period"):
    // title + explanation in the header, fields in the body, actions in the footer.
    <Modal title={state.title} description={state.message} onClose={handleCancel}>
      <form
        className="grid grid-cols-1 gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reasonProblem) handleConfirm();
        }}
      >
        {state.needsReason && (
          <div>
            <Label htmlFor="confirm-reason">Reason</Label>
            <RuleInput
              id="confirm-reason"
              maxLength={LIMITS.reason.max}
              check={(v) => reasonError(v)}
              hint={`At least ${LIMITS.reason.min} characters.`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        <StickyActions>
          <Button type="button" variant="cancel" onClick={handleCancel} data-autofocus>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={state.tone === "danger" ? "danger" : state.tone === "success" ? "success" : "primary"}
            disabled={!!reasonProblem}
          >
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </StickyActions>
      </form>
    </Modal>
  ) : null;

  return { confirm, dialog };
}
