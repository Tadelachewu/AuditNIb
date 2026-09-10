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

// Larger than either of this app's own upload caps (evidence and import are
// both 10 MB - see src/lib/evidence.ts / src/lib/import.ts's own
// MAX_EVIDENCE_BYTES / MAX_IMPORT_BYTES) so neither is affected, but small
// enough to reject an oversized payload aimed at a route that has no size
// check of its own (every plain JSON POST/PATCH endpoint) before it's ever
// read into memory by request.json().
const MAX_API_BODY_BYTES = 11 * 1024 * 1024;

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Secondary CSRF defense on top of the session cookie's own SameSite=Lax
// (which already blocks a forged cross-site POST from carrying the cookie
// in any modern browser): reject a state-changing /api request whose
// Origin (or, failing that, Referer) doesn't match its own Host. A browser
// sets Origin itself and page JS can't override it, so a genuinely forged
// cross-site request either carries a mismatching Origin or - for a
// same-site, same-origin request, which is the only kind this app's own
// frontend ever sends - matches exactly. Requests with neither header
// (curl, server-to-server calls, most non-browser tooling) are allowed
// through rather than blocked outright, since blocking them would reject
// legitimate non-browser callers without stopping a real attack (a forged
// browser request always has Origin set).
function isCrossOriginApiRequest(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host !== host;
    } catch {
      return true;
    }
  }

  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api")) {
    if (STATE_CHANGING_METHODS.has(request.method)) {
      const contentLength = Number(request.headers.get("content-length") ?? "0");
      if (contentLength > MAX_API_BODY_BYTES) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      if (isCrossOriginApiRequest(request)) {
        return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
      }
    }
    return NextResponse.next();
  }

  if (
    pathname.startsWith("/_next") ||
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

  // An admin-set password (initial creation or a reset) forces every page
  // but /profile until the user changes it themself - see
  // User.mustChangePassword's doc comment. Never gates /api routes (they
  // already bail out above); this only blocks navigating the UI.
  if (isLoggedIn && session.mustChangePassword && pathname !== "/profile") {
    return NextResponse.redirect(new URL("/profile", request.url));
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
