#!/usr/bin/env node
// `npm run test:e2e:browsers [-- <playwright args>]`: the Firefox and WebKit journeys of
// playwright.browsers.config.ts, one browser project per Playwright run.
//
// Each run starts its own API and web servers on a database that `seed --reset` rebuilds from the
// synthetic demo seed (playwright.config.ts webServer), so every browser starts from the same data.
// Tests change that data as they go (bookings, saved languages, an organization's specialties); in
// one run with several projects the second browser would meet the first browser's changes. Runs are
// sequential because they share ports and the test database. Every project runs even when an
// earlier one fails; the exit code is non-zero if any failed.
import { spawnSync } from 'node:child_process';

const PROJECTS = ['firefox', 'webkit', 'webkit-phone'];
const extra = process.argv.slice(2);
const results = [];

for (const project of PROJECTS) {
  console.log(`\n=== ${project}: fresh seed, own servers ===`);
  const run = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.browsers.config.ts', `--project=${project}`, ...extra], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  results.push({ project, ok: run.status === 0, status: run.status });
}

console.log('\n=== Summary ===');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.project}${r.ok ? '' : ` (exit ${r.status})`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
