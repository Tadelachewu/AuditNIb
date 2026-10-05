import crypto from "node:crypto";

/**
 * Password-reset tokens are stored as this SHA-256 hash, never as sent
 * (security review M2). The emailed link carries the raw token; the reset
 * route hashes what it receives and looks that up. A fast hash is enough
 * here: the token is 32 random bytes, so there's nothing to guess.
 */
export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
