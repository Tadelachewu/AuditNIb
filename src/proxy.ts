import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";

const PUBLIC_PATHS = ["/login"];

// Every /admin/<page> route needs "<page>.view" on the caller's session
// (permissions are resolved from the user's role at login time - see
// src/app/api/auth/login/route.ts - and carried in the encrypted cookie, so
// this check needs no filesystem/database read). This is a UX convenience
// only - the actual authorization boundary is enforced again, action by
// action, in every API route via requirePermission() (see
// src/lib/guard.ts), since middleware/UI checks can never be trusted alone.
function adminPageCodeFor(pathname: string): string | null {
  if (pathname === "/admin") return "admin-dashboard";
  const match = pathname.match(/^\/admin\/([^/]+)/);
  return match ? match[1] : null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions);
  const isLoggedIn = Boolean(session.isLoggedIn && session.userId);
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  if (!isLoggedIn && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isPublicPath) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const pageCode = adminPageCodeFor(pathname);
  if (isLoggedIn && pageCode && !hasPermission(session.permissions, permissionKey(pageCode, "view"))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
