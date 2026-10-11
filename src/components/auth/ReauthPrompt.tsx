"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/AddDialog";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { StickyActions } from "@/components/ui/StickyActions";
import { setReauthHandler } from "@/lib/api-client";

/**
 * The "Confirm your password" dialog for high-risk actions (src/lib/reauth.ts).
 * Mounted once in the app layout. When the server answers an action with
 * REAUTH_REQUIRED, src/lib/api-client.ts calls the handler registered here;
 * it shows this dialog, confirms the password through POST /api/auth/reauth
 * and resolves true (the request is then repeated) or false (cancelled).
 */
export function ReauthPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One dialog for every request waiting on it (a page can fire several at once).
  const waiting = useRef<((ok: boolean) => void)[]>([]);

  useEffect(() => {
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          waiting.current.push(resolve);
          setPassword("");
          setError(null);
          setOpen(true);
        })
    );
    return () => setReauthHandler(null);
  }, []);

  function finish(ok: boolean) {
    setOpen(false);
    setPassword("");
    for (const resolve of waiting.current.splice(0)) resolve(ok);
  }

  async function confirm() {
    if (!password) {
      setError("Enter your password");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Plain fetch on purpose: this call must never trigger the prompt itself.
      const res = await fetch("/api/auth/reauth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        finish(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const message = typeof body?.error === "string" ? body.error : (body?.error as { message?: string } | undefined)?.message;
      setError(message ?? "Unable to confirm your password. Please try again.");
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Modal title="Confirm your password" description="This action changes access to the system, so please confirm it is you. You won't be asked again for a few minutes." size="md" onClose={() => finish(false)}>
      <form
        className="grid grid-cols-1 gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <div>
          <Label htmlFor="reauth-password">Your password</Label>
          <Input id="reauth-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
        <StickyActions error={error}>
          <Button type="button" variant="cancel" onClick={() => finish(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Checking..." : "Confirm"}
          </Button>
        </StickyActions>
      </form>
    </Modal>
  );
}
