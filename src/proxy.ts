import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";
import { hasPermission, permissionKey } from "@/lib/permissions/registry";

const PUBLIC_PATHS = ["/login"];

// Every /admin/<page> route, and every /findings route (list, new, detail
// - all one page code regardless of sub-path), needs "<page>.view" on the
// caller's session (permissions are resolved from the user's role at
// login time - see src/app/api/auth/login/route.ts - and carried in the
// encrypted cookie, so this check needs no filesystem/database read). This
// is a UX convenience only - the actual authorization boundary is
// enforced again, action by action, in every API route via
// requirePermission() (see src/lib/guard.ts), since middleware/UI checks
// can never be trusted alone.
function pageCodeFor(pathname: string): string | null {
  if (pathname === "/admin") return "admin-dashboard";
  const adminMatch = pathname.match(/^\/admin\/([^/]+)/);
  if (adminMatch) return adminMatch[1];
  if (pathname === "/findings" || pathname.startsWith("/findings/")) return "findings";
  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon") ||
    // Static files served directly from /public (logos, icons, etc.) must
    // never require a session - besides being genuinely public, Next's own
    // image optimizer fetches these internally without forwarding the
    // caller's cookies, so gating them here made next/image fail with
    // "not a valid image" instead of a real auth error.
    /\.(png|jpe?g|gif|svg|webp|avif|ico)$/i.test(pathname)
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

  const pageCode = pageCodeFor(pathname);
  if (isLoggedIn && pageCode && !hasPermission(session.permissions, permissionKey(pageCode, "view"))) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
