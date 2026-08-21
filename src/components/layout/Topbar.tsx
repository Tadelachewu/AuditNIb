import { ROLE_LABELS } from "@/types";
import type { SessionData } from "@/lib/session";
import { LogoutButton } from "@/components/layout/LogoutButton";

export function Topbar({ user }: { user: SessionData }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div />
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-slate-900">{user.name}</p>
          <p className="text-xs text-slate-500">{ROLE_LABELS[user.role!]}</p>
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
