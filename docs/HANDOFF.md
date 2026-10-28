# Handoff: continuing in a fresh session

Read [AGENTS.md](../AGENTS.md) (rules) and [PROGRESS.md](PROGRESS.md) (state, gaps) first.

## Where things are

| Item              | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Repository        | https://github.com/mostafaapozena/clinc-saas (private)                      |
| Merged            | #1–#3 (phases 1–3) and #4 (planning docs) — `main` at `d8b93b9` or later     |
| Open PR           | #5 `phase-4/public-onboarding` → `main` (phase 4); waits on the owner's copy review; do not merge without it |
| Codespace         | display name `clinc-saas-dev` (`gh codespace list`), 2-core, 30-min idle timeout, 7-day retention after stopping |
| Repo in Codespace | `/workspaces/clinc-saas`                                                    |
| CI                | Workflow `CI`, job `verify` (required on `main`)                            |
| Demo accounts     | See README; password = `DEMO_PASSWORD` in the Codespace's `.env` (never commit or paste it) |

Everything important is in Git; a new Codespace from any branch sets itself up via the
devcontainer.

## Continuing

**Phase 4 review changes** (owner feedback on PR #5): work on `phase-4/public-onboarding`. Public
copy lives in `apps/web/src/i18n/locales/{ar,en}.json` under `site.*` (both files, same keys).
After edits: `npm run verify`, push, check CI on the new head.

**Phase 5** (after #5 merges): read [NEXT_PHASE_BRIEF.md](NEXT_PHASE_BRIEF.md) and confirm Q5/Q6
in [DECISIONS.md](DECISIONS.md) with the owner first.

1. In the Codespace: `git fetch && git checkout main && git pull --ff-only`, then
   `git checkout -b phase-5/visit-records`. If #5 is still open, stack on its branch and say so.
2. After `npm run seed`, the demo data includes the specialty setup and a legacy organization
   (`owner.legacy@demo.test`). The preview check script used for phase 4 was a throwaway; note
   that `context.clearCookies()` also drops GitHub's port-forwarding cookie — use a new browser
   context per user instead.
3. `npm ci` after pulling (dependencies may have changed) — and restart dev servers afterwards: a
   running `tsx watch` API died when `node_modules` was replaced.
4. Phases now target `main` directly; stacking is only needed while a previous phase PR is open.
5. Merging: the ruleset requires `verify` and an up-to-date branch. Use merge commits; bring a
   branch up to date with `gh api -X PUT repos/<repo>/pulls/<n>/update-branch -f update_method=merge`
   and wait for CI on the new head.

## Option A: work inside the Codespace

Open it from **Code → Codespaces** and use its terminal: `git pull`, `npm run dev`, `npm run verify`.

## Option B: operate the Codespace from the owner's Windows PC

The owner's C: drive is nearly full; nothing project-related lives there. On D::

- `D:\SOLUTIONS\tools\gh\bin\gh.exe` — portable GitHub CLI; config in `D:\SOLUTIONS\tools\gh-config`.
- `D:\SOLUTIONS\tools\ghw` — Git Bash wrapper setting `GH_CONFIG_DIR` (scopes needed: `codespace`, `repo`, `workflow`).
- `D:\SOLUTIONS\tools\push-bundle <file> [subdir]` — streams a text bundle (`@@@FILE <path>` /
  `@@@DELETE <path>` markers) to `/workspaces/.tools/apply-bundle.mjs` in the Codespace, then deletes
  the local file. `D:\SOLUTIONS\tools\push-edits <edits.json>` applies exact find/replace edits
  via `/workspaces/.tools/replace.mjs`. Recreate the two `.mjs` helpers if `/workspaces/.tools` is gone.
- Why: in the agent's shell, long heredocs passed to `gh codespace ssh` were unreliable
  (backslashes collapsed, parsing failures). Write content to a file and stream it instead.

```bash
G=/d/SOLUTIONS/tools/ghw
$G codespace ssh -c <name> -- 'cd /workspaces/clinc-saas && npm run verify'
# Non-interactive shells lack Git credentials and GITHUB_TOKEN — use a login shell:
$G codespace ssh -c <name> -- 'bash -lc "cd /workspaces/clinc-saas && git push"'
# Long-running servers: start detached so the SSH session can close.
$G codespace ssh -c <name> -- 'cd /workspaces/clinc-saas && (setsid nohup npm run dev > /tmp/dev.log 2>&1 < /dev/null &)'
```

Commit messages with quotes/apostrophes: write them to a file and use `git commit -F <file>`.
Small file sets can also be streamed as a tar: `tar -c <files> | $G codespace ssh -c <name> -- 'cd /workspaces/clinc-saas && tar -x'`.

For mutation checks (temporarily breaking code to prove a test catches it), put the mutation in a
Node script file and check that it applied: regexes passed inline through `gh codespace ssh`
silently matched nothing once. Back up the file and restore it from the backup rather than `git
checkout`, which would also drop uncommitted work; use `git stash -u` if new files are involved.

### Verifying the private preview without the owner's browser

Inside the Codespace (login shell), requests to `https://$CODESPACE_NAME-5173.$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`
are accepted with header `X-Github-Token: $GITHUB_TOKEN`. Browsers first get GitHub's
"Codespaces Access Port" page; click its **Continue** button. Never make ports public.

### Known Codespace behavior

- After `gh codespace rebuild`, SSH answered `exit status 3840` for a long time on three
  occasions; a `gh codespace stop` followed by a new `gh codespace ssh` (which starts it) restored
  access each time. Use bounded retries and report rather than looping.
- A failed devcontainer build silently starts an Alpine **recovery container** (no Node). Check
  `/etc/os-release` and `/workspaces/.codespaces/.persistedshare/creation.log` (it only keeps the
  latest start).
- If API tests fail with `MongoNetworkError ... closed` in random suites, check MongoDB's open-file
  limit (`db.hostInfo().extra.maxOpenFiles`, expected 64000). A container created from an older
  `docker-compose.yml` keeps 1024 until the Codespace is rebuilt.
- **Preview 502 on 5173 while 4000 works** (2026-10-20, after the Codespace had been shut down
  for hours and was started by `gh codespace ssh`): the dev server answered locally, the API's
  forwarded URL reached Express, but the 5173 URL returned 502 and `gh codespace ports forward
  5173:…` reported `connect failed ("Connection refused")` from the agent. Vite host binding,
  IPv6 (the container has none) and re-setting the port to private did not help; one
  `gh codespace stop` + start, then starting `npm run dev`, fixed it. Check the preview URL with
  `curl -H "X-Github-Token: $GITHUB_TOKEN"` before driving a browser through it.
- When stopping dev servers over SSH, do not `pkill -f concurrently` inside an inline command:
  the pattern matches the SSH session's own command line and closes it. Use a script file that
  kills `node_modules/.bin/concurrently`, `tsx watch src/server.ts` and `node_modules/.bin/vite`,
  then start with `setsid nohup npx concurrently -k -n api,web "npm run dev -w @clinc/api" "npm run dev -w @clinc/web" > /tmp/dev.log 2>&1 < /dev/null &`.
  Dev servers left from an earlier session may still hold port 5173 (`strictPort`), so a second
  start exits — stop first.
- Do not publish app ports in `docker-compose.yml`: the Codespaces agent already listens on them
  on the VM (`bind: address already in use` → recovery container).

If GitHub CLI auth expires: `gh auth login --web --scopes codespace,repo,workflow,read:org` and
have the owner approve the code at https://github.com/login/device.

### Verifying the front-desk flow through the preview

Same approach as above: a throwaway Playwright script run with `node` inside the Codespace
(never committed) opens the preview with the `X-Github-Token` header, clicks GitHub's
interstitial button by its **exact** name `Continue` (another button also contains the word),
signs in with `DEMO_PASSWORD` read from `.env` (never printed), and drives reception and doctor
sessions. Run `npm run seed` first so the demo appointments are relative to today.

Long command lines fail from the Windows side (length limit): move scripts and file contents
with the bundle helper rather than inline base64.

## Checklist before ending a session

1. `npm run verify` passes in the Codespace.
2. Changes are committed and pushed; CI is green on the latest commit.
3. [PROGRESS.md](PROGRESS.md) updated.
4. Stop the Codespace if idle: `gh codespace stop -c <name>`.
