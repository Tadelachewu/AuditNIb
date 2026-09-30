"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { AuthBackdrop, AUTH_PANEL_CLASS } from "@/components/auth/AuthBackdrop";

export interface DemoUser {
  role: string;
  username: string;
  password: string;
}

// The sign-in form. Rendered by src/app/login/page.tsx (a Server
// Component), which passes `demoUsers` only when APP_ENV=development - in
// production the list is null and the demo credentials are never sent to
// the browser at all (not just hidden). See docs/PRODUCTION.md.

export function LoginClient({ demoUsers }: { demoUsers: DemoUser[] | null }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiSend("/api/auth/login", "POST", { username, password });
      notify.success(notifications.auth.loginSuccess);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      // One message, as a notification (announced to screen readers); the
      // fields are marked invalid below so it's clear where to look.
      notify.loginError(err);
      setError("invalid");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthBackdrop>
      <div className={AUTH_PANEL_CLASS}>
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
          <h1 className="text-xl font-bold text-brand-ink">NIB Control360</h1>
          <p className="text-sm font-medium text-brand-ink">Internal Control Findings Management System</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="username" brand>Username</Label>
            <Input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              className={error ? "border-red-400" : undefined}
              required
            />
          </div>
          <div className="mb-4">
            <Label htmlFor="password" brand>Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              className={error ? "border-red-400" : undefined}
              required
            />
            <div className="mt-1.5 text-right">
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-brand-ink hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </div>


          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        {demoUsers && demoUsers.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowDemo((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-brand-ink"
          >
            Demo accounts (one per role)
            <span>{showDemo ? "−" : "+"}</span>
          </button>
          {showDemo && (
            <div className="max-h-56 overflow-y-auto border-t border-slate-100 px-4 py-2 text-xs">
              {demoUsers?.map((u) => (
                <div key={u.username} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-brand-ink/80">{u.role}</span>
                  <span className="whitespace-nowrap font-mono text-brand-ink">
                    {u.username} / {u.password}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </AuthBackdrop>
  );
}
