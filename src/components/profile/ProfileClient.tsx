"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

/**
 * The two things a user can change about themself - see
 * /api/auth/profile (name) and /api/auth/change-password (password)'s own
 * doc comments for why the line is drawn exactly there. `forced` renders
 * the page as a mandatory first step (no way to navigate elsewhere until
 * the password is changed - src/proxy.ts already blocks every other page)
 * rather than an optional settings screen.
 */
export function ProfileClient({ initialName, forced }: { initialName: string; forced: boolean }) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    setNameSaving(true);
    try {
      await apiSend("/api/auth/profile", "PATCH", { name });
      setNameSaved(true);
      router.refresh();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : "Failed to save changes");
    } finally {
      setNameSaving(false);
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
        <CardHeader title="Display Name" description="Shown throughout the app - notifications, the audit trail, comments." />
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-64">
            <Label htmlFor="profile-name">Full name</Label>
            <Input id="profile-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={nameSaving || !name.trim()}>
            {nameSaving ? "Saving..." : "Save Name"}
          </Button>
          {nameSaved && <p className="text-sm text-emerald-700">Saved.</p>}
          {nameError && <p className="text-sm text-red-600">{nameError}</p>}
        </form>
      </Card>

      <Card>
        <CardHeader
          title="Change Password"
          description="Requires your current password. Username, role, and organization assignment can only be changed by an administrator."
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
