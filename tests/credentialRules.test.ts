import { describe, expect, it } from "vitest";
import { passwordRuleChecks, validatePasswordStrength } from "@/lib/passwordValidation";
import { usernameError, USERNAME_MAX_LENGTH } from "@/lib/usernameValidation";

describe("username rule (shared by the create-user API, Add User form and CSV import)", () => {
  it.each([
    ["", "Username is required"],
    ["ab", "Username must be at least 3 characters"],
    ["a".repeat(USERNAME_MAX_LENGTH + 1), `Username must be at most ${USERNAME_MAX_LENGTH} characters`],
    ["abebe kebede", "Username may only contain letters, numbers, dots, dashes and underscores"],
    ["abebe@nib", "Username may only contain letters, numbers, dots, dashes and underscores"],
  ])("%j -> %s", (value, message) => {
    expect(usernameError(value)).toBe(message);
  });

  it.each(["abe", "abebe.k", "Abebe_K-01", "a".repeat(USERNAME_MAX_LENGTH)])("%j is valid", (value) => {
    expect(usernameError(value)).toBeNull();
  });
});

describe("password policy (shared by every password field and the server)", () => {
  it.each([
    ["Short1!", "Password must be at least 8 characters"],
    ["NOLOWER1!", "Password must include a lowercase letter"],
    ["noupper1!", "Password must include an uppercase letter"],
    ["NoNumber!", "Password must include a number"],
    ["NoSpecial1", "Password must include a special character"],
    ["P@ssw0rd", "This password is too common - choose something less predictable"],
  ])("%j -> %s", (password, error) => {
    expect(validatePasswordStrength(password)).toEqual({ valid: false, error });
  });

  it("a password meeting every rule is valid (e.g. the seeded demo passwords)", () => {
    expect(validatePasswordStrength("Admin@123")).toEqual({ valid: true });
    expect(validatePasswordStrength("Temp#2026-Abebe")).toEqual({ valid: true });
  });

  it("the live checklist and the server check never disagree", () => {
    for (const p of ["", "abc", "Short1!", "NOLOWER1!", "noupper1!", "NoNumber!", "NoSpecial1", "P@ssw0rd", "Admin@123"]) {
      const allMet = passwordRuleChecks(p).every((r) => r.ok);
      expect(allMet).toBe(validatePasswordStrength(p).valid);
    }
  });
});

describe("input rules (src/lib/inputRules.ts)", async () => {
  const r = await import("@/lib/inputRules");
  it("phone: letters can't be typed; Ethiopian numbers need their exact length", () => {
    expect(r.INPUT_FILTERS.phone("vzxghgsdcvgd")).toBe("");
    expect(r.INPUT_FILTERS.phone("09a11-23b4 567")).toBe("0911-234 567");
    expect(r.INPUT_FILTERS.phone("+251+911")).toBe("+251911");
    expect(r.phoneError("hfufuf")).not.toBeNull();
    expect(r.phoneError("12345")).not.toBeNull();
    expect(r.phoneError("094984758")).toMatch(/10 digits starting with 0/); // one digit short
    expect(r.phoneError("09498475812")).not.toBeNull(); // one too many
    expect(r.phoneError("0949847581")).toBeNull();
    expect(r.phoneError("011 123 4567")).toBeNull();
    expect(r.phoneError("+251 94984758")).toMatch(/\+251 followed by 9 digits/);
    expect(r.phoneError("251911234567")).toBeNull();
    expect(r.phoneError("911234567")).not.toBeNull(); // no leading 0 or +251
    expect(r.phoneError("+44 20 7946 0958")).toBeNull(); // another country
    expect(r.phoneError("0911 234 567")).toBeNull();
    expect(r.phoneError("+251 911 234 567")).toBeNull();
    expect(r.phoneError("")).toBeNull();
  });
  it("full name: no digits, needs letters (any script)", () => {
    expect(r.personNameError("888888")).toMatch(/can't contain numbers/);
    expect(r.personNameError("...")).not.toBeNull();
    expect(r.personNameError("Abebe Kebede")).toBeNull();
    expect(r.personNameError("አበበ ከበደ")).toBeNull();
    expect(r.INPUT_FILTERS.personName("Abebe 7778")).toBe("Abebe ");
  });
  it("username must start with a letter", () => {
    expect(usernameError("7778")).toBe("Username must start with a letter");
    expect(r.INPUT_FILTERS.username("abe be!")).toBe("abebe");
  });
  it("names and titles need letters; codes have no spaces", () => {
    expect(r.entityNameError("1234")).not.toBeNull();
    expect(r.entityNameError("Bole Branch")).toBeNull();
    expect(r.titleError("!!!")).not.toBeNull();
    expect(r.codeError("B 001")).not.toBeNull();
    expect(r.codeError("OTHER_CASE")).toBeNull();
  });
  it("finding date: real, not future, within or before its period", () => {
    expect(r.findingDateError("2026-02-30", "2026-10-02")).toMatch(/not a real date/);
    expect(r.findingDateError("2026-10-03", "2026-10-02")).toMatch(/future/);
    expect(r.findingDateError("2026-09-15", "2026-10-02")).toBeNull();
    expect(r.findingDateInPeriodError("2026-10-05", { code: "2026-09", endsAt: "2026-09-30T20:59:00" })).toMatch(/after reporting period/);
  });
  it("amount: not negative, at most 2 decimals", () => {
    expect(r.amountError(-1)).not.toBeNull();
    expect(r.amountError(1.234)).toMatch(/2 decimal/);
    expect(r.amountError("1000.50")).toBeNull();
  });
});
