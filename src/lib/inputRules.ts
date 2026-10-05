import { z } from "zod";
import { usernameError } from "@/lib/usernameValidation";

/**
 * Input rules for every text field the app accepts - ONE source for the
 * API schemas (via the z* builders) and the forms (via the *Error
 * functions, for inline messages before submitting). Client-safe.
 * See docs/input-validation.md.
 *
 * Each *Error function takes the raw value, trims it, and returns the first
 * problem as a sentence (no trailing period), or null when it's valid.
 */

// \p{L} = a letter in any script (Latin, Ge'ez/Amharic, ...).
const LETTER = /\p{L}/u;
const LETTERS = /\p{L}/gu;

export const LIMITS = {
  personName: { min: 2, max: 100 },
  entityName: { min: 2, max: 100 },
  code: { max: 30 },
  title: { min: 3, max: 200 },
  longText: { max: 5000 },
  shortText: { max: 500 },
  reason: { min: 5, max: 500 },
  listItem: { max: 100 },
  email: { max: 254 },
  amount: { max: 1_000_000_000_000 },
  caseCount: { max: 10_000 },
} as const;

const trimmed = (v: string | null | undefined) => (v ?? "").trim();

/** A person's full name: letters (any script), spaces, dots, apostrophes and hyphens; at least 2 letters; no digits. */
export function personNameError(value: string | null | undefined, label = "Full name"): string | null {
  const v = trimmed(value);
  if (!v) return `${label} is required`;
  if (v.length > LIMITS.personName.max) return `${label} must be at most ${LIMITS.personName.max} characters`;
  if (/\d/.test(v)) return `${label} can't contain numbers`;
  if (!/^[\p{L}\p{M} .'’-]+$/u.test(v)) return `${label} may only contain letters, spaces, dots, apostrophes and hyphens`;
  if ((v.match(LETTERS) ?? []).length < LIMITS.personName.min) return `${label} must have at least ${LIMITS.personName.min} letters`;
  return null;
}

/** The name of a record (district, branch, department, category, source, reason, role, rule): must contain a letter. */
export function entityNameError(value: string | null | undefined, label = "Name"): string | null {
  const v = trimmed(value);
  if (!v) return `${label} is required`;
  if (v.length < LIMITS.entityName.min) return `${label} must be at least ${LIMITS.entityName.min} characters`;
  if (v.length > LIMITS.entityName.max) return `${label} must be at most ${LIMITS.entityName.max} characters`;
  if (!LETTER.test(v)) return `${label} must contain letters, not only numbers or symbols`;
  return null;
}

/** A record code (e.g. D01, B001, OTHER_CASE): letters, numbers, dashes and underscores, starting with a letter or number. */
export function codeError(value: string | null | undefined, label = "Code"): string | null {
  const v = trimmed(value);
  if (!v) return `${label} is required`;
  if (v.length > LIMITS.code.max) return `${label} must be at most ${LIMITS.code.max} characters`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v)) return `${label} may only contain letters, numbers, dashes and underscores (no spaces)`;
  return null;
}

/** A role code: UPPER_SNAKE_CASE, starting with a letter (e.g. REGIONAL_AUDITOR). */
export function roleCodeError(value: string | null | undefined): string | null {
  const v = trimmed(value);
  if (!v) return "Code is required";
  if (v.length < 2) return "Code must be at least 2 characters";
  if (v.length > LIMITS.code.max) return `Code must be at most ${LIMITS.code.max} characters`;
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) return "Code must be UPPER_SNAKE_CASE, starting with a letter";
  return null;
}

export function emailError(value: string | null | undefined, label = "Email address"): string | null {
  const v = trimmed(value);
  if (!v) return `${label} is required`;
  if (v.length > LIMITS.email.max) return `${label} must be at most ${LIMITS.email.max} characters`;
  if (!z.email().safeParse(v).success) {
    return label === "Email address"
      ? "Enter a valid email address (e.g. name@nibbank.com.et)"
      : `${label} must be a valid email address (e.g. noreply@nibbank.com.et)`;
  }
  return null;
}

/**
 * A phone number (optional - blank is fine). Digits with an optional leading
 * +, and spaces, dashes, dots or brackets as separators. Ethiopian numbers
 * must have their exact length:
 *   - local:         0 + 9 digits = 10 digits   (0911 234 567, 011 123 4567)
 *   - international: +251 / 251 + 9 digits      (+251 911 234 567)
 * A number with another country code (+ then 8-15 digits) is also accepted.
 */
