import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

// A fixed, precomputed hash of an arbitrary string - not a real account's
// password, never checked against user input for a match. Exists purely so
// the login route can run a bcrypt compare against *something* when the
// username doesn't exist, costing roughly the same CPU time as a real
// verifyPassword() call against an existing user's actual hash. Without
// this, a nonexistent username short-circuits straight past the bcrypt
// compare and responds measurably faster than a real username with a wrong
// password - a timing side channel that lets an attacker enumerate valid
// usernames without ever seeing a different error message.
export const DUMMY_PASSWORD_HASH = "$2b$10$enQPCFRyKe5TuzYQGnX5UeN/VkGTm0dcGG3Fj8p/uLWROCmOAvFke";
