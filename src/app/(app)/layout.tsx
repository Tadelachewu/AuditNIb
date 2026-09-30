import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PermissionsProvider } from "@/lib/permissions/PermissionsContext";
import { MuiProvider } from "@/components/ui/MuiProvider";
// Appearance (Verdana, compact text, high-contrast secondary text, page-coloured
// header/sidebar) is fixed app-wide in globals.css - not configurable.

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // While a password change is pending (src/proxy.ts already redirects
  // every other page to /profile), the sidebar's links would just bounce
  // straight back here if clicked - hidden rather than shown-but-useless.
  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-100">
        <Topbar user={user} />
        <main className="min-w-0 flex-1 overflow-x-clip p-6">
          <MuiProvider>{children}</MuiProvider>
        </main>
      </div>
    );
  }

  return (
    <PermissionsProvider permissions={user.permissions ?? []}>
      <div className="flex min-h-screen bg-slate-100">
        <Sidebar permissions={user.permissions ?? []} role={user.role ?? ""} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} sidebar />
          <main className="min-w-0 flex-1 overflow-x-clip p-6">
          <MuiProvider>{children}</MuiProvider>
        </main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
