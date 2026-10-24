# raclinic brand: assets, tokens and usage

Source of truth: the owner-supplied **"raclinic logo .pdf"** (Adobe Illustrator 30.8, 4 pages,
created 2026-10-15; not stored in Git). Brand name in running text: **raclinic** (lowercase).
Taglines: **مساعدك الذكي في كل تفاصيل العيادة** / **Smart clinic management**. The Latin
wordmark is used in both languages; no Arabic transliteration is approved.

## What the PDF contains

| Page | Content | Type | Used for |
| ---- | ------- | ---- | -------- |
| 1 | Stacked lockup: symbol (notched navy square, turquoise pulse, coral dot) + "ra / Clinic" | Vector (13 paths) | Sign-in, registration and onboarding header; sharing image; symbol-only icon |
| 2 | Horizontal wordmark "raclinic" with the pulse above | Vector (12 paths) | Public header, workspace sidebar, standalone pages |
| 3 | Color bands with the taglines | Vector + outlined glyphs | Color reference only |
| 4 | Six marketing compositions (AI, payments, analytics, extra specialties…) | One raster image | **Visual reference only — not a feature list.** None of those capabilities is implemented or advertised. |

## Assets (`apps/web/public`)

Made by copying the original `<path>` elements of pages 1–2 (exported with Poppler's
`pdftocairo -svg`) and only changing the `viewBox` to crop around the artwork. Geometry, fills and
proportions are unchanged; nothing is redrawn or recolored. Reproduce with
[`scripts/brand/`](../scripts/brand/README.md).

| File | From | Notes |
| ---- | ---- | ----- |
| `brand/raclinic-wordmark.svg` | page 2, all paths | 1048 × 252 artwork units |
| `brand/raclinic-lockup.svg` | page 1, all paths | 1035 × 345 |
| `brand/raclinic-symbol.svg` | page 1, symbol paths only (navy square, pulse, dot) | 375 × 308 |
| `favicon.svg` | symbol, centered unscaled in a square viewBox | transparent |
| `brand/favicon-32.png`, `brand/icon-192.png`, `brand/icon-512.png` | `favicon.svg` rendered with librsvg | transparent |
| `brand/apple-touch-icon.png` | symbol on a white square, 180 px | iOS needs an opaque icon |
| `brand/og-image.png` | stacked lockup centered on white, 1200 × 630 | sharing image; referenced only when `VITE_PUBLIC_SITE_URL` is set |

The web app shows them through `BrandLogo` (`apps/web/src/components/BrandLogo.tsx`): CSS sets the
height only, the width follows the artwork, and `width`/`height` attributes prevent layout shift.

**Dark backgrounds:** the PDF has no reverse (light) variant. In dark mode the logo is placed on a
white rounded container instead of modifying its colors.

## Colors

Read from the vector fills of the PDF (device RGB as exported by Poppler), not estimated from
pixels:

| Token | Value | PDF fill (RGB %) | Where in the PDF |
| ----- | ----- | ---------------- | ---------------- |
| `--brand-navy` | `#122640` | 7.10 / 14.90 / 25.10 | wordmark letters |
| `--brand-navy-symbol` | `#1A3553` | 10.20 / 20.80 / 32.50 | symbol square, page 3 bands |
| `--brand-turquoise` | `#3ECABA` | 24.30 / 79.20 / 72.90 | pulse, "C" |
| `--brand-coral` | `#FB7254` | 98.40 / 44.70 / 32.90 | pulse dot, page 3 tagline |

If the designer has official values (e.g. from the Illustrator swatches or a print spec), those
take precedence; update the tokens in `apps/web/src/styles.css`.

### Accessibility rules and derived tokens

Contrast on white: navy 15.3:1 / 12.5:1; **turquoise 2.0:1** and **coral 2.8:1** — too low for
text or for conveying status. Therefore:

- Navy carries structure: text, headings, primary buttons (white text on `#1A3553`, 12.5:1).
- Turquoise is used for emphasis that does not need contrast (hero tint, card accents, badge
  tints); text in the turquoise family uses the **derived** `--brand-teal-text` `#0E7A6F` (5.2:1).
- Coral appears only as the small decorative dot on the public hero eyebrow, never for errors or
  warnings.
- Validation and status colors (green/amber/red), and the blue focus ring, are unchanged so states
  stay unambiguous.
- Dark mode (derived from the navy): background `#0D1B2E`, surfaces `#13253C`; turquoise becomes
  the primary color with navy text on it (7.5:1), links `#7FDFD4`.
- Derived neutrals: background `#F5F8FA`, muted surface `#EDF3F6`, border `#D8E1E8`, muted text
  `#556677` (5.9:1).

## Typography

Unchanged: self-hosted **Alexandria** (Arabic) and **Inter** (English). The PDF's wordmark is
outlined artwork; its typeface is not identified and is not used for interface text.

## Motion

Public pages only, and only under `prefers-reduced-motion: no-preference`: a short fade/rise of the
hero (0.35 s) and a slight lift on solution cards on hover. Nothing delays a workflow.

## Status

The visual application is **pending the owner's design review** in the phase 4 PR.
