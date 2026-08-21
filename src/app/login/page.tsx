"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Field";

const DEMO_USERS = [
  { role: "Administrator", username: "admin", password: "Admin@123" },
  { role: "HO Internal Controller", username: "ho.controller", password: "Ho@12345" },
  { role: "District Internal Controller", username: "district.controller", password: "District@123" },
  { role: "District Director", username: "district.director", password: "Director@123" },
  { role: "Branch Internal Controller", username: "branch.controller", password: "Branch@123" },
  { role: "Branch Manager", username: "branch.manager", password: "Manager@123" },
  { role: "Executive (Read-only)", username: "executive", password: "Executive@123" },
];

export default function LoginPage() {
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
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-blue-900">NIB Control360</h1>
          <p className="text-sm text-slate-500">Internal Control Findings Management System</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 rounded-lg border border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setShowDemo((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-slate-600"
          >
            Demo accounts (one per role)
            <span>{showDemo ? "−" : "+"}</span>
          </button>
          {showDemo && (
            <div className="max-h-56 overflow-y-auto border-t border-slate-100 px-4 py-2 text-xs">
              {DEMO_USERS.map((u) => (
                <div key={u.username} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-slate-500">{u.role}</span>
                  <span className="whitespace-nowrap font-mono text-slate-800">
                    {u.username} / {u.password}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
