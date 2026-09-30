import { LoginClient, type DemoUser } from "@/components/auth/LoginClient";

// The seeded demo accounts (prisma/seedData.ts) - listed on the sign-in
// page ONLY on a server explicitly marked APP_ENV=development. Anywhere
// else this is null, so the credentials never reach the browser - not in
// the page, not in its JavaScript. Seeded accounts on a non-development
// database must change these passwords at first login anyway (seedData.ts).
// See docs/PRODUCTION.md.
const DEMO_USERS: DemoUser[] = [
  { role: "Administrator", username: "admin", password: "Admin@123" },
  { role: "HO Internal Controller", username: "ho.controller", password: "Ho@12345" },
  { role: "District Internal Controller", username: "district.controller", password: "District@123" },
  { role: "District Director", username: "district.director", password: "Director@123" },
  { role: "Branch Internal Controller", username: "branch.controller", password: "Branch@123" },
  { role: "Branch Manager", username: "branch.manager", password: "Manager@123" },
  { role: "Executive (Read-only)", username: "executive", password: "Executive@123" },
];

// Read per request (not at build time), so a built app follows the
// server's .env - the same switch as the /dev-reset tool.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const isDevelopment = (process.env.APP_ENV ?? "").trim().toLowerCase() === "development";
  const sessionEnded = (await searchParams).reason === "session-ended";
  return <LoginClient demoUsers={isDevelopment ? DEMO_USERS : null} sessionEnded={sessionEnded} />;
}
