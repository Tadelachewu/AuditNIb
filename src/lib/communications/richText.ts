import sanitizeHtml from "sanitize-html";
import { escapeHtml } from "@/lib/emailQueue/rules";

/**
 * Formatted Communications messages (docs/communications.md). The editor
 * (Tiptap) sends HTML; the server never trusts it: everything is reduced to
 * the short list below before it is saved, shown or emailed. Server-only.
 *
 * Allowed: paragraphs, line breaks, headings 1-6, bold, italic, underline,
 * strikethrough, sub- / superscript, highlight, bulleted / numbered lists,
 * quotes, a dividing line, links (http, https, mailto - opened in a new
 * tab), and these styles only, each limited to plain values: text colour,
 * highlight colour, font family, font size (up to 72px / 54pt), font weight,
 * line height and text alignment. Nothing else: no scripts, other styles,
 * classes, event handlers, images, iframes or tables.
 */
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/i, /^(inherit|transparent)$/i];
const STYLES: Record<string, RegExp[]> = {
  color: COLOR,
  "background-color": COLOR,
  // Font names only: letters, digits, spaces, quotes, commas and hyphens (no url(), expressions or escapes).
  "font-family": [/^[a-z0-9 ,'"-]{1,200}$/i],
  "font-size": [/^(?:[1-9]|[1-6]\d|7[0-2])(?:\.\d+)?px$/, /^(?:[1-9]|[1-4]\d|5[0-4])(?:\.\d+)?pt$/],
  "font-weight": [/^(normal|bold|[1-9]00)$/],
  "line-height": [/^(?:[0-4](?:\.\d{1,2})?|normal)$/],
  "text-align": [/^(left|right|center|justify)$/],
};
const TEXT_STYLES = { color: STYLES.color, "background-color": STYLES["background-color"], "font-family": STYLES["font-family"], "font-size": STYLES["font-size"], "font-weight": STYLES["font-weight"], "line-height": STYLES["line-height"] };
const BLOCK_STYLES = { "text-align": STYLES["text-align"], "line-height": STYLES["line-height"] };

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "sub", "sup", "span", "mark", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "hr", "a"],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    span: ["style"],
    mark: ["style", "data-color"],
    p: ["style"],
    h1: ["style"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
    h5: ["style"],
    h6: ["style"],
  },
  allowedStyles: {
    span: TEXT_STYLES,
    mark: { "background-color": STYLES["background-color"], color: STYLES.color },
    p: BLOCK_STYLES,
    h1: BLOCK_STYLES,
    h2: BLOCK_STYLES,
    h3: BLOCK_STYLES,
    h4: BLOCK_STYLES,
    h5: BLOCK_STYLES,
    h6: BLOCK_STYLES,
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // Every link opens in a new tab and can't reach back into the app. A link
    // to anything but http(s) / mailto (javascript:, data:, //host ...) keeps
    // its text but loses its address; such address-less links are unwrapped
    // below. (Renaming the tag here instead confuses sanitize-html's closing
    // tags when a bad and a good link share a paragraph.)
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const href = (attribs.href ?? "").trim();
      return /^(https?:\/\/|mailto:)/i.test(href) ? { tagName, attribs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } } : { tagName, attribs: {} };
    },
    b: "strong",
    i: "em",
  },
};

/** The message HTML reduced to the allowed formatting. */
export function sanitizeMessageHtml(html: string): string {
  // Links have no nested links, and an allowed one always has attributes, so a bare <a> is a removed link: keep its text.
  return sanitizeHtml(html, OPTIONS)
    .replace(/<a>([\s\S]*?)<\/a>/g, "$1")
    .trim();
}

// The plain text of a message, and how its characters are counted (shared with the browser).
export { htmlToText } from "./plainText";

/** The email's HTML: who sent it, the formatted message, and the attachment names (the files stay in the app). */
export function emailHtml(senderName: string, messageHtml: string, attachmentNames: string[]): string {
  const files =
    attachmentNames.length > 0
      ? `<p>Attachments (open the message in NIB Control360 to download):</p><ul>${attachmentNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
      : "";
  return `<p><strong>From:</strong> ${escapeHtml(senderName)}</p>${messageHtml}${files}`;
}

/**
 * A forwarded message's body: the original message itself - its formatting
 * kept, or a plain-text message as paragraphs. Sanitised like any message.
 */
export function originalBodyHtml(original: { bodyHtml: string | null; body: string }): string {
  return sanitizeMessageHtml(original.bodyHtml ?? original.body.split(/\n/).map((line) => `<p>${escapeHtml(line)}</p>`).join(""));
}
