import { redirect } from "next/navigation";
import { ReauthPrompt } from "@/components/auth/ReauthPrompt";
import { SESSION_ENDED_PATH } from "@/lib/session";
import { getCurrentUser } from "@/lib/session";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PermissionsProvider } from "@/lib/permissions/PermissionsContext";
import { MuiProvider } from "@/components/ui/MuiProvider";
import { TestClockBar, TestClockProvider } from "@/components/layout/TestClockBar";
import { testClockStatus } from "@/lib/testClock";
// The app has one fixed look (globals.css): Verdana, compact text, and the
// clean white template - white page, header and sidebar with nearly-white
// cards and tables - applied via data-ui-template="white". Not configurable.
const TEMPLATE = "white";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect(SESSION_ENDED_PATH);
  // Test servers only: simulated business dates (docs/test-clock.md).
  const clock = testClockStatus();

  // While a password change is pending (src/proxy.ts already redirects
  // every other page to /profile), the sidebar's links would just bounce
  // straight back here if clicked - hidden rather than shown-but-useless.
  if (user.mustChangePassword) {
    return (
      <TestClockProvider offsetMs={clock.offsetMs}>
        <div data-ui-template={TEMPLATE} className="flex min-h-screen flex-col bg-page">
          {clock.active && <TestClockBar />}
          <Topbar user={user} />
          <main className="min-w-0 flex-1 overflow-x-clip p-6">
            <MuiProvider>{children}</MuiProvider>
            <ReauthPrompt />
          </main>
        </div>
      </TestClockProvider>
    );
  }

  return (
    <PermissionsProvider permissions={user.permissions ?? []}>
      <TestClockProvider offsetMs={clock.offsetMs}>
      <div data-ui-template={TEMPLATE} className="flex min-h-screen bg-page">
        <Sidebar permissions={user.permissions ?? []} role={user.role ?? ""} />
        <div className="flex min-w-0 flex-1 flex-col">
          {clock.active && <TestClockBar />}
          <Topbar user={user} sidebar />
          <main className="min-w-0 flex-1 overflow-x-clip p-6">
          <MuiProvider>{children}</MuiProvider>
          <ReauthPrompt />
        </main>
        </div>
      </div>
      </TestClockProvider>
    </PermissionsProvider>
  );
}
