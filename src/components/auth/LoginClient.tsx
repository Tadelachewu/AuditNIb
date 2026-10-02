"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiSend } from "@/lib/api-client";
import { notify, notifications } from "@/lib/notify";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";
import { PASSWORD_MIN_LENGTH } from "@/lib/passwordValidation";
import { USERNAME_MIN_LENGTH } from "@/lib/usernameValidation";
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

export function LoginClient({ demoUsers, sessionEnded = false }: { demoUsers: DemoUser[] | null; sessionEnded?: boolean }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  // A field shows "required" only after the user has left it (or tried to sign in).
  const [touched, setTouched] = useState({ username: false, password: false });
  // Browser autofill fills the fields without a change event (and Chrome
  // hides an autofilled password's value until the first click), so an
  // autofilled field counts as filled; its real value is read on submit.
  const [autofilled, setAutofilled] = useState({ username: false, password: false });
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const isAutofilled = (el: HTMLInputElement | null) => {
      if (!el) return false;
      try {
        return el.matches(":autofill");
      } catch {
        try {
          return el.matches(":-webkit-autofill");
        } catch {
          return false;
        }
      }
    };
    // Autofill lands shortly after load; check for a couple of seconds.
    let checks = 0;
    const timer = window.setInterval(() => {
      setAutofilled({ username: isAutofilled(usernameRef.current), password: isAutofilled(passwordRef.current) });
      if (++checks >= 10) window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  // Only the minimum lengths every account has always had (usernames 3+,
  // passwords 8+) - not the full username format or password policy, which
  // older accounts may predate. An autofilled field counts as filled.
  const usernameProblem = autofilled.username
    ? null
    : !username.trim()
      ? "Username is required."
      : username.trim().length < USERNAME_MIN_LENGTH
        ? `Username must be at least ${USERNAME_MIN_LENGTH} characters.`
        : null;
  const passwordProblem = autofilled.password
    ? null
    : !password
      ? "Password is required."
      : password.length < PASSWORD_MIN_LENGTH
        ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
        : null;
  const usernameMissing = !!usernameProblem;
  const passwordMissing = !!passwordProblem;
  const canSubmit = !usernameMissing && !passwordMissing && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Read the inputs themselves too, so an autofilled value is never missed.
    const user = (username || usernameRef.current?.value || "").trim();
    const pass = password || passwordRef.current?.value || "";
    if (user.length < USERNAME_MIN_LENGTH || pass.length < PASSWORD_MIN_LENGTH) {
      setTouched({ username: true, password: true });
      notify.warning(notifications.generic.fixFields);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await apiSend("/api/auth/login", "POST", { username: user, password: pass });
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

        {sessionEnded && (
          <p role="status" className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Your session ended (signed in elsewhere, timed out, or your account changed). Please sign in again.
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="username" brand>Username</Label>
            <Input
              id="username"
              ref={usernameRef}
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setAutofilled((a) => ({ ...a, username: false }));
                setError(null);
              }}
              onBlur={() => setTouched((t) => ({ ...t, username: true }))}
              aria-invalid={error || (touched.username && usernameMissing) ? true : undefined}
              aria-describedby={touched.username && usernameMissing ? "username-error" : undefined}
              className={error || (touched.username && usernameMissing) ? "border-red-400" : undefined}
              required
            />
            {touched.username && usernameMissing && (
              <p id="username-error" className="mt-1 text-xs text-red-600">
                {usernameProblem}
              </p>
            )}
          </div>
          <div className="mb-4">
            <Label htmlFor="password" brand>Password</Label>
            <Input
              id="password"
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAutofilled((a) => ({ ...a, password: false }));
                setError(null);
              }}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              aria-invalid={error || (touched.password && passwordMissing) ? true : undefined}
              aria-describedby={touched.password && passwordMissing ? "password-error" : undefined}
              className={error || (touched.password && passwordMissing) ? "border-red-400" : undefined}
              required
            />
            {touched.password && passwordMissing && (
              <p id="password-error" className="mt-1 text-xs text-red-600">
                {passwordProblem}
              </p>
            )}
            <div className="mt-1.5 text-right">
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-brand-ink hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </div>


          <Button type="submit" disabled={!canSubmit} className="w-full" title={canSubmit || loading ? undefined : "Enter your username and password"}>
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
