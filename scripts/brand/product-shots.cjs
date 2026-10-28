// Product screenshots for the public website (apps/web/public/product/{ar,en}/*.jpg), each in two
// densities: <name>.jpg (1280×800) and <name>@2x.jpg (2560×1600) for high-density screens (srcset).
//
// Real workspace screens with the synthetic demo data — never real patient data. Run against an
// ISOLATED database seeded with `npm run seed` (not the database you work in), for example:
//   MONGODB_DB_NAME=clinc_shots npm run seed -w @clinc/api
//   MONGODB_DB_NAME=clinc_shots PORT=4100 npm run dev -w @clinc/api
//   API_PROXY_TARGET=http://127.0.0.1:4100 npm run dev -w @clinc/web -- --port 5200
//   node scripts/brand/product-shots.cjs http://127.0.0.1:5200 apps/web/public/product
// DEMO_PASSWORD is read from .env and never printed. Each account signs in once; both languages
// are captured by switching the stored UI language (the profile preference is not changed).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const BASE = process.argv[2] ?? 'http://127.0.0.1:5200';
const OUT = process.argv[3] ?? 'apps/web/public/product';
const PASSWORD = (fs.readFileSync('.env', 'utf8').match(/^DEMO_PASSWORD=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');

// [account, organization name (null = the one sign-in opens), shots]
const PLAN = [
  ['reception.nour@demo.test', null, [['appointments', '/appointments'], ['week', '/appointments?view=week'], ['patients', '/patients']]],
  ['owner.nour@demo.test', null, [['home', '/'], ['finance', '/finance'], ['services', '/finance/services']]],
  ['doctor.nour@demo.test', null, [['record', { record: true }], ['dental', { record: true, patient: true, scroll: 'dental-chart' }]]],
  ['doctor2.nour@demo.test', null, [['physio', { record: true, scroll: 'specialty-view' }]]],
  ['multi@demo.test', 'مركز الشفاء (تجريبي)', [['ent', { record: true, scroll: 'specialty-view' }]]],
];

async function firstDocumentedAppointment(page, orgId, documentation = 'finalized') {
  const today = new Date();
  const day = (offset) => new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return page.evaluate(
    async ({ orgId, from, to, documentation }) => {
      const res = await fetch(`/api/v1/orgs/${orgId}/appointments?from=${from}&to=${to}`).then((r) => r.json());
      const found = (res.data ?? []).find((a) => a.documentation === documentation);
      return found ? { id: found.id, patientId: found.patient?.id ?? null } : null;
    },
    { orgId, from: day(-7), to: day(0), documentation },
  );
}

(async () => {
  const browser = await chromium.launch();
  for (const [email, orgName, shots] of PLAN) {
    // Rendered at 2x; the 1x file is the same frame captured in CSS pixels. Light theme (the shots are
    // framed, never recolored, in the dark site); reduced motion so counters show final values.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('clinc.theme', 'light'));
    const page = await context.newPage();
    console.log(`signing in: ${email}`);
    await page.goto(`${BASE}/login`);
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    // Members of several organizations land on the chooser (/app); others in their workspace.
    await page.waitForURL((url) => url.pathname.startsWith('/app') || url.pathname.startsWith('/onboarding'));
    await page.waitForLoadState('networkidle');
    if (!orgName) await page.waitForURL(/\/app\/[a-f\d]{24}/);
    let orgId = /\/app\/([a-f\d]{24})/.exec(page.url())?.[1];
    if (orgName) {
      const session = await page.evaluate(() => fetch('/api/v1/auth/session').then((r) => r.json()));
      orgId = session.memberships.find((m) => m.organization.name === orgName).organization.id;
    }
    for (const language of ['ar', 'en']) {
      await page.evaluate((l) => localStorage.setItem('clinc.language', l), language);
      fs.mkdirSync(path.join(OUT, language), { recursive: true });
      for (const [name, target] of shots) {
        let route = typeof target === 'string' ? target : '';
        if (typeof target === 'object') {
          const found = await firstDocumentedAppointment(page, orgId, target.documentation);
          if (!found) throw new Error(`No ${target.documentation ?? 'finalized'} visit for ${email}`);
          // The tooth chart is on the patient page (it gathers every finalized dental visit).
          route = target.patient ? `/patients/${found.patientId}` : `/appointments/${found.id}/record`;
        }
        await page.goto(`${BASE}/app/${orgId}${route}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        if (typeof target === 'object' && target.scroll) {
          await page.getByTestId(target.scroll).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
          await page.evaluate(() => {
            const main = document.querySelector('.shell-main, .content');
            if (main && main.scrollTop) main.scrollTop -= 90;
            else window.scrollBy(0, -90);
          });
        }
        await page.waitForTimeout(500);
        const file = path.join(OUT, language, `${name}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 80, scale: 'css' });
        await page.screenshot({ path: path.join(OUT, language, `${name}@2x.jpg`), type: 'jpeg', quality: 72, scale: 'device' });
        console.log(file);
      }
    }
    await context.close();
  }
  await browser.close();
})().catch((error) => {
  console.error(String(error.message ?? error).split(/\r?\n/)[0]);
  process.exitCode = 1;
});
