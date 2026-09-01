import Link from "next/link";
import type { SessionData } from "@/lib/session";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { NotificationBell } from "@/components/layout/NotificationBell";

export function Topbar({ user }: { user: SessionData }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div />
      <div className="flex items-center gap-4">
        {!user.mustChangePassword && <NotificationBell />}
        <Link href="/profile" className="text-right hover:opacity-75">
          <p className="text-sm font-medium text-slate-900">{user.name}</p>
          <p className="text-xs text-slate-500">{user.roleName}</p>
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
