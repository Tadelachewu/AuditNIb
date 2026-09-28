# Sign-in Background: Built from the Logo

How the curved brown and gold background behind the sign-in, forgot-password and reset-password pages was designed and built, and a ready-to-use prompt for recreating the same idea from a different logo in another app.

- **Component:** [`src/components/auth/AuthBackdrop.tsx`](../src/components/auth/AuthBackdrop.tsx)
- **Used by:** `src/app/login/page.tsx`, `src/app/forgot-password/page.tsx`, `src/components/auth/ResetPasswordClient.tsx`

---

## 1. What it is

It is **not an image file**. It is an **inline SVG**: shapes described in code that the browser draws.

| | Inline SVG (what we did) | A background image (PNG/JPG) |
|---|---|---|
| Download | None, it's part of the page code (~1 KB) | An extra file request, often 100 KB+ |
| Sharpness | Redrawn at the screen's exact size, never blurry | Blurry when scaled past its own resolution |
| Changing it | Edit a few numbers (colors, positions, opacity) | Open a design tool and re-export |
| Fits any screen | Crops smartly (`slice`, see §4.4) | Needs several versions for different screens |

The only real image on the page is the small logo in the panel, `public/Nib_International_Bank.png`.

---

## 2. Step 1: read the logo

The design is taken directly from the logo rather than invented. Looking at `Nib_International_Bank.png`:

| Logo feature | What we took from it |
|---|---|
| Circle, split into two halves | Two big color regions filling the screen |
| **Brown** upper half (`#8a4d21`) | The upper region |
| **Gold** lower half (`#feb914`) | The lower region |
| A **zigzag** dividing line, low on the left, a peak, a long slope down to a valley, then up to the right, like a stylised "N" | The dividing line, stretched across the screen |
| Every corner of the zigzag is **rounded**, not sharp | Rounded peaks and valleys |
| A **white ribbon** (gap) between the two halves | A light gap between brown and gold |
| The round **outline** of the whole logo | Two large faint circles in the background |

The brown and gold values match the app's `--brand-brown` and `--brand-gold` in `src/app/globals.css`, which were sampled from the logo.

---

## 3. Step 2: turn the zigzag into coordinates

The SVG uses a fixed drawing grid of **1440 × 900** (`viewBox="0 0 1440 900"`), a typical desktop screen shape. Everything below is in that grid; the browser scales it to the real screen.

The zigzag's centre line, left to right:

```
(-20, 660)  start: low on the left, just off-screen
(360, 300)  PEAK:   rounded
(950, 700)  VALLEY: rounded
(1460, 250) end:    high on the right, just off-screen
```

Two design choices:
- **Start and end just off-screen** (x = −20 and 1460). This way no edge of a shape is ever visible at the screen border, even with rounding.
- **The peak is left of centre and the valley right of centre, as in the logo.** The sign-in panel sits over the middle of the screen, on the long downward slope between them, so the curve frames the panel instead of hiding behind it.

---

## 4. Step 3: the drawing, layer by layer

SVG draws in order, so later layers sit on top. There are six layers.

### 4.1 Page background: the ribbon color

The wrapper `<div>` has `bg-[#fbf8f2]`, a warm off-white. Nothing is drawn over the strip between the brown and gold shapes, so this color shows through there and **becomes the ribbon**.

### 4.2 The brown shape (everything above the zigzag)

```
M -20 -20              start above the top-left corner
H 1460                 straight across the top
V 250                  down the right edge to where the zigzag ends
L 1010 640             along the zigzag, right → left, heading for the valley
Q 950 700 885 650      ROUND the valley (see below)
L 430 330              up the long slope to the peak
Q 360 275 300 340      ROUND the peak
L -20 660              down to the left edge
Z                      close the shape
```

**How the rounding works (`Q`).** A sharp corner would be `… L 950 700 L 885 650 …`. Instead, the path stops about 60 units before the corner and draws a *quadratic curve* (`Q`) to about 60 units after it. The corner point itself is used as the curve's *control point*:

```
Q  950 700   885 650
   └─ corner └─ where the curve ends
      (pulls the curve towards it, but the line never touches it)
```

The result is a soft, rounded corner like the logo's. **A bigger gap between the stopping point and the corner gives a rounder corner.**

The fill is a gradient (`#6f3d18` at the top → `#8a4d21`), so the brown is slightly deeper at the top of the screen, for depth.

### 4.3 The gold shape (everything below the zigzag)

The **same zigzag moved about 100 units down**, closed along the bottom of the screen:

```
M -20 760  L 300 440  Q 360 375 430 430  L 885 750  Q 950 800 1010 740  L 1460 350  V 920  H -20  Z
```

The vertical gap between the brown shape's bottom edge and the gold shape's top edge is the **ribbon**. To make the ribbon wider or thinner, move the whole gold path down or up.

The fill is a diagonal gradient (`#feb914` → `#f5a800`), which gives a subtle warm shine.

### 4.4 Two sheens (depth)

These are two more copies of the zigzag, drawn as **lines** rather than filled shapes. They're thick (`strokeWidth` 60 and 40), **white at 8% and 14% opacity**, and have rounded joins. One runs inside the brown area and one inside the gold, parallel to the ribbon. They add a gentle "folded" highlight so the shapes don't look flat.

### 4.5 Two faint circles (the logo's outline)

```
<circle cx="720" cy="450" r="520" … strokeOpacity="0.12" />
<circle cx="720" cy="450" r="600" … strokeOpacity="0.06" />
```

These are centred on the screen, white, and very faint. They echo the logo's circle without competing with the panel.

### 4.6 The content panel

The page content (logo, title, form) sits on a white rounded panel above the SVG:

