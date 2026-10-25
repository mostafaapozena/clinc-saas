# Dependency audit

Run `npm run audit:deps` (`npm audit --omit=dev`) before every release, and review new advisories.

| Date | Command | Result | Action |
| ---- | ------- | ------ | ------ |
| 2026-10-25 | `npm audit --omit=dev` (Codespace) | 1 high: `body-parser` 2.3.0, a denial of service via trailing bytes after a compressed body (GHSA-27r3-jxmh-p828). It is a transitive dependency of `express` 5.3.0. | `npm audit fix` moved it to `body-parser` 2.4.0, within the declared range. The change is in the lockfile only. Re-run: **0 vulnerabilities** (production and development). The full test suite passed afterwards. |

No automated dependency-update service is configured. One would need a GitHub setting, and the
owner may enable Dependabot.
