"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { apiSend } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { validatePasswordStrength } from "@/lib/passwordValidation";
import { PasswordRules } from "@/components/ui/PasswordRules";
import { AuthBackdrop, AUTH_PANEL_CLASS } from "@/components/auth/AuthBackdrop";

export function ResetPasswordClient({ token: token }: { token: string | null }) {

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Same policy as the server (src/lib/passwordValidation.ts).
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit = validatePasswordStrength(newPassword).valid && confirmPassword === newPassword && !loading;

  useEffect(() => {
    setError(null);
  }, [newPassword, confirmPassword]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is missing a token. Request a new one.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await apiSend("/api/auth/reset-password", "POST", { token, newPassword });
      notify.success(notifications.auth.passwordReset);
      setDone(true);
    } catch (err) {
      setError(notify.formError(err, notifications.auth.passwordResetFailed));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthBackdrop>
        <div className={AUTH_PANEL_CLASS}>
          <div className="mb-6 flex flex-col items-center text-center">
            <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
            <h1 className="text-xl font-bold text-brand-ink">Invalid reset link</h1>
            <p className="mt-1 text-sm text-slate-600">This link is missing the required reset token.</p>
          </div>
          <div>
            <p className="text-sm text-slate-600">
              Request a new password reset link, or sign in if you remember your password.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link
                href="/forgot-password"
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-brand-gold px-4 py-2 text-sm font-medium text-on-gold shadow-sm hover:bg-brand-gold-dark"
              >
                Request a new reset link
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </AuthBackdrop>
    );
  }

  if (done) {
    return (
      <AuthBackdrop>
        <div className={AUTH_PANEL_CLASS}>
          <div className="mb-6 flex flex-col items-center text-center">
            <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
            <h1 className="text-xl font-bold text-brand-ink">Password updated</h1>
            <p className="mt-1 text-sm text-slate-600">You can now sign in with your new password.</p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-sm text-green-800">
            <p className="font-medium">Your password has been reset.</p>
            <p className="mt-2 text-green-700">
              Any other open sessions for this account have been signed out automatically. Sign in again with your
              new password to continue.
            </p>
            <div className="mt-5">
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-md border border-transparent bg-brand-gold px-4 py-2 text-sm font-medium text-on-gold shadow-sm hover:bg-brand-gold-dark"
              >
                Sign in with new password
              </Link>
            </div>
          </div>
        </div>
      </AuthBackdrop>
    );
  }

  return (
    <AuthBackdrop>
      <div className={AUTH_PANEL_CLASS}>
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
          <h1 className="text-xl font-bold text-brand-ink">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-600">Choose a strong password you haven&apos;t used elsewhere.</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="newPassword" brand>New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-describedby="new-password-rules"
              required
            />
            {newPassword ? (
              <PasswordRules password={newPassword} id="new-password-rules" />
            ) : (
              <p id="new-password-rules" className="mt-1 text-xs text-slate-500">
                8+ characters, with uppercase, lowercase, a number, and a special character.
              </p>
            )}
          </div>
          <div className="mb-4">
            <Label htmlFor="confirmPassword" brand>Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={confirmMismatch ? true : undefined}
              aria-describedby={confirmMismatch ? "confirm-password-error" : undefined}
              className={confirmMismatch ? "border-red-400" : undefined}
              required
            />
            {confirmMismatch && (
              <p id="confirm-password-error" className="mt-1 text-xs text-red-600">
                Doesn&apos;t match the new password.
              </p>
            )}
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={!canSubmit} className="w-full">
            {loading ? "Updating password..." : "Reset password"}
          </Button>

          <div className="mt-5 flex items-center justify-between text-sm">
            <Link href="/forgot-password" className="font-medium text-slate-500 hover:text-slate-700 hover:underline">
              Request a new link
            </Link>
            <Link href="/login" className="font-medium text-brand-ink hover:underline">
              Back to sign in →
            </Link>
          </div>
        </form>
      </div>
    </AuthBackdrop>
  );
}