```ts
AUTH_PANEL_CLASS = "rounded-2xl bg-white/95 p-7 shadow-2xl ring-1 ring-black/5 backdrop-blur-sm"
```

The panel is 95% white and lightly blurs what's behind it (`backdrop-blur-sm`), so the curves are still hinted at behind it. The strong shadow lifts it off the background.

---

## 5. Step 4: making it behave

| Setting | Why |
|---|---|
| `preserveAspectRatio="xMidYMid slice"` | Fills the whole screen at any shape and crops the overflow, keeping the centre. On a tall phone you see the central peak and valley rather than a squashed zigzag. |
| `absolute inset-0 h-full w-full` on the `<svg>` | Stretches it behind everything. |
| `pointer-events-none` | Clicks pass through to the form. |
| `aria-hidden` | Screen readers skip the decoration. |
| `overflow-hidden` on the wrapper | Nothing spills out and causes scrollbars. |
| `relative z-10` on the content | Keeps the panel above the SVG. |
| Fixed hex colors, not theme tokens | The brand background looks the same in light and dark mode; only the panel changes with the theme. |
| Unique gradient ids (`auth-brown`, `auth-gold`) | SVG ids are global to the page, so generic ids like `g1` could clash with another SVG. |

---

## 6. Tuning it

| To change… | Edit… |
|---|---|
| Colors | The `stopColor` values in the two `<linearGradient>`s, and the wrapper's `bg-[#fbf8f2]` (the ribbon) |
| Ribbon width | Move every y value in the **gold** path down (wider) or up (narrower) |
| How round the corners are | The distance between each `L` end point and the `Q` control point |
| Where the peak and valley are | The x values around the two `Q` commands (the peak is near x = 360, the valley near x = 950) |
| Softer overall look | Wrap both big shapes in `<g opacity="0.85">`, or use lighter tints of the brand colors |
| Remove the sheens or circles | Delete those `<path>` / `<circle>` elements |

---

## 7. Reusable prompt for another app

Copy the prompt below into an AI coding assistant working on another app. Fill in the `[brackets]`, and **attach the logo image** so the assistant can see it. The prompt describes the method, so it works for any logo, not just this one.

````text
Create a full-screen decorative background for my app's sign-in page
(and any other pre-login pages), designed from our logo. The logo image is
attached.

Tech: [e.g. React + Tailwind / Next.js / plain HTML+CSS]
Brand colors (if known): [e.g. primary #8a4d21, secondary #feb914] — otherwise
sample them from the logo.
Pages to apply it to: [e.g. login, forgot password, reset password]

Method - follow these steps:

1. Analyse the logo first and list its defining features in a short table
   before writing code: its main color regions, the shape of the line(s) or
   edge(s) dividing them, whether corners are sharp or rounded, any gap or
   ribbon between regions, and its overall outline (circle, square, ...).

2. Build the background as an INLINE SVG (not an image file), as its own
   reusable component that wraps the page content:
   - viewBox="0 0 1440 900", preserveAspectRatio="xMidYMid slice",
     positioned absolute/inset-0 behind the content, aria-hidden,
     pointer-events: none. Wrapper: relative, min-h-screen, overflow hidden,
     content centered on top with a higher z-index.
   - Recreate the logo's dividing line at full-screen scale as a path whose
     ends start/finish just OFF-screen (e.g. x = -20 and 1460) so no shape
     edge is ever visible at the viewport border.
   - Match the logo's corners: if they are rounded, round every vertex with
     a quadratic curve - stop the line ~60 units before the corner and use
     `Q <corner> <point ~60 units after>`, so the corner acts as the
     control point.
   - Fill each color region as a closed path on its side of the line. If
     the logo has a gap/ribbon between regions, offset the second region's
     line by the gap and let the page background color show through as
     the ribbon.
   - Give each fill a subtle linear gradient (slightly deeper shade at one
     end) for depth.
   - Add 1-2 soft "sheen" strokes following the same line inside each
     region: white, 8-15% opacity, thick (40-60), rounded line joins.
   - Echo the logo's outer outline very faintly (e.g. 1-2 large thin
     white circles at 6-12% opacity if the logo is round).
   - Use unique gradient ids (prefixed, e.g. "auth-...") to avoid clashes.
   - Place the line so its long diagonal crosses the screen centre behind
     the content, with the visual peaks/valleys to the sides, so the curve
     frames the form instead of hiding behind it.

3. Put the page content (logo, app name, form) on ONE rounded white panel
   above the background: ~95% opaque, large shadow, faint ring, slight
   backdrop blur, generous padding. Remove any inner card borders so there
   isn't a box inside a box. Text must stay on the panel, never directly on
   the colored regions (check contrast).

4. Use the fixed brand hex colors in the SVG (not light/dark theme tokens)
   so the brand background looks the same in both themes; only the panel
   adapts to the theme.

5. Keep it responsive: verify on a narrow phone width that the `slice`
   crop still shows the most recognisable part of the curve.

6. When done, write a short doc explaining the layers (in draw order), the
   path coordinates and how the rounding works, and a "how to tune it"
   table (colors, ribbon width, corner roundness, peak/valley position).

Do not use a raster image for the background, a CSS framework-specific
plugin, or any external request.
````

**Tips for using the prompt**
- **Always attach the logo.** The first step, analysing the logo, is what makes the result feel on-brand rather than generic.
- **Logos without a dividing line** (for example a single-color mark): ask for the logo's main *silhouette* or its most distinctive curve, enlarged and cropped off-screen, in step 2.
- **Busy logos:** ask it to keep only **two** color regions and **one** dividing line. The effect works because it's simple.
