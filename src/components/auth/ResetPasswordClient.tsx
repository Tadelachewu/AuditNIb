"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { validatePasswordStrength } from "@/lib/passwordValidation";

export function ResetPasswordClient({ token: token }: { token: string | null }) {
  const router = useRouter();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const strengthHint = useMemo(() => {
    if (!newPassword) return null;
    const r = validatePasswordStrength(newPassword);
    if (r.valid) return { ok: true, text: "Password looks good" } as const;
    return { ok: false, text: r.error ?? "" } as const;
  }, [newPassword]);

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
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
            <h1 className="text-xl font-bold text-brand-ink">Invalid reset link</h1>
            <p className="mt-1 text-sm text-slate-600">This link is missing the required reset token.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-600">
              Request a new password reset link, or sign in if you remember your password.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <Link
                href="/forgot-password"
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-blue-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-900"
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
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-sm">
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
                className="inline-flex w-full items-center justify-center rounded-md border border-transparent bg-blue-800 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-900"
              >
                Sign in with new password
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
          <h1 className="text-xl font-bold text-brand-ink">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-600">Choose a strong password you haven&apos;t used elsewhere.</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <Label htmlFor="newPassword" brand>New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoFocus
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            {strengthHint && (
              <p className={`mt-1 text-xs ${strengthHint.ok ? "text-green-700" : "text-amber-700"}`}>
                {strengthHint.text}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              8+ characters, with uppercase, lowercase, a number, and a special character.
            </p>
          </div>
          <div className="mb-4">
            <Label htmlFor="confirmPassword" brand>Confirm new password</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full">
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
    </div>
  );
}
