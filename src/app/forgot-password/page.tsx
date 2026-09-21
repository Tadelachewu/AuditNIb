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
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiSend("/api/auth/forgot-password", "POST", { identifier });
      setSent(true);
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
          <h1 className="text-xl font-bold text-blue-900">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-500">
            {sent
              ? "Check your inbox for the reset link."
              : "Enter your username or email and we'll send a link to set a new password."}
          </p>
        </div>

        {sent ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-sm text-green-800">
            <p className="font-medium">Password reset email sent</p>
            <p className="mt-2 text-green-700">
              If an active account matches that username or email address, you'll receive an email with a link to
              reset your password. The link is valid for 30 minutes and can only be used once.
            </p>
            <p className="mt-3 text-green-700">
              Didn't receive it? Check your spam/junk folder, or{" "}
              <Link href="/forgot-password" className="font-medium underline hover:text-green-900">
                try again with a different identifier
              </Link>
              .
            </p>
            <div className="mt-5">
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <Label htmlFor="identifier">Username or email address</Label>
              <Input
                id="identifier"
                autoFocus
                autoComplete="username"
                placeholder="admin / someone@nibbank.example"
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
              <Link href="/login" className="font-medium text-blue-700 hover:text-blue-900 hover:underline">
                ← Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
