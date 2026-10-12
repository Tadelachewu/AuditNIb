import { describe, expect, it } from "vitest";
import { listItemError, looseListItemError, zUniqueList } from "@/lib/inputRules";

// Settings -> Configurable Lists: 2 to 100 characters, at least one letter
// or number. Numbers and special characters are allowed.

describe("Configurable List values", () => {
  const ok = (v: string) => expect(listItemError(v, "Value")).toBeNull();
  const bad = (v: string, why: RegExp) => expect(listItemError(v, "Value")).toMatch(why);

  it("accepts letters, numbers and special characters, any script", () => {
    for (const v of ["ETB", "Low", "Account Opening", "Level 1", "24", "A1", "ATM/Cards", "Cash & Vault", "High-Risk", "Teller (Counter)", "USD$", "  Vault  ", "ብር", "ab"]) ok(v);
  });

  it("keeps the length rule: at least 2 characters, at most 100", () => {
    bad("A", /at least 2 characters/);
    bad("7", /at least 2 characters/);
    bad(" x ", /at least 2 characters/);
    bad("x".repeat(101), /at most 100 characters/);
    ok("x".repeat(100));
  });

  it("refuses blanks and values with no letter or number at all", () => {
    bad("", /is required/);
    bad("   ", /is required/);
    bad("--", /letters or numbers/);
    bad("&/!", /letters or numbers/);
  });

  it("a whole list: every value checked, the offending one named, no duplicates", () => {
    const list = zUniqueList("Operation area");
    expect(list.safeParse(["Vault", "ATM 24", "Cash & Vault"]).success).toBe(true);
    const short = list.safeParse(["Vault", "X"]);
    expect(short.success).toBe(false);
    expect(short.error!.issues[0].message).toBe(`Operation area must be at least 2 characters: "X"`);
    expect(list.safeParse(["Vault", "vault"]).error!.issues[0].message).toMatch(/listed twice/);
  });

  it("lists built from existing data keep the looser rule (no minimum length)", () => {
    expect(looseListItemError("X", "Operation area")).toBeNull();
    expect(zUniqueList("Operation area", looseListItemError).safeParse(["X", "ATM/Cards 24"]).success).toBe(true);
    expect(looseListItemError("---", "Operation area")).toMatch(/letters or numbers/);
  });
});
