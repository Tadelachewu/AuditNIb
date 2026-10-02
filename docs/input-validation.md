# Input Validation

Every field is checked **twice, with the same rule**:
1. **In the browser.** Characters a field can never contain are blocked as you type; the field shows its problem under it once you leave it; and the Save / Submit button stays disabled while any rule fails.
2. **On the server.** The API applies the same rule, so nothing invalid is stored even if the browser check is bypassed.

The rules live in one place: `src/lib/inputRules.ts`, plus `src/lib/usernameValidation.ts` and `src/lib/passwordValidation.ts`. Forms use `RuleInput` (`src/components/ui/RuleInput.tsx`); API schemas use the `z*` builders.

## Rules

| Field | Rule | Typing blocked |
|---|---|---|
| **Full name** (users) | 2+ letters (any script, incl. Amharic); letters, spaces, `.` `'` `-` only; no digits; max 100 | digits and other symbols |
| **Username** | Starts with a letter; letters, numbers, `.` `_` `-`; 3–50 characters; no spaces; unique (case-insensitive) | spaces and symbols |
| **Email** | A valid address; max 254 | — |
| **Phone** (optional) | Digits with an optional leading `+`; spaces `-` `.` `(` `)` as separators; **9–15 digits** (e.g. `0911 234 567`, `+251 911 234 567`) | **letters** and other symbols; `+` only at the start |
| **Password** (set / change / reset) | 8+ characters, lowercase, uppercase, number, special character, not a common password; the server also rejects passwords from known data breaches. Live checklist under the field | — |
| **Code** (district, branch, department, category, source, reason) | Letters, numbers, `-` `_`; no spaces; max 30 | spaces and symbols |
| **Role code** | UPPER_SNAKE_CASE, starting with a letter; max 30 | lower case is turned into upper case; other symbols |
| **Name** (district, branch, department, category, source, reason, role, scoring rule) | 2–100 characters, must contain letters (not only numbers or symbols) | — |
| **Finding title** | 3–200 characters, must contain letters | — |
| **Finding date** | A real date, **not in the future**. The **Excel import** additionally requires it to be **within or before the row's reporting period**; registering or editing a finding doesn't | the date picker can't pick future days |
| **Amount** | 0 or more, at most 2 decimal places, up to 1,000,000,000,000 | number field |
| **Number of cases** | Whole number 1–10,000 | number field |
| **Description, root cause, recommendation, evidence note, comment, support message** | Must contain words (not only symbols); max 5,000 | length limit |
| **Reason** (reverse, transfer, return, reject, lock / unlock, import reverse) | 5–500 characters with words | length limit |
| **Rectification** | Cases: whole number; amount: as above; note max 500 | — |
| **Settings lists** (currencies, risk levels, ...) | Letters or numbers, max 100, **no duplicates** (case-insensitive) | — |
| **Email settings** | When email is on: a valid *From address*; for SMTP a valid host (e.g. `smtp.office365.com`) and a port 1–65535 | — |
| **Reporting period** | Valid start / end / submission dates (end after start); name max 100 | — |

## Sign in

Sign in stays disabled until the username has **3+** characters and the password **8+**: the minimum lengths every account has always had. It deliberately does not apply the full username format or password policy, which older accounts may predate. The username is trimmed.

## CSV imports (Add many)

Each row is checked with the same rules before it is sent; a failing row shows its problem in the results.

## Existing data

Rules apply when a value is **entered or changed**. A record saved earlier with a value that breaks a rule (e.g. a user named "888888") keeps it until someone edits it; the edit form then asks for a valid value before it can be saved.
