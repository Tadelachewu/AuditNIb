import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PermissionsProvider } from "@/lib/permissions/PermissionsContext";
import { MuiProvider } from "@/components/ui/MuiProvider";
import { prisma } from "@/lib/prismaClient";
import { normalizeTypography, typographyCss } from "@/lib/typography";

// Settings > Typography, applied to every page under (app). Reads just the
// one column (not the whole readDb() snapshot) since this runs on every
// navigation. Any failure falls back to the built-in default look rather
// than taking the whole app down over a cosmetic preference.
async function loadTypographyCss(): Promise<string> {
  try {
    const row = await prisma.settings.findUnique({ where: { id: "singleton" }, select: { typography: true } });
    return typographyCss(normalizeTypography(row?.typography));
  } catch {
    return "";
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const typography = await loadTypographyCss();
  const typographyStyle = typography ? <style dangerouslySetInnerHTML={{ __html: typography }} /> : null;

  // While a password change is pending (src/proxy.ts already redirects
  // every other page to /profile), the sidebar's links would just bounce
  // straight back here if clicked - hidden rather than shown-but-useless.
  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-100">
        {typographyStyle}
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
        {typographyStyle}
        <Sidebar permissions={user.permissions ?? []} role={user.role ?? ""} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} />
          <main className="min-w-0 flex-1 overflow-x-clip p-6">
          <MuiProvider>{children}</MuiProvider>
        </main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
