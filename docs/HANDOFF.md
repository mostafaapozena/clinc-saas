# Handoff: continuing in a fresh session

Read [AGENTS.md](../AGENTS.md) (rules) and [PROGRESS.md](PROGRESS.md) (state, gaps) first.

## Where things are

| Item              | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Repository        | https://github.com/mostafaapozena/clinc-saas (private)                      |
| Open PRs          | #1 `phase-1/foundation` → `main`; #2 `phase-2/auth-tenancy` → `phase-1/foundation` (stacked) |
| Codespace         | display name `clinc-saas-dev` (`gh codespace list`), 2-core, 30-min idle timeout, 7-day retention after stopping |
| Repo in Codespace | `/workspaces/clinc-saas`                                                    |
| CI                | Workflow `CI`, job `verify` (required on `main`)                            |
| Demo accounts     | See README; password = `DEMO_PASSWORD` in the Codespace's `.env` (never commit or paste it) |

Everything important is in Git; a new Codespace from any branch sets itself up via the
devcontainer.

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
- Do not publish app ports in `docker-compose.yml`: the Codespaces agent already listens on them
  on the VM (`bind: address already in use` → recovery container).

If GitHub CLI auth expires: `gh auth login --web --scopes codespace,repo,workflow,read:org` and
have the owner approve the code at https://github.com/login/device.

## Checklist before ending a session

1. `npm run verify` passes in the Codespace.
2. Changes are committed and pushed; CI is green on the latest commit.
3. [PROGRESS.md](PROGRESS.md) updated.
4. Stop the Codespace if idle: `gh codespace stop -c <name>`.
