import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // While a password change is pending (src/proxy.ts already redirects
  // every other page to /profile), the sidebar's links would just bounce
  // straight back here if clicked - hidden rather than shown-but-useless.
  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <Topbar user={user} />
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar permissions={user.permissions ?? []} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="flex-1 overflow-x-auto p-6">{children}</main>
      </div>
    </div>
  );
}