export function phoneError(value: string | null | undefined): string | null {
  const v = trimmed(value);
  if (!v) return null;
  if (!/^\+?[0-9 ()\-.]+$/.test(v)) return "Phone number may only contain digits, an optional leading +, and spaces, dashes, dots or brackets";
  const digits = v.replace(/\D/g, "");
  const plus = v.startsWith("+");
  const example = "e.g. 0911 234 567 or +251 911 234 567";
  if (digits.startsWith("251")) {
    if (digits.length !== 12) return `Enter a valid Ethiopian number: +251 followed by 9 digits (${example})`;
    if (!/^251[1-9]/.test(digits)) return `Enter a valid Ethiopian number (${example})`;
    return null;
  }
  if (plus) {
    if (digits.length < 8 || digits.length > 15) return `Enter a valid international number: + country code and 8-15 digits in total (${example})`;
    return null;
  }
  if (digits.startsWith("0")) {
    if (digits.length !== 10) return `Enter a valid phone number: 10 digits starting with 0 (${example})`;
    if (digits[1] === "0") return `Enter a valid phone number (${example})`;
    return null;
  }
  return `Enter a valid phone number: 10 digits starting with 0, or +251 followed by 9 digits (${example})`;
}

/** A finding title (when given): 3-200 characters, containing a letter. */
export function titleError(value: string | null | undefined, label = "Title"): string | null {
  const v = trimmed(value);
  if (!v) return null; // required-ness is the admin's "required fields" setting
  if (v.length < LIMITS.title.min) return `${label} must be at least ${LIMITS.title.min} characters`;
  if (v.length > LIMITS.title.max) return `${label} must be at most ${LIMITS.title.max} characters`;
  if (!LETTER.test(v)) return `${label} must contain letters, not only numbers or symbols`;
  return null;
}

/** Free text (description, comment, message, note...): not only symbols, and within the length limit. Blank is handled by the caller. */
export function textError(value: string | null | undefined, label: string, max: number = LIMITS.longText.max): string | null {
  const v = trimmed(value);
  if (!v) return null;
  if (v.length > max) return `${label} must be at most ${max} characters`;
  if (!/[\p{L}\p{N}]/u.test(v)) return `${label} must contain words, not only symbols`;
  return null;
}

/** A reason the user must give (reverse, transfer, return, reject...): 5-500 characters with words in it. */
export function reasonError(value: string | null | undefined, label = "Reason"): string | null {
  const v = trimmed(value);
  if (v.length < LIMITS.reason.min) return `${label} must be at least ${LIMITS.reason.min} characters`;
  return textError(v, label, LIMITS.reason.max);
}

/** An amount of money: a number from 0 up to the limit, at most 2 decimal places. */
export function amountError(value: number | string | null | undefined, label = "Amount"): string | null {
  if (value === null || value === undefined || value === "") return `${label} is required`;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (n < 0) return `${label} can't be negative`;
  if (n > LIMITS.amount.max) return `${label} is too large`;
  if (Math.round(n * 100) / 100 !== n) return `${label} can have at most 2 decimal places`;
  return null;
}

/** A finding date: a real calendar date (YYYY-MM-DD), not in the future. Blank is handled by the caller. */
export function findingDateError(value: string | null | undefined, today: string = localToday()): string | null {
  const v = trimmed(value);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Finding date must be a date (YYYY-MM-DD)";
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return "Finding date is not a real date";
  if (v > today) return "Finding date can't be in the future";
  return null;
}

/**
 * A finding's date must fall within its reporting period or before it -
 * never after the period ends (and, via findingDateError(), never in the
 * future). Applied to registering, editing and the Excel import alike.
 */
export function findingDateInPeriodError(findingDate: string | null | undefined, period: { code: string; endsAt: string }): string | null {
  const v = trimmed(findingDate);
  if (!v) return null;
  const periodEnd = localDateOf(period.endsAt);
  return v > periodEnd ? `Finding date ${v} is after reporting period ${period.code} (ends ${periodEnd}) - it must be within the period or before it` : null;
}

