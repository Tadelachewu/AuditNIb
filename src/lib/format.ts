// Every date/number rendered by a Client Component goes through these
// instead of calling toLocaleString()/toLocaleDateString() directly with
// no locale argument, which falls back to the runtime's own default
// locale - and that default can genuinely differ between the Node SSR
// process and the browser (e.g. the server renders "31/08/2026, 21:55:25",
// the browser then computes "8/31/2026, 9:55:25 PM" for the identical
// timestamp on hydration), which is exactly what triggers a hydration
// mismatch and forces React to discard and re-render the whole subtree.
// Pinning "en-US" here means server and client always agree, regardless
// of either environment's own locale configuration.
const LOCALE = "en-US";

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE);
}

export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE);
}
