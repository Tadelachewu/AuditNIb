import crypto from "node:crypto";

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
const COMMON_PASSWORDS = new Set(
  [
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

// Requires: 8+ characters, at least one lowercase, one uppercase, one digit,
// one special character, and not a top-of-the-list common password. This is
// exactly the shape of this app's own seeded demo passwords (e.g.
// "Admin@123", "District@123" - see prisma/seedData.ts) so seeding an
// install doesn't itself fail this check.
export function validatePasswordStrength(password: string): PasswordCheckResult {
  if (password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must include a lowercase letter" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must include an uppercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must include a number" };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, error: "Password must include a special character" };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: "This password is too common - choose something less predictable" };
  }
  return { valid: true };
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
    const sha1 = crypto.createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
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
