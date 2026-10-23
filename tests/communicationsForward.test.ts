import { describe, expect, it } from "vitest";
import { originalBodyHtml } from "@/lib/communications/richText";

// Forward: the body is the original message itself (formatting kept), safe.
describe("forwarded message body", () => {
  it("a formatted original is kept as it is", () => {
    expect(originalBodyHtml({ bodyHtml: "<p><strong>Hi</strong> team</p>", body: "Hi team" })).toBe("<p><strong>Hi</strong> team</p>");
  });
  it("a plain-text original becomes paragraphs, escaped", () => {
    expect(originalBodyHtml({ bodyHtml: null, body: "line 1\n<b>line 2</b>" })).toBe("<p>line 1</p><p>&lt;b&gt;line 2&lt;/b&gt;</p>");
  });
  it("anything unsafe in a stored original is removed", () => {
    expect(originalBodyHtml({ bodyHtml: "<p>ok</p><script>alert(1)</script>", body: "ok" })).toBe("<p>ok</p>");
  });
});
