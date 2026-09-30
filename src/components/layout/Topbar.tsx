import type { SessionData } from "@/lib/session";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { UserMenu } from "@/components/layout/UserMenu";
import { SidebarToggle } from "@/components/layout/SidebarToggle";

export function Topbar({ user, sidebar = false }: { user: SessionData; sidebar?: boolean }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-chrome-border bg-chrome-bg px-6">
      {/* Show / hide the sidebar (only on pages that have one). */}
      <div>{sidebar && <SidebarToggle />}</div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        {!user.mustChangePassword && <NotificationBell />}
        <UserMenu name={user.name ?? user.username ?? "Account"} roleName={user.roleName} />
      </div>
    </header>
  );
}
