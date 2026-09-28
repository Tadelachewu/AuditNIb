"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

/**
 * The one thing a user can change about themself - their own password (see
 * /api/auth/change-password's own doc comment). Email and phone are
 * admin-only (set/changed via PATCH /api/admin/users/[id], read-only here -
 * see the Account card on (app)/profile/page.tsx), same as display name/
 * username/role/org, since both now feed the self-service Forgot Password
 * flow and every notification email - a user quietly changing either
 * themself would undermine account recovery and delivery, not just the
 * audit trail's "who did this" the other admin-only fields already protect.
 * `forced` renders the page as a mandatory first step (no way to navigate
 * elsewhere until the password is changed - src/proxy.ts already blocks
 * every other page) rather than an optional settings screen.
 */
export function ProfileClient({ forced }: { forced: boolean }) {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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

      {/* Opens by itself when a password change is being forced - that's the
          one thing this page is for until it's done. */}
      <CollapsibleCard
        defaultOpen={forced}
        title="Change Password"
        description="Requires your current password. Every other account detail - display name, username, role, organization assignment, email, and phone - can only be changed by an administrator."
      >
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
      </CollapsibleCard>
    </div>
  );
}
