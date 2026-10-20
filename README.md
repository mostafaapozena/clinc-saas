# clinc-saas

Cloud platform for managing clinics and medical centers, initially for Egypt and Saudi Arabia.
Arabic (RTL) is the default language; English (LTR) is fully supported.

> **Status:** phase 2 (authentication, organizations, tenant isolation, bilingual shell) is in
> review. This is a development system: it is **not** ready for real patient data or production
> deployment. See [docs/PROGRESS.md](docs/PROGRESS.md).

| Part     | Stack                                                                  | Location        |
| -------- | ---------------------------------------------------------------------- | --------------- |
| Web      | React 19, Vite 8, TypeScript, React Router, TanStack Query, i18next    | `apps/web`      |
| API      | Node.js 24, Express 5, Mongoose 9, TypeScript, zod, Argon2id, pino     | `apps/api`      |
| Database | MongoDB 8.2, single-node replica set (needed for transactions)        | devcontainer/CI |
| Tests    | Vitest (unit + API integration), Playwright (browser flows, mobile)   | `*/test`, `e2e` |

Package manager: **npm** workspaces with the committed `package-lock.json`. Node version: [`.nvmrc`](.nvmrc).

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

`npm run seed` creates synthetic organizations and users (all `@demo.test`). The password for
every demo account is the `DEMO_PASSWORD` value in the Codespace's git-ignored `.env`
(`grep DEMO_PASSWORD .env`). If it is empty, the seed prints a one-off password in the terminal.
Demo accounts are refused when `NODE_ENV=production`, and the seed refuses to run there.

| Account                    | Scenario                                                      |
| -------------------------- | ------------------------------------------------------------- |
| `owner.nour@demo.test`     | Owner of "عيادات النور (تجريبي)" (3 branches)                 |
| `admin.nour@demo.test`     | Admin, all branches                                           |
| `doctor.nour@demo.test`    | Doctor restricted to one branch                               |
| `reception.nour@demo.test` | Receptionist restricted to one branch                         |
| `viewer.nour@demo.test`    | Viewer (prefers English)                                      |
| `suspended.nour@demo.test` | Suspended membership (no access)                              |
| `owner.shifa@demo.test`    | Owner of the second organization "مركز الشفاء (تجريبي)"       |
| `multi@demo.test`          | Admin in the first organization, branch-restricted doctor in the second |
| `newcomer@demo.test`       | Registered, no organization (onboarding / "add member" flows) |

Reset the development database to exactly this state: `npm run seed -- --reset`.

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
- Restart: open the Codespace, `npm run dev`. If the database is empty (e.g. after a rebuild),
  run `npm run seed`.
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
- [docs/PROGRESS.md](docs/PROGRESS.md) — status, test evidence, production gaps
- [docs/HANDOFF.md](docs/HANDOFF.md) — how to continue in a fresh session
