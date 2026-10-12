import { describe, expect, it } from "vitest";
import { listItemError, looseListItemError, zUniqueList } from "@/lib/inputRules";

// Settings -> Configurable Lists: letters and single spaces only, at least 2 letters.

describe("Configurable List values", () => {
  const ok = (v: string) => expect(listItemError(v, "Value")).toBeNull();
  const bad = (v: string, why: RegExp) => expect(listItemError(v, "Value")).toMatch(why);

  it("accepts words: letters and single spaces, any script", () => {
    for (const v of ["ETB", "Low", "Account Opening", "Unauthorized Transaction", "  Vault  ", "ብር", "Crédit", "ab"]) ok(v);
  });

  it("refuses numbers", () => {
    for (const v of ["Level 1", "24", "A1", "Tier2 Risk"]) bad(v, /can't contain numbers/);
  });

  it("refuses special characters", () => {
    for (const v of ["ATM/Cards", "Cash & Vault", "High-Risk", "Fraud!", "Loan_Processing", "N.A", "Teller (Counter)", "USD$"]) bad(v, /only contain letters and spaces/);
  });

  it("refuses values shorter than 2 letters, blanks and doubled spaces", () => {
    bad("A", /at least 2 letters/);
    bad("", /is required/);
    bad("   ", /is required/);
    bad("Cash  Excess", /two spaces in a row/);
    bad("x".repeat(101), /at most 100 characters/);
  });

  it("a whole list: every value checked, the offending one named, no duplicates", () => {
    const list = zUniqueList("Operation area");
    expect(list.safeParse(["Vault", "Fund Transfer"]).success).toBe(true);
    const digits = list.safeParse(["Vault", "ATM 24"]);
    expect(digits.success).toBe(false);
    expect(digits.error!.issues[0].message).toBe(`Operation area can't contain numbers: "ATM 24"`);
    expect(list.safeParse(["Vault", "vault"]).error!.issues[0].message).toMatch(/listed twice/);
  });

  it("lists built from existing data keep the looser rule", () => {
    expect(looseListItemError("ATM/Cards 24", "Operation area")).toBeNull();
    expect(zUniqueList("Operation area", looseListItemError).safeParse(["ATM/Cards 24"]).success).toBe(true);
    expect(looseListItemError("---", "Operation area")).toMatch(/letters or numbers/);
  });
});
