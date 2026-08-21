import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

const PUBLIC_PATHS = ["/login"];

// Every route under /admin is Administrator-only. Non-admin authenticated
// users land on /dashboard instead. This is a UX convenience only - the
// actual authorization boundary is enforced again in every API route via
// requireRole() (see src/lib/guard.ts), since middleware/UI checks can
// never be trusted on their own.
const ADMIN_ONLY_PREFIXES = ["/admin"];

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

  if (isLoggedIn && ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p)) && session.role !== "ADMIN") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
