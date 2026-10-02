// The username rule - the single source for the server (create-user API)
// and every form that sets one (Add User, Import CSV). Client-safe (no
// server imports). Usernames are matched case-insensitively at sign-in and
// for uniqueness, and can't contain spaces, so the sign-in form trims what
// is typed.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const STARTS_WITH_LETTER = /^[a-zA-Z]/;

export const USERNAME_RULE_TEXT = `Starts with a letter; letters, numbers, dots, dashes and underscores; ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters, no spaces`;

/** The first problem with `username` (already trimmed by the caller), or null when it's valid. */
export function usernameError(username: string): string | null {
  if (!username) return "Username is required";
  if (username.length < USERNAME_MIN_LENGTH) return `Username must be at least ${USERNAME_MIN_LENGTH} characters`;
  if (username.length > USERNAME_MAX_LENGTH) return `Username must be at most ${USERNAME_MAX_LENGTH} characters`;
  if (!USERNAME_PATTERN.test(username)) return "Username may only contain letters, numbers, dots, dashes and underscores";
  if (!STARTS_WITH_LETTER.test(username)) return "Username must start with a letter";
  return null;
}
