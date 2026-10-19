# clinc-saas

Cloud platform for managing clinics and medical centers, initially targeting Egypt and Saudi
Arabia. Arabic (RTL) is the default language; English (LTR) is supported.

> **Status:** phase 1 — project foundation. This is a starter application that proves the
> frontend, API, database, tests and CI work together. It is **not** a medical system yet and
> must never contain real patient data. See [docs/PROGRESS.md](docs/PROGRESS.md).

| Part     | Stack                                                       | Location    |
| -------- | ----------------------------------------------------------- | ----------- |
| Web      | React 19, Vite 8, TypeScript, i18next (ar/en)               | `apps/web`  |
| API      | Node.js 24, Express 5, Mongoose 9, TypeScript, zod, pino    | `apps/api`  |
| Database | MongoDB 8.0 (devcontainer service; CI service container)    | —           |
| Tests    | Vitest (unit + API integration), Playwright (browser smoke) | `*/test`, `e2e` |

Package manager: **npm** (workspaces) with the committed `package-lock.json`.
Node version: pinned in [`.nvmrc`](.nvmrc).

## Development environment (GitHub Codespaces)

All development runs in a Codespace — nothing needs to be installed locally.

1. On GitHub: **Code → Codespaces → Create codespace on `<branch>`** (the 2-core machine is
   enough), or with the GitHub CLI:
   ```bash
   gh codespace create --repo mostafaapozena/clinc-saas --branch main \
     --machine basicLinux32gb --idle-timeout 30m
   ```
2. Wait for the post-create step ([`.devcontainer/post-create.sh`](.devcontainer/post-create.sh)).
   It installs the pinned Node version, runs `npm ci`, installs Playwright Chromium, creates
   `.env` from [`.env.example`](.env.example) and seeds the development database.
3. Start the app: `npm run dev`
4. Open the **Ports** tab and open port **5173** (Web). Ports are private: only the Codespace
   owner, signed in to GitHub, can open them.

The devcontainer ([`.devcontainer/`](.devcontainer)) runs two containers: `app` (Node) and
`mongo` (MongoDB, data in the `mongo-data` Docker volume). The browser only talks to the Vite
server; Vite proxies `/api/*` to the API on port 4000, so there is no CORS setup and the API
port does not need to be opened.

The development database is disposable. To rebuild its demo data at any time: `npm run seed`.

### Commands

| Command             | What it does                                                               |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run dev`       | Start API (port 4000, auto-reload) and web (port 5173). Stop with Ctrl+C.  |
| `npm run seed`      | Insert/update synthetic reference data (idempotent; refuses in production) |
| `npm run db:check`  | Connect to MongoDB and print server version, database and ping            |
| `npm run lint`      | ESLint, zero warnings allowed                                              |
| `npm run typecheck` | TypeScript type check of API, web and test config                         |
| `npm test`          | Vitest: web unit tests + API integration tests against throwaway databases |
| `npm run build`     | Production build of API (`apps/api/dist`) and web (`apps/web/dist`)       |
| `npm run test:e2e`  | Playwright smoke test against the production builds (ports 4100/4173)     |
| `npm run verify`    | **Everything above in order — run before every push.** Same as CI.        |

### Stopping and restarting

- Stop the dev servers: Ctrl+C in the terminal running `npm run dev`.
- Stop the Codespace (stops billing for compute; files and the database volume are kept):
  `gh codespace stop -c <name>` or **Codespaces → … → Stop codespace**. It also stops
  automatically after 30 minutes of inactivity.
- Restart: open the Codespace again, then `npm run dev`. If the database is empty
  (e.g. after a rebuild), run `npm run seed`.
- After changing anything in `.devcontainer/`: **Rebuild container**, which reruns post-create.

### Preview URL

While `npm run dev` runs, the app is at
`https://<codespace-name>-5173.app.github.dev`. This is a private development preview: it
only works while the Codespace is running and is **not** production hosting.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every pull request and every
push to `main`: `npm ci` from the lockfile, then `npm run verify` with a MongoDB 8.0 service
container. The job is named `verify`.

## Project documentation

- [AGENTS.md](AGENTS.md) — rules for anyone (human or AI agent) working in this repository
- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) — product scope, decisions, assumptions
- [docs/architecture/TENANCY.md](docs/architecture/TENANCY.md) — proposed multi-tenancy design (not yet implemented)
- [docs/PROGRESS.md](docs/PROGRESS.md) — what is done, what is next, blockers
- [docs/HANDOFF.md](docs/HANDOFF.md) — how to continue in a fresh session
