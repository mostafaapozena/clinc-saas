import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sniffImage } from '../src/storage/file-storage.js';
import { send, testApp } from './helpers/api.js';
import { buildClinic, pinClock, type Clinic } from './helpers/clinic.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// Organization identity and legal profile (docs/architecture/ORGANIZATION_PROFILE.md).
const app = testApp();
let c: Clinic;
let other: Clinic;
const url = (path: string, org = c.orgId) => `/api/v1/orgs/${org}${path}`;
// A 1×1 PNG (synthetic).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

beforeAll(async () => {
  pinClock();
  await connectTestDatabase('org-profile');
  c = await buildClinic(app, 'org-profile');
  other = await buildClinic(app, 'org-profile-other');
});
afterAll(() => dropTestDatabase());

describe('image sniffing', () => {
  it('recognises PNG, JPEG and WebP by their bytes only', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toBe('image/webp');
    expect(sniffImage(SVG)).toBeNull();
  });
});

describe('organization profile', () => {
  it('lets the owner save the legal profile, version-checked and audited', async () => {
    const empty = await c.receptionist.agent.get(url('/profile'));
    expect(empty.body.profile).toMatchObject({ legalNameAr: '', logoUrl: null, version: 0 });
    const body = {
      legalNameAr: 'عيادة الاختبار للأسنان',
      legalNameEn: 'Test Dental Clinic',
      commercialRegistration: 'CR-000123',
      taxRegistration: '123-456-789',
      address: 'شارع تجريبي، القاهرة',
      phone: '+20 100 000 0000',
      email: 'clinic@demo.test',
      documentFooter: 'بيانات تجريبية',
      version: 0,
    };
    expect((await send(c.receptionist, 'put', url('/profile'), body)).status).toBe(403);
    const saved = await send(c.owner, 'put', url('/profile'), body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.profile).toMatchObject({ commercialRegistration: 'CR-000123', version: 1 });
    expect((await send(c.owner, 'put', url('/profile'), body)).body.error.code).toBe('VERSION_CONFLICT');
    expect((await send(c.owner, 'put', url('/profile'), { ...body, email: 'not-an-email', version: 1 })).status).toBe(400);
  });

  it('accepts a raster logo of its declared type only, and serves it to members only', async () => {
    const put = (body: Buffer, type: string) =>
      c.owner.agent.put(url('/profile/logo')).set('X-CSRF-Token', c.owner.csrf).set('Content-Type', type).send(body);
    expect((await put(SVG, 'image/svg+xml')).body.error.code).toBe('UNSUPPORTED_IMAGE');
    expect((await put(PNG, 'image/jpeg')).body.error.code).toBe('UNSUPPORTED_IMAGE');
    expect((await put(Buffer.alloc(600 * 1024, 1), 'image/png')).status).toBe(413);
    const done = await put(PNG, 'image/png');
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const logoUrl = done.body.profile.logoUrl as string;
    expect(logoUrl).toMatch(new RegExp(`^/api/v1/orgs/${c.orgId}/profile/logo\\?v=[a-f\\d]{24}$`));
    const served = await c.receptionist.agent.get(logoUrl).buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    // Another organization's member cannot read it, even with the exact URL.
    expect((await other.owner.agent.get(logoUrl)).status).toBe(404);
    expect((await other.owner.agent.get(url('/profile/logo', other.orgId))).status).toBe(404);
  });

  it('removes the logo without deleting the stored file', async () => {
    const removed = await c.owner.agent.delete(url('/profile/logo')).set('X-CSRF-Token', c.owner.csrf);
    expect(removed.status).toBe(200);
    expect(removed.body.profile.logoUrl).toBeNull();
    expect((await c.owner.agent.get(url('/profile/logo'))).status).toBe(404);
  });
});
