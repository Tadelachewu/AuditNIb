"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<null | {
    smtpConfigured: boolean;
    emailSent?: boolean;
    smtpError?: string | null;
    sentTo?: string;
    noDeliverableEmail?: boolean;
  }>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResponse(null);
    setLoading(true);
    try {
      const r = await apiSend<{
        ok: boolean;
        smtpConfigured?: boolean;
        emailSent?: boolean;
        smtpError?: string | null;
        sentTo?: string;
        noDeliverableEmail?: boolean;
      }>("/api/auth/forgot-password", "POST", { identifier });
      setResponse({
        smtpConfigured: r.smtpConfigured ?? false,
        emailSent: r.emailSent,
        smtpError: r.smtpError ?? null,
        sentTo: r.sentTo,
        noDeliverableEmail: r.noDeliverableEmail,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/Nib_International_Bank.png" alt="NIB International Bank" width={64} height={64} className="mb-3" priority />
          <h1 className="text-xl font-bold text-brand-ink">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-600">
            {response
              ? "Check your inbox for the reset link."
              : "Enter your username or email and we'll send a link to set a new password."}
          </p>
        </div>

        {response ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-800">
              <p className="font-medium">Password reset email requested</p>
              <p className="mt-2 text-green-700">
                If an active account matches that username or email address, you&apos;ll receive an email with a link to
                reset your password. The link is valid for 30 minutes and can only be used once.
              </p>
              {response.sentTo && response.emailSent ? (
                <p className="mt-3 text-green-700">
                  Sent to <span className="font-mono">{response.sentTo}</span>.
                </p>
              ) : null}
              <p className="mt-3 text-green-700">
                Didn&apos;t receive it? Check your spam/junk folder, or{" "}
                <button
                  type="button"
                  onClick={() => {
                    setResponse(null);
                    setError(null);
                  }}
                  className="font-medium underline hover:text-green-900"
                >
                  try again with a different identifier
                </button>
                .
              </p>
            </div>

            {response.noDeliverableEmail ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                <p className="font-medium">This account has no deliverable email on file</p>
                <p className="mt-2 text-amber-700">
                  The matched account carries a placeholder or invalid email address. Ask an NIB Control360
                  administrator to open <strong>Admin → Users → Edit</strong> for that username and correct the email
                  address before requesting another reset link.
                </p>
              </div>
            ) : null}

            {!response.smtpConfigured ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
                <p className="font-medium">
                  ⚠️ Outbound email is <em>not configured</em> on this NIB Control360 instance.
                </p>
                <p className="mt-2 text-amber-800">
                  A password reset token was created for the matching account, but no SMTP relay is configured so the
                  reset email can&apos;t be delivered.
                </p>
                <p className="mt-2 text-amber-800">
                  <strong className="font-semibold">Action for an administrator:</strong> sign in, open{" "}
                  <strong>Admin → Settings → Notification Delivery</strong>, set{" "}
                  <strong>Provider = SMTP Relay</strong> with the real host/port/encryption for NIB&apos;s mail server,
                  save <strong>SMTP_USER</strong> / <strong>SMTP_PASSWORD</strong> in the server&apos;s{" "}
                  <code className="rounded bg-amber-100 px-1 py-0.5 text-[0.8em]">.env.local</code>, then click{" "}
                  <strong>Send Test Email</strong> to confirm delivery. Once that works, retry this page.
                </p>
              </div>
            ) : null}

            {response.smtpError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                <p className="font-medium">Email delivery failed</p>
                <p className="mt-2 text-red-700">{response.smtpError}</p>
                <p className="mt-2 text-red-700">
                  The reset token itself was saved, so an administrator can also check the server logs for the
                  underlying SMTP error.
                </p>
              </div>
            ) : null}

            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <Label htmlFor="identifier" brand>Username or email address</Label>
              <Input
                id="identifier"
                autoFocus
                autoComplete="username"
                placeholder="admin / someone@nibbank.com.et"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>

            {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Sending..." : "Send reset link"}
            </Button>

            <div className="mt-5 text-center text-sm">
              <Link href="/login" className="font-medium text-brand-ink hover:underline">
                ← Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
