/**
 * A message's plain text and how its characters are counted - one rule for
 * the editor's counter (browser) and the server's checks, so the number the
 * user sees is exactly the number checked. No server-only imports here.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/**
 * The plain-text version of (sanitised) message HTML: paragraphs and list
 * items on their own lines, list items with "- ", links as "text (address)".
 * Used for search, previews, the bell notification, the length limit and
 * the plain-text part of the email.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      const url = href.replace(/&amp;/g, "&");
      return !label || label === url || `mailto:${label}` === url ? url : `${label} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/(p|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n----\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#39|[a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Characters that count toward the limits: everything except spaces and line breaks (any whitespace). */
export function countedChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** The counted characters of what the editor holds: its HTML turned into the server's plain text. */
export function messageChars(value: { html: string; text: string }): number {
  return countedChars(value.html ? htmlToText(value.html) : value.text);
}
