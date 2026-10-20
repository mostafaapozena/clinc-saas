# Handoff: continuing in a fresh session

Read [AGENTS.md](../AGENTS.md) (rules) and [PROGRESS.md](PROGRESS.md) (current state) first.

## Where things are

| Item         | Value                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| Repository   | https://github.com/mostafaapozena/clinc-saas (private)                   |
| Default branch | `main` (changed only through PRs)                                      |
| Codespace    | display name `clinc-saas-dev`, 2-core, 30-min idle timeout, 7-day retention after stopping. Find it with `gh codespace list`. |
| Repo path in Codespace | `/workspaces/clinc-saas`                                       |
| CI           | GitHub Actions workflow `CI`, job `verify`                               |

A Codespace is deleted automatically after 7 days stopped. Everything important is in Git, so
a new Codespace can be created from any branch and gets fully set up by the devcontainer.

## Option A: work inside the Codespace (simplest)

Open the Codespace in the browser or VS Code (**Code → Codespaces**), then in its terminal:

```bash
git status && git pull
npm run dev        # or: npm run verify
```

## Option B: operate the Codespace from the owner's Windows PC

The owner's C: drive is nearly full, so nothing project-related is installed there. A portable
GitHub CLI is installed on D: instead:

- Binary: `D:\SOLUTIONS\tools\gh\bin\gh.exe` (v2.102.0)
- Config/auth: `D:\SOLUTIONS\tools\gh-config` (set `GH_CONFIG_DIR` to this path)
- Git Bash wrapper that sets both: `D:\SOLUTIONS\tools\ghw`

```bash
G=/d/SOLUTIONS/tools/ghw
$G auth status                                   # needs scopes: codespace, repo, workflow
$G codespace list
$G codespace ssh -c <name> -- 'cd /workspaces/clinc-saas && npm run verify'
$G codespace ssh -c <name> -- 'bash -lc "cd /workspaces/clinc-saas && git push"'   # login shell for git credentials
$G codespace ports -c <name>                     # preview URLs (private)
```

If authentication has expired, run `gh auth login --web --scopes codespace,repo,workflow,read:org`
and have the owner approve the device code at https://github.com/login/device.

Running a long-lived process (e.g. `npm run dev`) over `gh codespace ssh` keeps the SSH session
open. Start it detached:
`setsid nohup npm run dev > /tmp/dev.log 2>&1 < /dev/null &`.

## Checklist before ending a session

1. `npm run verify` passes in the Codespace.
2. Changes are committed and pushed, and CI is green on the latest commit.
3. [PROGRESS.md](PROGRESS.md) is updated.
4. Stop the Codespace if no one is using it: `gh codespace stop -c <name>`.
