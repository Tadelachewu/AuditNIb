import bcrypt from "bcryptjs";

/**
 * bcrypt cost (security review L1): 12 - the usual recommendation; each
 * step doubles the work for an attacker who has stolen the hashes. Older
 * hashes (cost 10) still verify and are upgraded to 12 at the user's next
 * sign-in (see needsRehash()).
 */
export const BCRYPT_COST = 12;

/** Hash a password - async, so a sign-in or password change never blocks other requests while it runs. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** Synchronous hashing, for seed scripts only (no server requests to block). */
export function hashPasswordSync(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** True when a stored hash uses a lower cost than BCRYPT_COST (re-hash it after a successful sign-in). */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < BCRYPT_COST;
  } catch {
    return false;
  }
}

// A fixed hash of an arbitrary string - not a real account's password, never
// matched. The login route compares against it when the username doesn't
// exist, so an unknown username costs the same time as a real one with a
// wrong password (no timing side channel for enumerating usernames). Same
// cost as BCRYPT_COST, so it matches every up-to-date hash.
export const DUMMY_PASSWORD_HASH = "$2b$12$nsQsS6RPq8RsCG2H9msZL.X67OpyyIA82AK.feEJ1NW9sHyGFz5vO";
