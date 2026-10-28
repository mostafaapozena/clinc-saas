# Spacing and alignment polish

Owner's request of 2026-10-28 with four operator screenshots (A support, B contact messages,
C inquiries, D overview) as examples of a repeated problem. Fixed in shared CSS
(`apps/web/src/workspace.css`, section "Spacing system", plus the `.data-row` grid in
`styles.css`) so every page using the components gets it. Before/after screenshots:
`review-screenshots/raclinic-spacing-2026-10-28/` next to the checkout (INDEX.md there).

## The system

Scale 4/8/12/16/20/24/32 (`--space-1…6`, `--space-8`) and four roles:

| Role | Token | Used for |
| --- | --- | --- |
| Inside a component | `--space-inset` (20px, 16px on phones) | Card padding, a component's own `gap` |
| Related controls | `--stack-related` (8px) | Buttons in a row, a label and its field |
| Independent groups | `--stack-group` (16px) | A heading and its content, a filter bar and its results, forms/lists inside a card |
| Page sections | `--stack-page` (20px, 16px on phones) | The direct children of a workspace/operator page |

Vertical space between siblings now comes only from: the page rule (direct children of `.content` /
`.operator-main`), the card rule (direct children of a non-form `.card`), and `gap` in grid/flex
containers. No sibling-margin rule targets grid items.

## Issues

| # | Issue | Where | Root cause (confirmed) | Correction | Verified |
| --- | --- | --- | --- | --- | --- |
| 1 | Cards of one row start at different heights (D) | Every `card-grid`: operator overview and organization, subscription, finance, patient account, patient file, queue, booking details | `:is(.content, .operator-main) .card + .card { margin-block-start: 16px }` (added in phase 15) also matched cards that are grid siblings | Rule removed; page and card rhythm moved to the two scoped rules above; `.card-grid > .card { margin: 0 }` | D-after, analog-clinic-finance/subscription/patient-account |
| 2 | Filter group touching the results or empty state (A, B, C) | Operator inquiries, contact messages, support, plans; any page with a segmented filter | Page children had no shared spacing: the segmented control has no margin, lists and empty states none either | Page rule gives every page-level group `--stack-page`; `.segmented + list/empty/table` gets group spacing where they share a parent | A/B/C-after (populated and empty) |
| 3 | Status badge floating in the middle of a row (C) | Inquiries, contact messages, support queue, plans, team, branches, payments | `.data-row` grid was `2fr 2fr auto`, so the badge column started mid-row | `minmax(0,1fr) fit-content(45%) auto`: content takes the space, state and actions hug the end | C-after, analog-operator-plans |
| 4 | Title and reference line far apart inside a row (C) | All `data-row` lists with a `<p>` meta line | Browser paragraph margins inside the row | `.data-row p` / `.data-main > *` margins 0; the row's `gap` spaces them | C-after |
| 5 | Labels and values on alternating lines with equal spacing (D) | Operator health/policy/organization/inquiry details, subscription details | `<dl class="details">` with bare `dt`/`dd` stacked as one column | Bare `dt`/`dd` lists become a label \| value grid (one column on phones); width capped so values stay near labels | D-after, analog-operator-organization, analog-clinic-subscription |
| 6 | Uneven spacing inside cards (text against fields, fields against buttons) | Finance summary, settings, team, policy, reconciliation | Each child kept its own margins (h2 12px, notice 16px, filters 12px, paragraphs 1em) | One card rhythm: 12px between items, 16px after a heading and before a form/list/details, 24px before a sub-heading | analog-clinic-finance/settings/team |
| 7 | Reference numbers broken over three lines | Patient statement table | `bdi` numbers wrapped at hyphens in a narrow column | Numbers `nowrap`; surrounding words wrap | analog-clinic-patient-account |
| 8 | Metric labels broken inside words on phones | Overview metrics at 360px | Icon and label side by side in a 150px card with `overflow-wrap: anywhere` | Container query: icon above label under 170px; break between words only | analog-operator-overview-mobile-360 |
| 9 | Card title not centered with its button | Patient file "Edit", appointment filters | `.section-header` aligned to the top | Centered | analog-clinic-patient |
| 10 | Operator header wider than the page content | Operator console | Header padded to the window edge, content centered at 1280px | Header padding follows the content column | D-after |
| 11 | Arabic message text left-aligned in the English UI | Support conversation | No direction on user text | `dir="auto"` on messages | analog-operator-support-detail |

## Verification

- Viewed: the four examples in en/dark and ar/light, populated and empty; 30+ other pages across
  public, clinic and operator; 360, 768, 1440, 1920px.
- Overflow sweep: 19 pages × (360, 768, 1280, 1920, and 720px at DPR 2 = a 1440px window at 200%
  zoom, which is how Chromium zoom behaves) × ar/en, light/dark: 0 horizontal overflow, 0 console
  errors (190 loads).
- `npm run verify` and CI; no spacing-value unit tests (they would only restate the CSS).
- Not verified: other browsers' zoom; physical devices.
