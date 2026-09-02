"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

/**
 * The two things a user can change about themself - password (see
 * /api/auth/change-password's own doc comment) and email (see
 * /api/auth/email's own doc comment for why it's self-service unlike
 * display name/username/role/org, which stay admin-only and read-only on
 * the Account card above this, so the audit trail's "who did this" stays
 * trustworthy). `forced` renders the page as a mandatory first step (no
 * way to navigate elsewhere until the password is changed - src/proxy.ts
 * already blocks every other page) rather than an optional settings screen.
 */
export function ProfileClient({ initialEmail, forced }: { initialEmail: string; forced: boolean }) {
  const router = useRouter();

  const [email, setEmail] = useState(initialEmail);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaved, setEmailSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setEmailSaved(false);
    setEmailSaving(true);
    try {
      await apiSend("/api/auth/email", "PATCH", { email });
      setEmailSaved(true);
      router.refresh();
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setEmailSaving(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation don't match");
      return;
    }
    setPasswordSaving(true);
    try {
      await apiSend("/api/auth/change-password", "POST", { currentPassword, newPassword });
      if (forced) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {forced && (
        <Card className="border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">A password change is required before you can continue.</p>
          <p className="mt-0.5 text-xs text-amber-700">
            An administrator set (or reset) this account&apos;s password. Choose a new one only you know to unlock the rest of the app.
          </p>
        </Card>
      )}

      <Card>
        <CardHeader title="Email" description="Used for notification emails (submissions, approvals, rectifications, period events, ...)." />
        <form onSubmit={saveEmail} className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-72">
            <Label htmlFor="profile-email">Email address</Label>
            <Input
              id="profile-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={emailSaving || !email.trim()}>
            {emailSaving ? "Saving..." : "Save Email"}
          </Button>
          {emailSaved && <p className="text-sm text-emerald-700">Saved.</p>}
          {emailError && <p className="text-sm text-red-600">{emailError}</p>}
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Change Password"
          description="Requires your current password. Display name, username, role, and organization assignment can only be changed by an administrator."
        />
        <form onSubmit={savePassword} className="flex flex-col gap-3 p-4 sm:max-w-sm">
          <div>
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <div>
            <Button type="submit" disabled={passwordSaving}>
              {passwordSaving ? "Changing..." : "Change Password"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
