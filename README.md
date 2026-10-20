# clinc-saas

Cloud platform for managing clinics and medical centers, initially for Egypt and Saudi Arabia.
Arabic (RTL) is the default language; English (LTR) is fully supported.

> **Status:** phase 3 (patient registry, practitioner schedules, appointments, check-in and the
> daily queue) is in review, stacked on phase 2. This is a development system with synthetic data
> only: it is **not** ready for real patient data or production deployment. See
> [docs/PROGRESS.md](docs/PROGRESS.md).

| Part     | Stack                                                                  | Location        |
| -------- | ---------------------------------------------------------------------- | --------------- |
| Web      | React 19, Vite 8, TypeScript, React Router, TanStack Query, i18next    | `apps/web`      |
| API      | Node.js 24, Express 5, Mongoose 9, TypeScript, zod, Argon2id, pino, Luxon, libphonenumber-js | `apps/api` |
| Database | MongoDB 8.2, single-node replica set (needed for transactions)        | devcontainer/CI |
| Tests    | Vitest (unit + API integration), Playwright (browser flows, mobile)   | `*/test`, `e2e` |

Package manager: **npm** workspaces with the committed `package-lock.json`. Node version: [`.nvmrc`](.nvmrc).

## What the front desk can do (phase 3)

Register a patient (name + phone with country; Arabic digits accepted) → choose a branch and a
doctor → pick a server-computed free time → book → check the patient in on arrival → the doctor
starts and completes the visit from the daily queue. Appointments can be rescheduled or
cancelled; no-shows are recorded after the start time. Owners and admins manage doctors'
scheduling profiles, weekly hours per branch and date-specific closures/replacement hours. The
home page shows today's real, scoped counts. No clinical records, billing or messaging exist.

## Development environment (GitHub Codespaces)

All development runs in a Codespace; nothing is installed on a local machine.

1. **Code → Codespaces → Create codespace** on the branch (2-core machine is enough), or:
   ```bash
   gh codespace create --repo mostafaapozena/clinc-saas --branch <branch> \
     --machine basicLinux32gb --idle-timeout 30m
   ```
2. The post-create step ([`.devcontainer/post-create.sh`](.devcontainer/post-create.sh)) installs
   the pinned Node, creates `.env` from [`.env.example`](.env.example), generates a random
   `DEMO_PASSWORD` in `.env`, runs `npm ci`, installs Playwright Chromium and seeds demo data.
3. `npm run dev`, then open port **5173** in the **Ports** tab. Ports are private: only the
   Codespace owner, signed in to GitHub, can open them.

The devcontainer runs `app` (Node) and `mongo` (MongoDB replica set `rs0`, data in the
`mongo-data` volume). The browser talks only to the Vite server, which proxies `/api` to the API
on port 4000, so cookies stay same-origin and no CORS is needed.

### Demo accounts (development only)

`npm run seed` creates synthetic organizations, users, doctors' schedules, patients and
appointments (all `@demo.test`, invented names and phone numbers). The password for every demo
account is the `DEMO_PASSWORD` value in the Codespace's git-ignored `.env`
(`grep DEMO_PASSWORD .env`). If it is empty, the seed prints a one-off password in the terminal.
Demo accounts are refused when `NODE_ENV=production`, and the seed refuses to run there.

| Account                    | Scenario                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `owner.nour@demo.test`     | Owner of "عيادات النور (تجريبي)" (3 branches, Africa/Cairo)   |
| `admin.nour@demo.test`     | Admin, all branches                                           |
| `doctor.nour@demo.test`    | Doctor (د. هالة) restricted to فرع المعادي                     |
| `doctor2.nour@demo.test`   | Doctor (د. سامي) at فرع مدينة نصر (mornings) and فرع الإسكندرية (evenings) |
| `reception.nour@demo.test` | Receptionist restricted to فرع مدينة نصر                       |
| `viewer.nour@demo.test`    | Viewer (prefers English) — aggregate counts only              |
| `suspended.nour@demo.test` | Suspended membership (no access)                              |
| `owner.shifa@demo.test`    | Owner of the second organization "مركز الشفاء (تجريبي)" (Asia/Riyadh) |
| `multi@demo.test`          | Admin in the first organization, branch-restricted doctor (د. ريم) in the second |
| `newcomer@demo.test`       | Registered, no organization (onboarding / "add member" flows) |

Seeded front-desk data: 9 + 2 patients (one family sharing a phone number, a patient only in
Alexandria that the Nasr City receptionist cannot see, an archived registration), weekly hours,
a closure and a replacement-hours day, and appointments from two days ago to five days ahead in
every status — **relative to each organization's local "today"**. Re-running `npm run seed`
refreshes only seed-owned records (it never touches data you created by hand and skips a seed
appointment that would collide with it). `npm run seed -- --reset` drops the development
database first.

### Commands

| Command             | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`       | API (port 4000, auto-reload) + web (port 5173). Stop with Ctrl+C.            |
| `npm run seed`      | Upsert specialties and demo data (idempotent). `-- --reset` drops the DB first |
| `npm run db:check`  | Print MongoDB version, database and ping                                     |
| `npm run lint`      | ESLint, zero warnings allowed                                                |
| `npm run typecheck` | TypeScript for API, web and test configuration                              |
| `npm test`          | Vitest: web unit tests + API integration tests on throwaway databases        |
| `npm run build`     | Production builds (`apps/api/dist`, `apps/web/dist`)                         |
| `npm run test:e2e`  | Playwright against the production builds (ports 4100/4173, fresh e2e DB)     |
| `npm run verify`    | **All of the above in order — run before every push.** Same as CI.          |

### Stopping and restarting

- Stop the dev servers with Ctrl+C. Stop the Codespace with `gh codespace stop -c <name>` (it also
  stops after 30 idle minutes). Files and the database volume are kept.
- Restart: open the Codespace, `npm run dev`. Run `npm run seed` to refresh the demo dates (or
  after a rebuild, if the database is empty).
- After changing `.devcontainer/`: **Rebuild container** (reruns post-create).

### Preview URL

While `npm run dev` runs, the app is at `https://<codespace-name>-5173.app.github.dev`. It is a
private development preview that works only while the Codespace runs — not production hosting.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and every push
to `main`: it starts MongoDB 8.2.12 as a single-node replica set
([`scripts/ci/start-mongo.sh`](scripts/ci/start-mongo.sh)), runs `npm ci`, then `npm run verify`.
The job is named `verify` and is a required check for `main`.

## Documentation

- [AGENTS.md](AGENTS.md) — rules for anyone (human or AI agent) working in this repository
- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) — product scope, decisions, assumptions
- [docs/architecture/AUTH.md](docs/architecture/AUTH.md) — sessions, CSRF, passwords, rate limits
- [docs/architecture/TENANCY.md](docs/architecture/TENANCY.md) — organizations, roles, authorization matrix, scoping
- [docs/architecture/PATIENTS.md](docs/architecture/PATIENTS.md) — patient data model, phone rules, visibility, duplicates
- [docs/architecture/SCHEDULING.md](docs/architecture/SCHEDULING.md) — time zones, availability, appointment states, concurrency and idempotency
- [docs/PROGRESS.md](docs/PROGRESS.md) — status, test evidence, production gaps
- [docs/HANDOFF.md](docs/HANDOFF.md) — how to continue in a fresh session
