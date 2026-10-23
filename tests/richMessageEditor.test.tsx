// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { messageExtensions, RichMessageEditor } from "@/components/communications/RichMessageEditor";
import { sanitizeMessageHtml } from "@/lib/communications/richText";

// The Communications editor (Tiptap + mui-tiptap): it renders with its
// toolbar, and everything its toolbar can produce survives the server's
// sanitising unchanged.

afterEach(cleanup);

describe("RichMessageEditor", () => {
  it("shows the formatting toolbar and an editable box", async () => {
    render(<RichMessageEditor id="comm-body" placeholder="Write your message" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Write your message" })).toBeTruthy());
    expect(screen.getByRole("textbox", { name: "Write your message" }).getAttribute("contenteditable")).toBe("true");
    for (const name of [/bold/i, /italic/i, /underline/i, /subscript/i, /superscript/i, /text color/i, /highlight/i, /bulleted list|bullet/i, /link/i]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
  });

  it("starts with the given content (a forwarded message's body)", async () => {
    render(<RichMessageEditor id="comm-body" placeholder="Write your message" onChange={vi.fn()} initialHtml="<p><strong>Original</strong> message text</p>" />);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Write your message" }).textContent).toContain("Original message text"));
    expect(screen.getByRole("textbox", { name: "Write your message" }).innerHTML).toContain("<strong>Original</strong>");
  });

  it("everything the toolbar produces is kept by the server", () => {
    const editor = new Editor({ extensions: messageExtensions("x") });
    const c = () => editor.chain().focus("end");
    for (let level = 1; level <= 6; level++) {
      c().insertContent(`<h${level}>Heading ${level}</h${level}>`).run();
    }
    c().insertContent("<p>Styled</p>").run();
    c().selectParentNode().setFontFamily("'Times New Roman', Times, serif").setFontSize("18px").setFontWeight("600").setLineHeight("1.5").setColor("#b91c1c").setTextAlign("center").run();
    c().insertContent("<p>Marked</p>").run();
    c().selectParentNode().setHighlight({ color: "#fde68a" }).toggleBold().toggleItalic().toggleUnderline().toggleStrike().run();
    c().insertContent("<p>H<sub>2</sub>O x<sup>2</sup> <a href=\"https://nib.test/doc\">link</a></p><ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol><blockquote><p>quote</p></blockquote><hr>").run();

    const html = editor.getHTML();
    editor.destroy();
    // Compare ignoring the space after ':' / ';' in style values, which the sanitiser normalises.
    // Also ignore the order of a link's attributes.
    const norm = (h: string) =>
      h
        .replace(/:\s+/g, ":")
        .replace(/;\s*/g, ";")
        .replace(/;"/g, '"')
        .replace(/<hr\s*\/?>/g, "<hr>")
        .replace(/<a target="_blank" rel="noopener noreferrer nofollow" href="([^"]*)">/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">');
    expect(norm(sanitizeMessageHtml(html))).toBe(norm(html));
    for (const part of ["<h1", "<h6", "font-family", "font-size:18px", "font-weight:600", "line-height:1.5", "color:rgb(185, 28, 28)", "text-align:center", "<mark", "<sub>", "<sup>", "<strong>", "<em>", "<u>", "<s>"]) {
      expect(norm(html)).toContain(part);
    }
  });
});
