import { describe, expect, it } from "vitest";
import { countedChars, messageChars } from "@/lib/communications/plainText";
import { messageProblem } from "@/lib/communications/rules";

// Communications: spaces and line breaks never count toward the limits, and
// the editor's counter uses the server's own rule (same number both sides).
describe("character counting", () => {
  it("spaces, tabs and line breaks don't count", () => {
    expect(countedChars("a b")).toBe(2);
    expect(countedChars("  hello \n\n world  ".replace(/\\n/g, "\n"))).toBe(10);
    expect(countedChars("   ")).toBe(0);
  });
  it("minimum 3 real characters for subject and text", () => {
    expect(messageProblem("a b", "hello")).toMatch(/Subject must be at least 3/);
    expect(messageProblem("abc", "a b")).toMatch(/text must be at least 3/);
    expect(messageProblem("a b c", "a\nb\nc")).toBeNull();
  });
  it("maximum 10,000 counted characters - spaces on top are fine", () => {
    expect(messageProblem("Hello", "x ".repeat(10_000))).toBeNull();
    expect(messageProblem("Hello", "x".repeat(10_001))).toMatch(/at most 10000/);
  });
  it("the counter counts the formatted message the way the server does", () => {
    const html = '<ul><li>One</li><li>Two</li></ul><p><a href="https://nib.test">site</a></p>';
    // Server text: "- One\n- Two\nsite (https://nib.test)" without whitespace.
    expect(messageChars({ html, text: "One Two site" })).toBe(countedChars("- One\n- Two\nsite (https://nib.test)"));
  });
});
