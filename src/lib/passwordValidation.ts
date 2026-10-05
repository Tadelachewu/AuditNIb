// No `node:crypto` import here on purpose - this file is also imported by a
// client component (src/app/reset-password/page.tsx, for
// validatePasswordStrength), and webpack can't bundle `node:` URIs for the
// browser. The breach check below uses the global Web Crypto API instead,
// which exists in both Node and browsers.

// security/ChatBot_VA_Report_Analysis.md's VA-006 ("Weak Password Policy
// Enforcement") class: every password-setting endpoint in this app
// (self-service change, admin create user, admin reset user password) only
// ever checked `min(8)` - no complexity requirement and no check against
// commonly-guessed passwords. Centralized here so all three enforce the
// same rule instead of drifting.
//
// The local blocklist below covers the most commonly guessed/reused
// passwords for the synchronous, no-network check (validatePasswordStrength).
// validatePasswordFull() additionally checks the password against Have I
// Been Pwned's breach database - see that function's own doc comment for
// how the k-anonymity API keeps the real password from ever leaving this
// server.
/**
 * The demo accounts' passwords from prisma/seedData.ts (security review H3):
 * published in the docs, so never acceptable as a real password, and in
 * production a sign-in that uses one is forced to change it first (see the
 * login route).
 */
export const DEMO_PASSWORDS: readonly string[] = ["Admin@123", "Ho@12345", "District@123", "Director@123", "Branch@123", "Manager@123", "Executive@123"];

export function isDemoPassword(password: string): boolean {
  return DEMO_PASSWORDS.includes(password);
}

const COMMON_PASSWORDS = new Set(
  [
    ...DEMO_PASSWORDS,
    "password", "password1", "password123", "12345678", "123456789", "1234567890",
    "qwerty123", "qwertyuiop", "letmein", "welcome", "welcome1", "monkey123",
    "dragon123", "master123", "iloveyou", "admin123", "administrator", "changeme",
    "trustno1", "sunshine", "princess", "football", "baseball", "superman",
    "starwars", "shadow123", "michael1", "jennifer", "computer", "internet",
    "abc123456", "1q2w3e4r", "qazwsx123", "passw0rd", "p@ssw0rd", "p@ssword",
    "letmein123", "whatever", "freedom123", "nothing1", "hello123", "login123",
    "access123", "master1234", "flower123", "hunter123", "ranger123", "buster123",
    "harley123", "soccer123", "hockey123", "killer123", "george123", "andrew123",
    "charlie1", "amanda123", "loveme123", "chelsea1", "diamond1", "matthew1",
    "yankees1", "jordan23", "cameron1", "corvette", "firebird", "maverick",
    "phoenix1", "thunder1", "arsenal1", "chelsea123", "liverpool", "manchester",
    "banker123", "internal1", "controller1", "auditor123", "finance123", "manager1",
    "welcome123", "changeme123", "temppass", "temppass1", "temp12345", "defaultpass",
  ].map((p) => p.toLowerCase())
);

export interface PasswordCheckResult {
  valid: boolean;
  error?: string;
}

export const PASSWORD_MIN_LENGTH = 8;

// The password policy, one rule per line - the single source for the server
// check (validatePasswordStrength) and the live checklist every password
// field shows (src/components/ui/PasswordRules.tsx). Requires: 8+
// characters, a lowercase, an uppercase, a digit, a special character, and
// not a top-of-the-list common password. This is exactly the shape of this
// app's own seeded demo passwords (e.g. "Admin@123", "District@123" - see
// prisma/seedData.ts) so seeding an install doesn't itself fail this check.
const PASSWORD_RULES: { label: string; error: string; test: (p: string) => boolean }[] = [
  { label: `At least ${PASSWORD_MIN_LENGTH} characters`, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { label: "A lowercase letter", error: "Password must include a lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "An uppercase letter", error: "Password must include an uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A number", error: "Password must include a number", test: (p) => /[0-9]/.test(p) },
  { label: "A special character (e.g. @ # $ !)", error: "Password must include a special character", test: (p) => /[^A-Za-z0-9]/.test(p) },
  { label: "Not a commonly used password", error: "This password is too common - choose something less predictable", test: (p) => !COMMON_PASSWORDS.has(p.toLowerCase()) },
];

/** Each policy rule and whether `password` meets it (for the live checklist). */
export function passwordRuleChecks(password: string): { label: string; ok: boolean }[] {
  return PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(password) }));
}

export function validatePasswordStrength(password: string): PasswordCheckResult {
  const failed = PASSWORD_RULES.find((r) => !r.test(password));
  return failed ? { valid: false, error: failed.error } : { valid: true };
}

// Have I Been Pwned's k-anonymity range API: only the first 5 hex
// characters of the password's SHA-1 hash are ever sent - HIBP returns
// every suffix it has on file for that prefix (typically several hundred),
// and the match against the real, full hash happens locally. Neither the
// plaintext password nor its full hash ever leaves this server.
//
// Fails OPEN (treats an error/timeout as "not breached") - an HIBP outage
// must never be the reason a legitimate user can't change their password
// or an admin can't create an account. This is a defense-in-depth check on
// top of validatePasswordStrength()'s own local blocklist, not the only
// line of defense.
async function isPasswordBreached(password: string): Promise<boolean> {
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password));
    const sha1 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: AbortSignal.timeout(3000),
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return false;

    const body = await res.text();
    return body.split("\n").some((line) => line.split(":")[0].trim() === suffix);
  } catch {
    return false;
  }
}

// The full gate: local checks first (cheap, no network), then the breach
// check only if those already pass - no point spending a network round
// trip on a password that's already rejected for being too short. Used
// everywhere a password is actually set (change-password, admin create
// user, admin reset user); validatePasswordStrength() alone remains
// available for any purely-synchronous context (e.g. client-side hinting)
// that can't await a network call.
export async function validatePasswordFull(password: string): Promise<PasswordCheckResult> {
  const basic = validatePasswordStrength(password);
  if (!basic.valid) return basic;

  if (await isPasswordBreached(password)) {
    return { valid: false, error: "This password has appeared in a known data breach - choose a different one" };
  }
  return { valid: true };
}
