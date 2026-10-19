/**
 * The business clock (docs/test-clock.md). Every business rule that depends
 * on "today" reads appNow() instead of Date.now(): which period is current,
 * when the automatic transfer and the rectification reminders are due,
 * submission windows, "finding date not in the future", case age, and the
 * date defaults of forms and reports.
 *
 * Normally appNow() IS the real time. On a test server, APP_TEST_NOW in .env
 * (e.g. 2026-11-01T00:05:00, local time) moves the business clock to that
 * moment when the app starts; it then keeps ticking. It is ignored unless
 * APP_ENV is set to something other than "production". Real timestamps -
 * sessions, sign-in limits, the email queue, when a record was created or
 * changed, the audit log - always use the real clock, so nothing outside the
 * app (the database, Redis, Windows, other apps) is affected.
 *
 * Client-safe: in the browser the offset comes from the server
 * (TestClockProvider), so pages and forms use the same business date.
 */

export const TEST_NOW_VAR = "APP_TEST_NOW";

let serverOffset: number | null = null;
let browserOffset = 0;

/** Why APP_TEST_NOW isn't applied (null = it is, or isn't set). Server only. */
export function testClockProblem(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env[TEST_NOW_VAR]?.trim();
  if (!raw) return null;
  const appEnv = (env.APP_ENV ?? "").trim().toLowerCase();
  if (!appEnv || appEnv === "production") return `${TEST_NOW_VAR} is ignored: it only works when APP_ENV is set and isn't "production"`;
  if (Number.isNaN(Date.parse(raw))) return `${TEST_NOW_VAR} isn't a date and time (use e.g. 2026-11-01T00:05:00)`;
  return null;
}

/** Business clock minus real clock, in milliseconds (0 = real time). Fixed when first read on the server. */
export function clockOffsetMs(): number {
  if (typeof window !== "undefined") return browserOffset;
  if (serverOffset === null) {
    const raw = process.env[TEST_NOW_VAR]?.trim();
    serverOffset = raw && !testClockProblem() ? Date.parse(raw) - Date.now() : 0;
  }
  return serverOffset;
}

/** The business "now", in milliseconds. */
export function appNow(): number {
  return Date.now() + clockOffsetMs();
}

/** The business "now" as a Date. */
export function appDate(): Date {
  return new Date(appNow());
}

/** Browser only: the server's offset, set once by TestClockProvider before the page renders. */
export function setBrowserClockOffset(offsetMs: number): void {
  browserOffset = offsetMs;
}

/** For tests: forget the server offset so the next read uses the current environment. */
export function resetClockForTests(): void {
  serverOffset = null;
  browserOffset = 0;
}
