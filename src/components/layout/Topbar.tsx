import type { SessionData } from "@/lib/session";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/layout/UserMenu";

export function Topbar({ user }: { user: SessionData }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-chrome-border bg-chrome-bg px-6 py-3">
      <div />
      <div className="flex items-center gap-3">
        <ThemeToggle />
        {!user.mustChangePassword && <NotificationBell />}
        <UserMenu name={user.name ?? user.username ?? "Account"} roleName={user.roleName} />
      </div>
    </header>
  );
}
