import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import type { Role } from "@/types";

export interface SessionData {
  isLoggedIn: boolean;
  userId?: string;
  username?: string;
  name?: string;
  role?: Role;
  districtId?: string | null;
  branchId?: string | null;
}

const password = process.env.IRON_SESSION_PASSWORD;
if (!password || password.length < 32) {
  throw new Error(
    "IRON_SESSION_PASSWORD env var must be set to a random string of at least 32 characters. See .env.example."
  );
}

export const sessionOptions: SessionOptions = {
  password,
  cookieName: "nib_control360_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
};

export const defaultSession: SessionData = { isLoggedIn: false };

/** Use inside Server Components, Server Actions, and Route Handlers. */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  if (session.isLoggedIn === undefined) {
    session.isLoggedIn = false;
  }
  return session;
}

/** Returns the logged-in session, or null if there isn't one. */
export async function getCurrentUser(): Promise<SessionData | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) return null;
  return session;
}
