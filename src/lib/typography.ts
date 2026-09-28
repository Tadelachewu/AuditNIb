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

export type FontFamilyKey = (typeof FONT_OPTIONS)[number]["key"];
export type TextSizeKey = (typeof TEXT_SIZE_OPTIONS)[number]["key"];
export type TextContrastKey = (typeof TEXT_CONTRAST_OPTIONS)[number]["key"];

export interface Typography {
  fontFamily: FontFamilyKey;
  textSize: TextSizeKey;
  textContrast: TextContrastKey;
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: "geist",
  textSize: "default",
  textContrast: "standard",
};

export const FONT_KEYS = FONT_OPTIONS.map((o) => o.key) as [FontFamilyKey, ...FontFamilyKey[]];
export const TEXT_SIZE_KEYS = TEXT_SIZE_OPTIONS.map((o) => o.key) as [TextSizeKey, ...TextSizeKey[]];
export const TEXT_CONTRAST_KEYS = TEXT_CONTRAST_OPTIONS.map((o) => o.key) as [TextContrastKey, ...TextContrastKey[]];

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

export function typographyCss(t: Typography): string {
  if (
    t.fontFamily === DEFAULT_TYPOGRAPHY.fontFamily &&
    t.textSize === DEFAULT_TYPOGRAPHY.textSize &&
    t.textContrast === DEFAULT_TYPOGRAPHY.textContrast
  ) {
    return "";
  }
  const rootSize = TEXT_SIZE_OPTIONS.find((o) => o.key === t.textSize)?.rootSize ?? "100%";
  let css = `html{font-size:${rootSize};}body{font-family:${fontStack(t.fontFamily)};}`;
  if (t.textContrast === "high") {
    css +=
      `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${HIGH_CONTRAST_LIGHT}}}` +
      `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${HIGH_CONTRAST_DARK}}}` +
      `:root[data-theme="light"]{${HIGH_CONTRAST_LIGHT}}` +
      `:root[data-theme="dark"]{${HIGH_CONTRAST_DARK}}`;
  }
  return css;
}
