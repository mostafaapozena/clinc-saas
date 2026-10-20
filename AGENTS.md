# Working rules for this repository

These rules apply to every contributor, human or AI agent. Commands and setup details live in
[README.md](README.md); product scope lives in [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md).

## 1. Execute in the cloud, not on the owner's computer

- The owner's local disk (Windows C:) is nearly full. **Do not clone this repository, install
  its dependencies, download browsers or pull Docker images on the owner's machine.**
- All installs, builds, tests and dev servers run inside the GitHub Codespace (or CI).
- An agent running locally must operate the Codespace remotely, e.g.
  `gh codespace ssh -c <name> -- '<command>'`, and confirm it is inside the Codespace
  (`echo $CODESPACES` → `true`, working directory `/workspaces/clinc-saas`) before running
  project commands. Opening a Codespace URL in a browser does not move an agent's session.
- Non-interactive `gh codespace ssh` shells do not load the Codespace's Git credentials; push
  with `bash -lc 'git push ...'`.
- Use at most one Codespace on the smallest machine (2-core) unless there is a stated reason.
  Do not change billing, spending limits or paid features without the owner's explicit approval.

## 2. Testing requirements

- `npm run verify` (lint → typecheck → tests → build → e2e smoke) must pass in the Codespace
  before pushing, and in GitHub Actions before a PR is considered ready.
- Every behavior change comes with a test that would fail without it. Do not add tests whose
  only purpose is a green check, and never skip, disable or loosen a check to get past a failure.
  Fix the cause.
- API integration tests use a real MongoDB with throwaway databases named `clinc_test_*`
  (see `apps/api/test/helpers/test-database.ts`). Never point tests at the dev database.
- Passing locally in the Codespace does **not** mean CI passed. Check the actual Actions run.
- Report results honestly: say what was verified, what was not, and paste failures.

## 3. Data and secrets

- No real patient data anywhere: not in code, seeds, fixtures, screenshots or logs.
  Seed and demo data must be clearly synthetic.
- Secrets never go in Git. `.env` is ignored; `.env.example` contains placeholders only.
  Review staged files (`git diff --cached`) for secrets before every commit.
- Ports stay **private**. Do not make Codespaces ports public, and do not deploy a public
  environment without explicit approval.

## 4. Git workflow

- Change `main` only through pull requests. A repository ruleset requires the `verify` CI check
  and blocks force-pushes and deletion.
- Branch naming: `phase-<n>/<topic>` for phase work, `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
- Small, focused commits with conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`,
  `chore:`, `ci:`).
- Never commit `node_modules`, build output, `.env` files or database files (see `.gitignore`).
- Open a PR describing what changed and how it was verified. Do not merge your own PR unless the
  owner asks.
- Never force-push to `main` or rewrite shared history.

## 5. Architecture conventions

- API features live in `apps/api/src/modules/<module>/` (model, routes, seed, …) and are mounted
  in `apps/api/src/app.ts` under `/api/v1/<module>`.
- All configuration comes from environment variables validated in `apps/api/src/config/env.ts`.
- The web app is Arabic-first: every user-facing string goes in **both**
  `apps/web/src/i18n/locales/ar.json` and `en.json` (a test enforces matching keys). Use CSS
  logical properties (`margin-inline-start`, `padding-inline`, …), never left/right, so RTL and
  LTR both work.
- Multi-tenancy is **not implemented**. Follow [docs/architecture/TENANCY.md](docs/architecture/TENANCY.md)
  when adding organization-owned data, and never describe the system as multi-tenant or
  isolation-safe until that design is built and tested.

## 6. Keep continuity documents current

Before ending a session, update [docs/PROGRESS.md](docs/PROGRESS.md) and, if the way to resume
changed, [docs/HANDOFF.md](docs/HANDOFF.md). Push everything, because a Codespace is not a backup.
