import { describe, expect, it } from "vitest";
import { emailHtml, htmlToText, sanitizeMessageHtml } from "@/lib/communications/richText";
import { emailForNotification } from "@/lib/emailQueue/rules";
import type { Database, Notification } from "@/types";

// Formatted Communications messages (Tiptap editor): what the server keeps,
// the plain-text copy, and the email (docs/communications.md).

describe("sanitising the editor's HTML", () => {
  it("keeps the allowed formatting", () => {
    const html = "<h2>Plan</h2><p><strong>Bold</strong>, <em>italic</em>, <u>under</u>, <s>gone</s></p><ul><li><p>One</p></li></ul><ol><li><p>Two</p></li></ol><blockquote><p>Quote</p></blockquote><hr />";
    expect(sanitizeMessageHtml(html)).toBe(html);
  });
  it("<b> / <i> become <strong> / <em>; other tags lose their tag but keep their text", () => {
    expect(sanitizeMessageHtml("<b>a</b><i>b</i>")).toBe("<strong>a</strong><em>b</em>");
    expect(sanitizeMessageHtml("<div><font face=\"x\">Title</font></div><table><tr><td>cell</td></tr></table>")).toBe("Titlecell");
  });
  it("headings 1-6, sub / superscript and highlight are kept", () => {
    const html = "<h1>1</h1><h4>4</h4><h6>6</h6><p>H<sub>2</sub>O x<sup>2</sup> <mark>mark</mark></p>";
    expect(sanitizeMessageHtml(html)).toBe(html);
  });
  it("typography styles are kept with plain values", () => {
    const span = '<span style="color:#b91c1c;background-color:rgb(254, 185, 20);font-family:\'Times New Roman\', Times, serif;font-size:18px;font-weight:600;line-height:1.5">styled</span>';
    expect(sanitizeMessageHtml(`<p style="text-align:center">${span}</p>`)).toBe(`<p style="text-align:center">${span}</p>`);
    expect(sanitizeMessageHtml('<h2 style="text-align:right">t</h2>')).toBe('<h2 style="text-align:right">t</h2>');
    expect(sanitizeMessageHtml('<mark data-color="#fde68a" style="background-color:#fde68a;color:inherit">hl</mark>')).toBe('<mark data-color="#fde68a" style="background-color:#fde68a;color:inherit">hl</mark>');
  });
  it("any other style, or a style with an unsafe value, is removed", () => {
    // Only the allowed properties, and only plain values, survive.
    expect(sanitizeMessageHtml('<span style="position:fixed;top:0;color:#000">x</span>')).toBe('<span style="color:#000">x</span>');
    expect(sanitizeMessageHtml('<span style="background-color:url(https://evil/x.png)">x</span>')).toBe("<span>x</span>");
    expect(sanitizeMessageHtml('<span style="font-family:expression(alert(1))">x</span>')).toBe("<span>x</span>");
    expect(sanitizeMessageHtml('<span style="font-size:500px">x</span>')).toBe("<span>x</span>");
    expect(sanitizeMessageHtml('<span style="font-weight:950">x</span>')).toBe("<span>x</span>");
    expect(sanitizeMessageHtml('<p style="text-align:center;color:red;margin:-999px">x</p>')).toBe('<p style="text-align:center">x</p>');
  });
  it("removes scripts, event handlers, styles, classes, images and frames", () => {
    const evil =
      '<p onclick="steal()" class="x" style="background:url(javascript:alert(1))">Hi</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil"></iframe><style>p{}</style>';
    expect(sanitizeMessageHtml(evil)).toBe("<p>Hi</p>");
  });
  it("links: only http, https and mailto, always opened in a new tab without access back to the app", () => {
    expect(sanitizeMessageHtml('<a href="https://nib.test/x" onclick="x()">Doc</a>')).toBe('<a href="https://nib.test/x" target="_blank" rel="noopener noreferrer nofollow">Doc</a>');
    expect(sanitizeMessageHtml('<a href="mailto:a@nib.test">Mail</a>')).toContain('href="mailto:a@nib.test"');
    // A link that isn't allowed keeps its text but loses the link.
    expect(sanitizeMessageHtml('<a href="javascript:alert(1)">Click</a>')).toBe("Click");
    expect(sanitizeMessageHtml('<a href="data:text/html,x">Click</a>')).toBe("Click");
    expect(sanitizeMessageHtml('<a href="//evil.test">Click</a>')).toBe("Click");
  });
  it("a bad and a good link in one paragraph: the good one stays a proper link", () => {
    expect(sanitizeMessageHtml('<p><a href="javascript:x()">bad</a> and <a href="https://nib.test/doc">good</a></p>')).toBe(
      '<p>bad and <a href="https://nib.test/doc" target="_blank" rel="noopener noreferrer nofollow">good</a></p>'
    );
  });
});

describe("the plain-text copy", () => {
  it("paragraphs and list items on their own lines, links with their address, entities decoded", () => {
    const html = sanitizeMessageHtml('<p>Hello &amp; welcome</p><ul><li><p>One</p></li><li><p>Two</p></li></ul><p>See <a href="https://nib.test/p">the plan</a> &lt;now&gt;</p>');
    expect(htmlToText(html)).toBe("Hello & welcome\n- One\n\n- Two\n\nSee the plan (https://nib.test/p) <now>");
  });
  it("a bare link shows once; line breaks and dividers are kept", () => {
    expect(htmlToText('<p><a href="https://nib.test">https://nib.test</a></p>')).toBe("https://nib.test");
    expect(htmlToText("<p>a<br>b</p><hr><p>c</p>")).toBe("a\nb\n\n----\nc");
  });
  it("formatting only, no text: empty (the message text is required)", () => {
    expect(htmlToText(sanitizeMessageHtml("<p></p><p><strong></strong></p>"))).toBe("");
  });
});

describe("the HTML email", () => {
  const settings = { notification: { provider: "SMTP", smtpHost: "mail", smtpPort: 25, fromAddress: "noreply@nib.test", emailEvents: {} } } as unknown as Database["settings"];
  const users = [{ id: "bc", status: "ACTIVE", email: "bc@nib.test" }] as Database["users"];
  const env = { SMTP_USER: "u", SMTP_PASSWORD: "p", APP_BASE_URL: "https://control360.nib.test" };
  const notification = { id: "n1", recipientUserId: "bc", type: "COMMUNICATION", title: "HO: Plan", message: "From: HO\n\nPlan text", entityType: "Communication", entityId: "m1", readAt: null, createdAt: "" } as Notification;

  it("carries the formatted message, the sender and attachment names (escaped), and the link", () => {
    const html = emailHtml("H<O>", sanitizeMessageHtml("<p><strong>Plan</strong></p>"), ["a<b>.pdf"]);
    const email = emailForNotification({ settings, users }, "bc", notification, env, Date.now(), html)!;
    expect(email.bodyHtml).toContain("<p><strong>From:</strong> H&lt;O&gt;</p><p><strong>Plan</strong></p>");
    expect(email.bodyHtml).toContain("<li>a&lt;b&gt;.pdf</li>");
    expect(email.bodyHtml).toContain('href="https://control360.nib.test/communications/m1"');
    // The plain-text part is still there for mail clients that show text only.
    expect(email.bodyText).toContain("Plan text");
  });
  it("other notifications' emails are unchanged (text, escaped, in a paragraph)", () => {
    const email = emailForNotification({ settings, users }, "bc", { ...notification, message: "a <b>" }, env)!;
    expect(email.bodyHtml.startsWith("<p>a &lt;b&gt;</p>")).toBe(true);
  });
});
