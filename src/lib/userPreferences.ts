import { prisma } from "@/lib/prismaClient";
import { logger } from "@/lib/logger";

/**
 * Per-user settings that must outlast a session - kept in the database (table
 * user_preferences), so they follow the user to any browser or computer and
 * stay until the user changes them. Not Redis: it's optional here and a
 * restart could lose them. Used through raw SQL (no prisma generate needed).
 * Until migration 20261021120000_user_preferences is applied, reads return
 * nothing and writes are skipped - the screens just use their defaults.
 */

/** Every preference a user can save, with its check. */
export const PREFERENCE_KEYS = {
  /** Findings table: column id -> shown (true) / hidden (false). */
  "findings.columns": (v: unknown): v is Record<string, boolean> =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length <= 200 &&
    Object.entries(v as object).every(([k, x]) => /^[A-Za-z0-9_.-]{1,64}$/.test(k) && typeof x === "boolean"),
} as const;
export type PreferenceKey = keyof typeof PREFERENCE_KEYS;

export function isPreferenceKey(key: string): key is PreferenceKey {
  return Object.prototype.hasOwnProperty.call(PREFERENCE_KEYS, key);
}

let installed: boolean | null = null;
let checkedAt = 0;
let warned = false;

async function isInstalled(): Promise<boolean> {
  if (installed === true) return true;
  if (installed === false && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('user_preferences') IS NOT NULL AS ok`;
    installed = rows[0]?.ok === true;
  } catch {
    installed = false;
  }
  if (!installed && !warned) {
    warned = true;
    logger.warn({ event: "user_preferences.not_installed" }, "user_preferences table is missing - apply prisma/migrations/20261021120000_user_preferences. Until then saved column choices are not kept.");
  }
  return installed;
}

/** The user's saved value, or null (nothing saved, or the table isn't there yet). */
export async function getPreference<K extends PreferenceKey>(userId: string, key: K): Promise<Record<string, boolean> | null> {
  try {
    if (!(await isInstalled())) return null;
    const rows = await prisma.$queryRaw<{ value: unknown }[]>`SELECT value FROM user_preferences WHERE user_id = ${userId} AND key = ${key}`;
    const value = rows[0]?.value;
    return PREFERENCE_KEYS[key](value) ? value : null;
  } catch (err) {
    logger.warn({ err, event: "user_preferences.read_failed" }, "Could not read a user preference - using the default");
    return null;
  }
}

/** Saves (or replaces) the user's value; false when it can't be kept (table not there yet). */
export async function setPreference(userId: string, key: PreferenceKey, value: Record<string, boolean>): Promise<boolean> {
  if (!(await isInstalled())) return false;
  const json = JSON.stringify(value);
  await prisma.$executeRaw`
    INSERT INTO user_preferences (user_id, key, value, updated_at) VALUES (${userId}, ${key}, ${json}::jsonb, now())
    ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return true;
}
