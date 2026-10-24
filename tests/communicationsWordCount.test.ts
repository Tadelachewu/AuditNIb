import { describe, expect, it } from "vitest";
import { countWords, countedChars, messageWords } from "@/lib/communications/plainText";
import { messageProblem } from "@/lib/communications/rules";

// Communications: the message is counted in words, like Microsoft Word, and
// the editor's counter uses the server's own rule (same number both sides).
// The minimum stays 3 characters (spaces don't count).
describe("word counting", () => {
  it("counts words between spaces and line breaks", () => {
    expect(countWords("Hello world")).toBe(2);
    expect(countWords("  one\n\ntwo\tthree  ")).toBe(3);
    expect(countWords("   ")).toBe(0);
    // Punctuation alone isn't a word; joined to a word it is part of it.
    expect(countWords("Done - see the e-mail, please.")).toBe(5);
    expect(countWords("ሰላም ዓለም")).toBe(2);
  });
  it("minimum 3 real characters for subject and text", () => {
    expect(messageProblem("a b", "hello")).toMatch(/Subject must be at least 3/);
    expect(messageProblem("abc", "a b")).toMatch(/text must be at least 3/);
    expect(messageProblem("a b c", "a\nb\nc")).toBeNull();
    expect(countedChars("a b")).toBe(2);
  });
  it("maximum 10,000 words", () => {
    expect(messageProblem("Hello", "word ".repeat(10_000))).toBeNull();
    expect(messageProblem("Hello", "word ".repeat(10_001))).toMatch(/at most 10,000 words/);
    // A formatted message is checked on its visible words.
    expect(messageProblem("Hello", "Long text", 10_001)).toMatch(/10,000 words/);
  });
  it("the counter counts the formatted message's visible words", () => {
    const html = '<ul><li>One</li><li>Two</li></ul><p><a href="https://nib.test">our site</a> and&nbsp;more</p><p>end<br>line</p>';
    // One, Two, our, site, and, more, end, line - no bullets, no link address.
    expect(messageWords({ html, text: "" })).toBe(8);
    expect(messageWords({ html: "", text: "plain text here" })).toBe(3);
  });
});

