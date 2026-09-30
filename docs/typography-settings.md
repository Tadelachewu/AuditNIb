# Appearance (fixed)

The app has **one fixed look**; there is no longer an Appearance section in Admin → Settings.

| Setting | Value |
|---|---|
| Font | **Verdana** (with Geneva / DejaVu Sans / the system UI font as fallbacks). It's installed on Windows and macOS, so nothing is downloaded |
| Text size | **Compact**: base size 15 px (93.75%) |
| Text contrast | **High**: secondary text (labels, hints, table sub-text) one shade stronger than standard, in light and dark mode |
| Header & sidebar | **Page**: the same light background as the page, with dark text; follows light/dark mode |

Monospaced text (reference numbers, codes) uses Geist Mono.

**Where it's defined:** `src/app/globals.css` (font, size, contrast shades, `--chrome-*` header/sidebar colours). Changing the look means editing that file, not a setting. The look applies to every page, including sign-in.

**History:** until 2026-09-30 an administrator could choose among 25 fonts, 4 text sizes, 2 contrast levels and 10 header/sidebar colours (stored in `settings.typography`). That option was removed and the column dropped (migration `20260930150000_remove_appearance_settings`).
