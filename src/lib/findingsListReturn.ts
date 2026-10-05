/**
 * "← Back" from a finding returns to the Findings list exactly as it was left
 * (filters, search, sort, page): the list remembers its full address in this
 * tab's sessionStorage, and the detail page's Back link reads it. Falls back
 * to the plain list when nothing is remembered (e.g. a link opened directly).
 */
const KEY = "findings:lastListUrl";

export function rememberFindingsListUrl(url: string): void {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    // Storage unavailable (private mode etc.) - Back just opens the plain list.
  }
}

export function findingsListReturnUrl(): string {
  try {
    const url = sessionStorage.getItem(KEY);
    if (url && url.startsWith("/findings")) return url;
  } catch {
    // ignore
  }
  return "/findings";
}
