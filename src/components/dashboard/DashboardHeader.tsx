import type { ReactNode } from "react";
import type { SessionData } from "@/lib/session";

/**
 * The heading of every dashboard (Admin, Branch, District, Head Office,
 * Executive), the same three lines on each:
 *   1. the dashboard's name
 *   2. what it covers - scope first, details after, separated by " · "
 *   3. who is signed in - name and role
 */
export function DashboardHeader({ title, scope, user }: { title: string; scope: ReactNode; user: Pick<SessionData, "name" | "roleName" | "role"> }) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{scope}</p>
      <p className="mt-1 text-sm text-slate-600">
        Signed in as <span className="font-medium text-slate-900">{user.name ?? "Unknown user"}</span> · {user.roleName ?? user.role ?? "No role"}
      </p>
    </div>
  );
}
