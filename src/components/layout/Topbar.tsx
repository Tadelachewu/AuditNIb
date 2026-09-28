import Link from "next/link";
import type { SessionData } from "@/lib/session";
import { LogoutButton } from "@/components/layout/LogoutButton";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

export function Topbar({ user }: { user: SessionData }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-on-dark/10 bg-brand-sidebar px-6 py-3">
      <div />
      <div className="flex items-center gap-4">
        <ThemeToggle />
        {!user.mustChangePassword && <NotificationBell />}
        <Link href="/profile" className="text-right hover:opacity-75">
          <p className="text-sm font-medium text-on-dark">{user.name}</p>
          <p className="text-xs text-on-dark/75">{user.roleName}</p>
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
