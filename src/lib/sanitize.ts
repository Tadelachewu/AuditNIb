import type { User, SafeUser } from "@/types";

export function toSafeUser(user: User): SafeUser {
  const safe: Partial<User> = { ...user };
  delete safe.passwordHash;
  return safe as SafeUser;
}
