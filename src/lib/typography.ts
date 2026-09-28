// App-wide typography, admin-configurable from /admin/settings'
// "Typography" section. Client-safe (no server imports): the Settings page
// uses the option lists and typographyCss() for its live preview, and
// (app)/layout.tsx injects the same typographyCss() output on every page.
//
// DEFAULT_TYPOGRAPHY is exactly what the app looked like before this
// setting existed, so an install that never touches it sees no change.

// Two kinds of font:
//  - "web": bundled via next/font (see src/app/layout.tsx), served from
//    this app itself, so every user sees exactly the same face.
//  - "system": fonts already installed on the user's computer (no
//    download at all). Each stack lists the closest cross-platform
//    equivalents, so a Mac or Linux user without e.g. Calibri still gets
//    a similar font rather than the browser default.
export const FONT_OPTIONS = [
  { key: "geist", label: "Geist (default)", group: "web", stack: "var(--font-geist-sans)" },
  { key: "inter", label: "Inter", group: "web", stack: "var(--font-inter)" },
  { key: "roboto", label: "Roboto", group: "web", stack: "var(--font-roboto)" },
  { key: "open-sans", label: "Open Sans", group: "web", stack: "var(--font-open-sans)" },
  { key: "lato", label: "Lato", group: "web", stack: "var(--font-lato)" },
  { key: "poppins", label: "Poppins", group: "web", stack: "var(--font-poppins)" },
  { key: "montserrat", label: "Montserrat", group: "web", stack: "var(--font-montserrat)" },
  { key: "nunito", label: "Nunito", group: "web", stack: "var(--font-nunito)" },
  { key: "source-sans-3", label: "Source Sans 3", group: "web", stack: "var(--font-source-sans-3)" },
  { key: "noto-sans", label: "Noto Sans", group: "web", stack: "var(--font-noto-sans)" },
  { key: "work-sans", label: "Work Sans", group: "web", stack: "var(--font-work-sans)" },
  { key: "ibm-plex-sans", label: "IBM Plex Sans", group: "web", stack: "var(--font-ibm-plex-sans)" },
  { key: "noto-sans-ethiopic", label: "Noto Sans Ethiopic (Amharic-friendly)", group: "web", stack: "var(--font-noto-sans-ethiopic)" },
  { key: "system", label: "System UI (the OS's own font)", group: "system", stack: "system-ui, -apple-system" },
  { key: "arial", label: "Arial", group: "system", stack: 'Arial, "Helvetica Neue", Helvetica' },
  { key: "verdana", label: "Verdana", group: "system", stack: 'Verdana, Geneva, "DejaVu Sans"' },
  { key: "tahoma", label: "Tahoma", group: "system", stack: "Tahoma, Verdana, Geneva" },
  { key: "trebuchet", label: "Trebuchet MS", group: "system", stack: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode"' },
  { key: "segoe-ui", label: "Segoe UI", group: "system", stack: '"Segoe UI", system-ui, -apple-system' },
  { key: "calibri", label: "Calibri", group: "system", stack: 'Calibri, Carlito, "Segoe UI"' },
  { key: "helvetica", label: "Helvetica", group: "system", stack: '"Helvetica Neue", Helvetica, Arial' },
  { key: "georgia", label: "Georgia (serif)", group: "system", stack: 'Georgia, "Times New Roman", serif' },
  { key: "times", label: "Times New Roman (serif)", group: "system", stack: '"Times New Roman", Times, serif' },
  { key: "cambria", label: "Cambria (serif)", group: "system", stack: "Cambria, Caladea, Georgia, serif" },
] as const;

export const FONT_GROUPS = [
  { key: "web", label: "Web fonts (bundled with the app)" },
  { key: "system", label: "Installed fonts (from the user's computer)" },
] as const;

// Applied as the root font-size. Every Tailwind size/spacing utility is
// rem-based, so this scales text *and* the spacing around it together -
// layouts keep their proportions instead of text overflowing its boxes.
export const TEXT_SIZE_OPTIONS = [
  { key: "compact", label: "Compact", rootSize: "93.75%" },
  { key: "default", label: "Default", rootSize: "100%" },
  { key: "comfortable", label: "Comfortable", rootSize: "106.25%" },
  { key: "large", label: "Large", rootSize: "112.5%" },
] as const;

export const TEXT_CONTRAST_OPTIONS = [
  { key: "standard", label: "Standard (default)" },
  { key: "high", label: "High - secondary text one shade stronger" },
] as const;

// Sidebar + topbar ("chrome") color. Each option is a full palette for the
// --chrome-* tokens in globals.css (bg, text, secondary text, section
// label accent, hover wash, border, scrollbar) - text flips along with the
// background, so a light option gets dark text instead of white-on-white.
// The dark options are fixed colors (brand chrome, the same in both
// themes, like the bronze default). The light options reference the
// app's own theme-remapped surface/text tokens, so they follow the
// light/dark toggle automatically: "White" is the card surface, "Soft" one
// shade off it, and "Page" is exactly the page background (slate-100, see
// (app)/layout.tsx), separated from the content only by its border.
// Every dark option's white text and gold section labels clear WCAG AA.
export const CHROME_OPTIONS = [
  {
    key: "bronze",
    label: "Bronze (default)",
    group: "dark",
    swatch: "#4e390e",
    // Same values as globals.css's own --chrome-* defaults - listed so the
    // Settings preview can render this option explicitly too.
    vars: { bg: "var(--brand-sidebar)", fg: "#ffffff", muted: "rgb(255 255 255 / 0.75)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.1)", border: "rgb(255 255 255 / 0.1)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "deep-bronze",
    label: "Deep bronze",
    group: "dark",
    swatch: "#2e2108",
    vars: { bg: "#2e2108", fg: "#ffffff", muted: "rgb(255 255 255 / 0.75)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.1)", border: "rgb(255 255 255 / 0.1)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "navy",
    label: "Navy",
    group: "dark",
    swatch: "#12294a",
    vars: { bg: "#12294a", fg: "#ffffff", muted: "rgb(255 255 255 / 0.75)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.1)", border: "rgb(255 255 255 / 0.1)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "midnight",
    label: "Midnight",
    group: "dark",
    swatch: "#0f172a",
    vars: { bg: "#0f172a", fg: "#ffffff", muted: "rgb(255 255 255 / 0.72)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.08)", border: "rgb(255 255 255 / 0.08)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "charcoal",
    label: "Charcoal",
    group: "dark",
    swatch: "#1f2937",
    vars: { bg: "#1f2937", fg: "#ffffff", muted: "rgb(255 255 255 / 0.72)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.08)", border: "rgb(255 255 255 / 0.08)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "forest",
    label: "Forest green",
    group: "dark",
    swatch: "#123a2b",
    vars: { bg: "#123a2b", fg: "#ffffff", muted: "rgb(255 255 255 / 0.75)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.1)", border: "rgb(255 255 255 / 0.1)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "burgundy",
    label: "Burgundy",
    group: "dark",
    swatch: "#4a1622",
    vars: { bg: "#4a1622", fg: "#ffffff", muted: "rgb(255 255 255 / 0.75)", accent: "var(--brand-gold)", hover: "rgb(255 255 255 / 0.1)", border: "rgb(255 255 255 / 0.1)", scroll: "rgb(255 255 255 / 0.18)" },
  },
  {
    key: "light",
    label: "White",
    group: "light",
    swatch: "#ffffff",
    vars: { bg: "var(--color-white)", fg: "var(--color-slate-900)", muted: "var(--color-slate-600)", accent: "var(--color-amber-700)", hover: "var(--color-slate-100)", border: "var(--color-slate-200)", scroll: "var(--color-slate-300)" },
  },
  {
    key: "soft",
    label: "Soft",
    group: "light",
    swatch: "#f8fafc",
    vars: { bg: "var(--color-slate-50)", fg: "var(--color-slate-900)", muted: "var(--color-slate-600)", accent: "var(--color-amber-700)", hover: "var(--color-slate-200)", border: "var(--color-slate-200)", scroll: "var(--color-slate-300)" },
  },
  {
    key: "page",
    label: "Page (same as the page background)",
    group: "light",
    swatch: "#f1f5f9",
    vars: { bg: "var(--color-slate-100)", fg: "var(--color-slate-900)", muted: "var(--color-slate-600)", accent: "var(--color-amber-700)", hover: "var(--color-slate-200)", border: "var(--color-slate-200)", scroll: "var(--color-slate-300)" },
  },
] as const;

export const CHROME_GROUPS = [
  { key: "dark", label: "Dark - white text, same in light and dark mode" },
  { key: "light", label: "Light - dark text, follows light/dark mode" },
] as const;

export type FontFamilyKey = (typeof FONT_OPTIONS)[number]["key"];
export type ChromeKey = (typeof CHROME_OPTIONS)[number]["key"];
export type TextSizeKey = (typeof TEXT_SIZE_OPTIONS)[number]["key"];
export type TextContrastKey = (typeof TEXT_CONTRAST_OPTIONS)[number]["key"];

export interface Typography {
  fontFamily: FontFamilyKey;
  textSize: TextSizeKey;
  textContrast: TextContrastKey;
  // Header & sidebar color. Stored in the same settings.typography JSON
  // column as the text options (it's the same "Appearance" section in
  // Settings), so adding it needed no migration.
  chrome: ChromeKey;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: "geist",
  textSize: "default",
  textContrast: "standard",
  chrome: "bronze",
};

export const FONT_KEYS = FONT_OPTIONS.map((o) => o.key) as [FontFamilyKey, ...FontFamilyKey[]];
export const TEXT_SIZE_KEYS = TEXT_SIZE_OPTIONS.map((o) => o.key) as [TextSizeKey, ...TextSizeKey[]];
export const TEXT_CONTRAST_KEYS = TEXT_CONTRAST_OPTIONS.map((o) => o.key) as [TextContrastKey, ...TextContrastKey[]];
export const CHROME_KEYS = CHROME_OPTIONS.map((o) => o.key) as [ChromeKey, ...ChromeKey[]];

// Tolerates a missing/partial/stale stored value (a row predating the
// column, an option removed in a later version) by falling back per key.
export function normalizeTypography(value: unknown): Typography {
  const v = (value ?? {}) as Partial<Record<keyof Typography, unknown>>;
  const pick = <K extends string>(keys: readonly K[], x: unknown, fallback: K): K =>
    keys.includes(x as K) ? (x as K) : fallback;
  return {
    fontFamily: pick(FONT_KEYS, v.fontFamily, DEFAULT_TYPOGRAPHY.fontFamily),
    textSize: pick(TEXT_SIZE_KEYS, v.textSize, DEFAULT_TYPOGRAPHY.textSize),
    textContrast: pick(TEXT_CONTRAST_KEYS, v.textContrast, DEFAULT_TYPOGRAPHY.textContrast),
    chrome: pick(CHROME_KEYS, v.chrome, DEFAULT_TYPOGRAPHY.chrome),
  };
}

// Every stack ends in a generic system sans-serif, so a face that fails to
// load (or isn't installed) degrades to a clean UI font, not Times.
const FALLBACK_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function fontStack(key: FontFamilyKey): string {
  const stack = FONT_OPTIONS.find((o) => o.key === key)?.stack;
  return stack ? `${stack}, ${FALLBACK_STACK}` : FALLBACK_STACK;
}

// High contrast shifts only the secondary-text shades (slate-400/500/600 -
// in this app those are used almost exclusively as text colors, see
// globals.css) one step toward the strongest text color, in both themes.
// Scoped with the same light/dark selectors globals.css uses so an
// explicit theme choice still wins over the OS setting.
const HIGH_CONTRAST_LIGHT = "--color-slate-400:#64748b;--color-slate-500:#475569;--color-slate-600:#334155;";
const HIGH_CONTRAST_DARK = "--color-slate-400:#94a3b8;--color-slate-500:#cbd5e1;--color-slate-600:#e2e8f0;";

/** The --chrome-* custom properties for a chrome option, as a style object. */
export function chromeStyle(key: ChromeKey): Record<string, string> {
  const vars = CHROME_OPTIONS.find((o) => o.key === key)?.vars ?? CHROME_OPTIONS[0].vars;
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [`--chrome-${k}`, v]));
}

/** The same, as CSS declarations ("" for the default, which globals.css already sets). */
export function chromeVars(key: ChromeKey): string {
  if (key === DEFAULT_TYPOGRAPHY.chrome) return "";
  return Object.entries(chromeStyle(key))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
}

export function isDefaultTypography(t: Typography): boolean {
  return (Object.keys(DEFAULT_TYPOGRAPHY) as (keyof Typography)[]).every((k) => t[k] === DEFAULT_TYPOGRAPHY[k]);
}

export function typographyCss(t: Typography): string {
  if (isDefaultTypography(t)) return "";
  const rootSize = TEXT_SIZE_OPTIONS.find((o) => o.key === t.textSize)?.rootSize ?? "100%";
  let css = `html{font-size:${rootSize};}body{font-family:${fontStack(t.fontFamily)};}`;
  // :root:root beats globals.css's plain :root defaults regardless of
  // stylesheet order, without reaching for !important.
  const chrome = chromeVars(t.chrome);
  if (chrome) css += `:root:root{${chrome}}`;
  if (t.textContrast === "high") {
    css +=
      `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${HIGH_CONTRAST_LIGHT}}}` +
      `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${HIGH_CONTRAST_DARK}}}` +
      `:root[data-theme="light"]{${HIGH_CONTRAST_LIGHT}}` +
      `:root[data-theme="dark"]{${HIGH_CONTRAST_DARK}}`;
  }
  return css;
}