/** The local calendar date (YYYY-MM-DD) of a timestamp. */
export function localDateOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's local date as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** An SMTP server host name (e.g. smtp.office365.com). */
export function hostError(value: string | null | undefined, label = "SMTP host"): string | null {
  const v = trimmed(value);
  if (!v) return `${label} is required`;
  if (v.length > 253 || !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(v)) return `Enter a valid ${label.toLowerCase()} (e.g. smtp.office365.com)`;
  return null;
}

/** A TCP port: a whole number 1-65535. */
export function portError(value: number | string | null | undefined, label = "SMTP port"): string | null {
  if (value === null || value === undefined || value === "") return `${label} is required`;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return `${label} must be a whole number from 1 to 65535`;
  return null;
}

// ---------- typing filters (forms) ----------

/**
 * Remove characters a field can never contain, as the user types or pastes
 * - so e.g. letters simply can't be entered into a phone number. The rules
 * above still run (length, digit count...); these only stop the obviously
 * wrong characters at the keyboard.
 */
export const INPUT_FILTERS = {
  /** Digits, a leading +, spaces, dashes, dots and brackets. */
  phone: (v: string) => v.replace(/[^0-9+ ()\-.]/g, "").replace(/(?!^)\+/g, ""),
  /** Letters, numbers, dots, dashes, underscores - no spaces. */
  username: (v: string) => v.replace(/[^A-Za-z0-9._-]/g, ""),
  /** Record codes: letters, numbers, dashes, underscores - no spaces. */
  code: (v: string) => v.replace(/[^A-Za-z0-9_-]/g, ""),
  /** Role codes: UPPER_SNAKE_CASE. */
  roleCode: (v: string) => v.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
  /** A person's name: no digits or symbols other than . ' and - */
  personName: (v: string) => v.replace(/[^\p{L}\p{M} .'’-]/gu, ""),
} as const;

// ---------- zod builders for the API schemas ----------

type Check = (v: string) => string | null;
const rule = (check: Check) =>
  z
    .string()
    .trim()
    .superRefine((v, ctx) => {
      const problem = check(v);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });
/** Same as rule(), but blank is allowed (becomes ""). */
const optionalRule = (check: Check) => rule((v) => (v ? check(v) : null));

export const zPersonName = (label?: string) => rule((v) => personNameError(v, label));
export const zEntityName = (label?: string) => rule((v) => entityNameError(v, label));
export const zCode = (label?: string) => rule((v) => codeError(v, label));
export const zRoleCode = () => rule((v) => roleCodeError(v));
export const zEmail = () => rule((v) => emailError(v));
export const zUsername = () => rule((v) => usernameError(v));
export const zPhone = () => optionalRule(phoneError);
export const zTitle = () => optionalRule((v) => titleError(v));
export const zText = (label: string, max: number = LIMITS.longText.max) => optionalRule((v) => textError(v, label, max));
export const zRequiredText = (label: string, max: number = LIMITS.longText.max) =>
  rule((v) => (v ? textError(v, label, max) : `${label} is required`));
export const zReason = (label?: string) => rule((v) => reasonError(v, label));
export const zFindingDate = () => optionalRule((v) => findingDateError(v));
export const zAmount = (label = "Amount") =>
  z.number().superRefine((n, ctx) => {
    const problem = amountError(n, label);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
export const zCaseCount = () => z.number().int("Number of cases must be a whole number").min(1, "Number of cases must be at least 1").max(LIMITS.caseCount.max, `Number of cases must be at most ${LIMITS.caseCount.max}`);
/** An item in a settings list (risk levels, currencies, operation areas...). */
export function listItemError(value: string | null | undefined, label: string): string | null {
  const v = trimmed(value);
  if (!v) return `${label} is required`;
  if (v.length > LIMITS.listItem.max) return `${label} must be at most ${LIMITS.listItem.max} characters`;
  if (!/[\p{L}\p{N}]/u.test(v)) return `${label} must contain letters or numbers`;
  return null;
}
export const zListItem = (label: string) => rule((v) => listItemError(v, label));
/** A settings list: each item valid, and no item repeated (case-insensitive). */
export const zUniqueList = (label: string) =>
  z.array(zListItem(label)).superRefine((items, ctx) => {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.toLowerCase();
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `${label} "${item}" is listed twice` });
      seen.add(key);
    }
  });
/** A date/time the browser sends (ISO / datetime-local): required and parseable. */
export const zDateTime = (label: string) => rule((v) => (!v ? `${label} is required` : Number.isNaN(Date.parse(v)) ? `${label} is not a valid date/time` : null));
