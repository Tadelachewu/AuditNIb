# Typography Settings

Admins can change the font, text size and text contrast for the whole app from **Admin → Settings → Typography**. The default is exactly how the app looked before this setting existed, so nothing changes until an admin saves a different choice.

---

## 1. Who can change it

| Action | Permission |
|---|---|
| See the Typography section | `settings.view` |
| Change it and save | `settings.edit` |

It is one bank-wide setting, not a per-user preference: a saved change applies to every user.

## 2. The options

### 2.1 Font

The font list has two groups.

**Web fonts (bundled with the app).** The app serves these itself, so every user sees exactly the same font on every computer.

| Font | Notes |
|---|---|
| **Geist** | The default. |
| Inter | Very legible at small sizes; a good all-round choice for data-heavy screens. |
| Roboto | The Android and Google font. |
| Open Sans | Friendly and very readable. |
| Lato | Warm, slightly rounded. It has no medium or semibold weight, so those appear as regular or bold. |
| Poppins | Geometric and wide; takes more horizontal space. |
| Montserrat | Geometric and wide, with strong headings. |
| Nunito | Rounded, soft. |
| Source Sans 3 | Adobe's UI font; compact and neutral. |
| Noto Sans | Google's broad-coverage sans. |
| Work Sans | Slightly condensed; fits more text into a row. |
| IBM Plex Sans | Technical and corporate. |
| Noto Sans Ethiopic | Choose this when findings, names or comments contain **Amharic (Ge'ez) text**. It displays Ethiopic script consistently for every user. |

**Installed fonts (from the user's computer).** Nothing is downloaded; each user's computer supplies the font. Windows has all of them. Other systems get the closest equivalent listed below.

| Font | Falls back to (if not installed) |
|---|---|
| System UI | The operating system's own interface font (Segoe UI on Windows, San Francisco on macOS). |
| Arial | Helvetica Neue, Helvetica |
| Verdana | Geneva, DejaVu Sans |
| Tahoma | Verdana, Geneva |
| Trebuchet MS | Lucida Grande |
| Segoe UI | System UI |
| Calibri | Carlito (the metric-compatible Linux copy), Segoe UI |
| Helvetica | Helvetica Neue, Arial |
| Georgia *(serif)* | Times New Roman |
| Times New Roman *(serif)* | Times |
| Cambria *(serif)* | Caladea, Georgia |

Every font falls back to the system sans-serif as a last resort, so a missing or failed font never leaves the app in the browser's default Times.

> **Tip:** serif fonts (Georgia, Times New Roman, Cambria) suit printed reports, but they are harder to read in dense tables and small labels on screen. For the everyday app, a sans-serif is recommended.

### 2.2 Text size

| Option | Scale | When to use |
|---|---|---|
| Compact | 93.75% | Large monitors; fit more rows on screen. |
| **Default** | 100% | The default. |
| Comfortable | 106.25% | Laptops, or users who find the default slightly small. |
| Large | 112.5% | Accessibility; users with low vision. |

The size scales the whole interface, including spacing, padding and column widths, not just the text. Layouts keep their proportions instead of text overflowing its boxes. Because of this, **Large** shows fewer table rows per screen.

### 2.3 Text contrast

| Option | Effect |
|---|---|
| **Standard** | The default. |
| High | Makes secondary text one shade darker: page descriptions, hints, table headers, stat-card labels, timestamps. In dark mode it becomes one shade brighter. |

Headings and body text are already at maximum contrast, so High contrast only affects the muted text.

## 3. Using it

1. Open **Admin → Settings** and expand **Typography**.
2. Choose a font, text size and contrast. Each font in the dropdown is shown in its own face, and the **Preview** box below shows a heading, description, finding row and timestamp in the chosen style, including an Amharic sample.
3. Click **Save Settings** at the bottom of the page. The whole app switches immediately, with no reload needed.
4. **Reset to default** appears whenever the selection differs from the default and restores Geist, Default size and Standard contrast. You still need to click **Save Settings** afterwards.

## 4. Where it applies

- **Applies to** every signed-in page: the sidebar, header, dashboards, findings, reports and admin pages.
- **Does not apply to** the login, forgot-password and reset-password pages. Those load before any user is signed in, so they always use the default look.
- **Exported files** (Excel/PDF) are unaffected; they use their own formatting.
- **Dark mode** keeps working with every combination; the user's own theme toggle still decides light or dark.

## 5. Do we need to install anything?

**Short answer:** usually nothing. No npm package, no server software and no per-user installation. The one thing to check is that **the machine that builds the app can reach Google Fonts**, or goes through a proxy that can (§5.3).

### 5.1 How each kind of font reaches the user

**Web fonts** (Geist, Inter, Roboto, … Noto Sans Ethiopic)

```
next build / next dev  ──downloads once──►  fonts.googleapis.com / fonts.gstatic.com
        │
        ▼
.next/static/media/*.woff2  (font files saved inside the app build)
        │
        ▼
User's browser  ──requests only when that font is selected──►  YOUR app server
```

- The font files are downloaded **once, when the app is built**, and saved into the build output. After that the app serves them from your own server, like its logo or scripts.
- **Users' browsers never contact Google.** This matters for a bank intranet: nothing leaks to a third party, and it works on a network with no internet access.
- A browser only downloads a font's files when that font is actually selected, so the 12 unused alternatives cost users nothing.
- The capability is built into Next.js (`next/font/google`), so there is **no npm package to install**.

**Installed fonts** (Arial, Verdana, Tahoma, Calibri, …)

```
User's browser  ──looks on the user's own computer──►  C:\Windows\Fonts  (or macOS/Linux equivalent)
        │ not found?
        ▼
next font in the fallback stack  ──►  … ──►  system sans-serif
```

- Nothing is downloaded or served; the app just names the font and the user's computer supplies it.
- If the computer doesn't have it, the browser silently tries the next font in the stack (see the table in §2.1). The page never breaks; it just looks slightly different on that machine.

### 5.2 Users' computers

| Font choice | Anything to install on user PCs? |
|---|---|
| Any **web font** | **No.** It's served by the app. |
| Arial, Verdana, Tahoma, Trebuchet MS, Segoe UI, Georgia, Times New Roman | **No** on Windows 10/11, where all are built in. macOS has all except Segoe UI, which falls back to the system font. |
| Calibri, Cambria | Built into Windows and installed with Microsoft Office. On macOS/Linux without Office they fall back (Calibri → Carlito/Segoe UI, Cambria → Caladea/Georgia). |
| System UI | **No.** It is by definition the OS's own font. |

**Recommendation:** if every user must see *exactly* the same thing, for example on shared screenshots or training material, pick a **web font**. Installed fonts are the right choice only when the bank's standard is a specific Windows/Office font such as Calibri or Segoe UI and every workstation is a managed Windows PC.

To make an installed font available everywhere anyway, IT can push it to workstations through the usual software-deployment tooling (Group Policy, Intune, etc.). Nothing in the app needs to change.

### 5.3 The build / deployment machine

This is the only place where network access matters, and only for web fonts.

| Situation | What happens |
|---|---|
| Build machine has internet access | Works; nothing to do. |
| Build machine is behind a **corporate proxy** | Set the proxy before building. The font download honours the standard variables: `HTTPS_PROXY=http://proxy.bank.local:8080` (PowerShell: `$env:HTTPS_PROXY="http://proxy.bank.local:8080"`) then `npm run build`. |
| **`next dev`** with no internet access | Keeps working. The terminal logs `Failed to download 'Inter' from Google Fonts. Using fallback font instead.` and that font shows as a similar system font until the network is back. |
| **`next build`** with no internet access | **The build fails.** Unlike dev, a production build refuses to ship without the real font files. Use the proxy or allow the two hosts below, or switch to local font files (§5.4). |
| **Running** the built app (`next start`) | Needs **no internet access at all**. The fonts are already inside the build. |

Hosts the build machine must reach, over HTTPS port 443:

- `fonts.googleapis.com`: the font stylesheets
- `fonts.gstatic.com`: the font files

The download is cached in `.next/cache`, so repeat builds on the same machine don't fetch again. A clean CI build or a fresh server does.

### 5.4 Fully offline (air-gapped) builds: bundle the font files in the repo

If the build server can never reach the internet, even through a proxy, keep the font files in the repository and load them with `next/font/local` instead of `next/font/google`. The result for users is identical.

1. On any machine with internet access, download each family's `.woff2` files. [Fontsource](https://fontsource.org) and Google Fonts both offer downloads; one variable-weight file per family is enough where available.
2. Put them in the repo, e.g. `src/app/fonts/Inter-Variable.woff2`.
3. In `src/app/layout.tsx`, replace the Google import for that family:

   ```ts
   import localFont from "next/font/local";

   const inter = localFont({
     src: "./fonts/Inter-Variable.woff2",
     variable: "--font-inter",   // keep the same variable name
     preload: false,
     display: "swap",
   });
   ```

   For a family without a variable file, list one file per weight:

   ```ts
   const lato = localFont({
     src: [
       { path: "./fonts/Lato-Regular.woff2", weight: "400", style: "normal" },
       { path: "./fonts/Lato-Bold.woff2", weight: "700", style: "normal" },
     ],
     variable: "--font-lato",
     preload: false,
   });
   ```

4. Nothing else changes. `src/lib/typography.ts` only refers to the `--font-*` variable names, so the Settings dropdown, preview and saved settings keep working.

Families you don't want to bundle can be deleted from `layout.tsx` and `FONT_OPTIONS`. Any install that had one selected falls back to Geist automatically.

### 5.5 After changing the setting

Nothing to install or restart. Saving in **Admin → Settings** applies immediately to every signed-in user on their next page load or navigation. The admin who saved it sees the change at once.

## 6. How it works (for developers)

| Piece | File |
|---|---|
| Option lists, defaults, validation (`normalizeTypography`) and CSS generation (`typographyCss`) | `src/lib/typography.ts` |
| Web fonts loaded with `next/font/google`, all `preload: false` | `src/app/layout.tsx` |
| Injects the generated `<style>` on every signed-in page | `src/app/(app)/layout.tsx` |
| Settings UI and live preview | `src/app/(app)/admin/settings/page.tsx` |
| Save validation (`z.enum` over the option keys) | `src/app/api/admin/settings/route.ts` |
| Storage: `settings.typography` (JSONB, default `{}`) | `prisma/schema.prisma`, migration `20260928090000_settings_typography` |

- **No cost at the default.** `typographyCss()` returns an empty string when every option is at its default, so nothing is injected. Web fonts are declared but not preloaded; a browser only downloads a font's files once a CSS rule actually uses it. An install on Geist downloads none of the alternatives.
- **Cheap per-page read.** The app layout selects only the `typography` column, not the full `readDb()` snapshot. If that read fails for any reason, the page renders with the default look instead of erroring.
- **Text size** sets the root `font-size`. Every Tailwind size and spacing utility is `rem`-based, which is why spacing scales with the text.
- **High contrast** redefines only `--color-slate-400/500/600`. In this app those colours are used almost exclusively for text. The overrides reuse the same light/dark selectors as `globals.css`, so an explicit theme choice still beats the OS setting.
- **Tolerant storage.** `normalizeTypography()` falls back per key to the default. A missing column value, a partial object, or a font removed in a later version never breaks a page.
- **Older clients.** The PATCH route treats `typography` as optional. A settings client that doesn't send it keeps the stored value instead of resetting it.

### Adding a font

1. **Web font:** import it from `next/font/google` in `src/app/layout.tsx` with a `--font-<name>` variable and `preload: false`, and add it to `optionalFontVariables`. Non-variable families need an explicit `weight` list, for example `["400", "500", "600", "700"]`.
2. Add an entry to `FONT_OPTIONS` in `src/lib/typography.ts`: `{ key, label, group: "web", stack: "var(--font-<name>)" }`. For an installed font, use `group: "system"` and a CSS font stack with cross-platform fallbacks instead.
3. That's all. The dropdown, the preview, save validation and normalization all derive from `FONT_OPTIONS`.

Removing an option is safe: any install that had it selected falls back to Geist on the next page load.
