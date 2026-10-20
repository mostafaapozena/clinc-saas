# Public website, routing boundaries and SEO

Implemented in `apps/web/src/public/`, `apps/web/src/routes/`, `apps/web/src/lib/pageMeta.ts`,
`apps/web/src/lib/site-url.ts` and the `clinc-seo` plugin in `apps/web/vite.config.ts`.

## Three separate things

1. **Public platform website** — explains the product; anonymous.
2. **Subscription SaaS application** — the authenticated clinic workspace under `/app`.
3. **Custom ownership delivery** — a separate path (`/custom-solutions`) that only collects
   requests (see [INQUIRIES.md](INQUIRIES.md)).

## Routes

| Path | Audience | Notes |
| ---- | -------- | ----- |
| `/` | Public | Home: who it serves, problems, solutions, what works today, what is planned, setup steps, SaaS vs custom, FAQ |
| `/solutions` | Public | Catalog: dentistry, physiotherapy, ENT, multi-specialty medical centers, plus the custom path |
| `/solutions/:slug` | Public | `dentistry`, `physiotherapy`, `ent`, `medical-centers`; others → not found (noindex) |
| `/custom-solutions` | Public | Custom-project explanation |
| `/custom-solutions/request` | Public | Inquiry form (`?interest=` pre-selects) |
| `/start` | Public → account | Workspace creation entry; see [ONBOARDING.md](ONBOARDING.md) |
| `/login`, `/register` | Account | Signed-in visitors go on to the validated `next` (default `/app`) |
| `/onboarding` | Signed in | Resumable setup |
| `/app`, `/app/:orgId/…` | Signed in | Workspace; unchanged permission guards |
| `/status` | Anyone | System status (noindex) |

`/` used to redirect to `/app`; existing links to `/app` and `/login` keep working, and signed-in
visitors on public pages are offered "Go to my workspace" instead of sign-up.

Public pages load no organization data. The only session information they use is whether someone
is signed in. Organization-scoped API routes require a session first (`401`).

## Code loading

Three lazily loaded chunks (`routes.tsx`): **public** (`src/public`), **account** (sign-in,
registration, onboarding, status) and **workspace** (`src/workspace`). The public chunk imports
nothing from the workspace. Measured on the phase 4 build (raw / gzip):

| Chunk | Size |
| ----- | ---- |
| Shared framework (React DOM, React Router, i18next, TanStack Query, both locale files) | ≈ 219 kB + 280 kB / ≈ 68 kB + 89 kB |
| Public pages | 21 kB / 4.6 kB (+ 6.8 kB CSS) |
| Account pages | 17 kB / 4.9 kB |
| Workspace | 95 kB / 20 kB |

Before phase 4 everything was one 557 kB (164 kB gzip) chunk and Vite warned about it; now no
chunk exceeds the 500 kB threshold. A visitor to the public site no longer downloads the
workspace. The remaining shared part is the framework libraries and the two locale files; loading
only the active language (≈ 10 kB gzip less) is a possible later optimization, not done here.

## SEO and indexing

- Every public page sets its own title, description, Open Graph tags and `twitter:card`
  (`usePageMeta`); sign-in, onboarding, workspace and not-found pages set `noindex, nofollow` and
  no public metadata (`usePrivatePageMeta`, used by `useDocumentTitle`).
- Languages: the same path serves Arabic (default) and English (`?lang=en`); `<html lang/dir>`
  follows the language. With a configured site URL, pages get a canonical URL and `hreflang`
  alternates (`ar`, `en`, `x-default` = Arabic).
- Structured data: `FAQPage` on the home page, generated from the FAQ shown on the page.
- **Environment configuration** (build time, never hard-coded):
  - `VITE_PUBLIC_SITE_URL` — the public https origin. Without it: no canonical, no alternates,
    no sitemap.
  - `VITE_PUBLIC_INDEXING=true` — allows indexing; honored only together with the site URL.
- Default (development, the private Codespaces preview, staging, CI): `robots.txt` is
  `Disallow: /`, `/sitemap.xml` is `404`, the HTML says `noindex, nofollow`, and responses carry
  `X-Robots-Tag: noindex, nofollow` — from the API always, and from the Vite dev and preview
  servers (tested in `e2e/public.spec.ts`). A future production web host must be configured to
  send the same header for non-public environments; the built files already contain the
  restrictive `robots.txt` and `noindex` meta.
- When indexing is enabled: `robots.txt` allows the public pages, disallows `/app`, `/onboarding`,
  `/login`, `/register`, `/start`, `/status`, `/api/` and points to the sitemap, which lists only
  the public pages in both languages.
- The site is a client-rendered single-page app: crawlers that do not run JavaScript see only
  the shell and a short `<noscript>` text. Prerendering or server rendering is a later decision.

## Copy

All public text is in `ar.json` / `en.json` under `site.*`. It is **provisional and must be
reviewed by the owner in the phase 4 PR**. It states what works today (the shared operational
workspace), labels specialty tools as planned without dates, and makes no claims about prices,
trial length, customers, usage numbers, outcomes, certifications or delivery. The product name
is still the temporary "منصة العيادات / Clinics Platform".
