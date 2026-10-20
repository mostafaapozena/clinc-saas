import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OwnershipInquiryModel } from '../src/modules/inquiries/inquiry.model.js';
import { parseReviewArgs, runReview } from '../src/modules/inquiries/inquiry.review.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { createOrg, register, testApp, type App } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = testApp();
const URL = '/api/v1/public/ownership-inquiries';

beforeAll(async () => {
  await connectTestDatabase('inquiries');
  await seedSpecialties();
});
afterAll(() => dropTestDatabase());

const valid = {
  contactName: 'هالة محمود',
  organizationName: 'مركز الأشعة التجريبي',
  country: 'EG',
  phone: { country: 'EG', number: '٠١٠٠٠٠٠٠٠٠١' },
  organizationType: 'medical_center',
  interest: 'custom',
  description: 'نحتاج نظامًا مخصصًا لمركز أشعة بثلاثة فروع.',
  language: 'ar',
};

const submit = (body: object, key: string | null = randomUUID(), target: App = app) => {
  const req = request(target).post(URL);
  return (key ? req.set('Idempotency-Key', key) : req).send(body);
};

describe('submitting a custom-ownership inquiry', () => {
  it('stores a normalized inquiry without any tenant link and answers with a reference only', async () => {
    const res = await submit(valid);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ reference: expect.stringMatching(/^R-[A-Z0-9]{8}$/), replayed: false });
    const stored = await OwnershipInquiryModel.findOne({ reference: res.body.reference }).lean();
    expect(stored).toMatchObject({
      phone: { country: 'EG', e164: '+201000000001' },
      email: null,
      status: 'new',
      interest: 'custom',
      country: 'EG',
    });
    expect(stored && 'organizationId' in stored).toBe(false);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('accepts one contact method, requires at least one, and validates each', async () => {
    const emailOnly = await submit({ ...valid, phone: undefined, email: 'Contact@Example.test' });
    expect(emailOnly.status).toBe(201);
    expect((await OwnershipInquiryModel.findOne({ reference: emailOnly.body.reference }).lean())?.email).toBe('contact@example.test');

    const none = await submit({ ...valid, phone: { country: 'EG', number: '' }, email: '' });
    expect(none.body.error.fields).toEqual({ contact: 'contact_required' });
    const badPhone = await submit({ ...valid, phone: { country: 'SA', number: '0100000000' } });
    expect(badPhone.body.error.fields).toEqual({ 'phone.number': 'invalid_phone' });
    const noCountry = await submit({ ...valid, phone: { number: '01000000001' } });
    expect(Object.keys(noCountry.body.error.fields)).toEqual(['phone.country']);
    const badEmail = await submit({ ...valid, phone: undefined, email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
  });

  it('accepts catalog specialties and the custom options only; radiology goes through "custom"', async () => {
    expect((await submit({ ...valid, interest: 'dentistry' })).status).toBe(201);
    expect((await submit({ ...valid, interest: 'multi_specialty' })).status).toBe(201);
    const radiology = await submit({ ...valid, interest: 'radiology' });
    expect(radiology.body.error.fields).toEqual({ interest: 'invalid_choice' });
  });

  it('rejects operator objects and oversize input, and ignores unknown fields', async () => {
    expect((await submit({ ...valid, contactName: { $ne: null } })).status).toBe(400);
    expect((await submit({ ...valid, description: 'x'.repeat(1501) })).body.error.fields).toEqual({ description: 'too_long' });
    const sneaky = await submit({ ...valid, status: 'reviewed', reference: 'R-AAAAAAAA', reviewedAt: new Date().toISOString() });
    expect(sneaky.status).toBe(201);
    expect(sneaky.body.reference).not.toBe('R-AAAAAAAA');
    expect((await OwnershipInquiryModel.findOne({ reference: sneaky.body.reference }).lean())?.status).toBe('new');
  });

  it('stores one inquiry for a repeated submit; the same key with other content is refused', async () => {
    const key = randomUUID();
    const body = { ...valid, organizationName: 'مركز التكرار' };
    const [a, b, c] = await Promise.all([submit(body, key), submit(body, key), submit(body, key)]);
    const references = new Set([a, b, c].map((r) => r?.body.reference));
    expect(references.size).toBe(1);
    expect([a, b, c].filter((r) => r?.status === 201)).toHaveLength(1);
    expect(await OwnershipInquiryModel.countDocuments({ submissionKey: key })).toBe(1);
    const changed = await submit({ ...body, description: 'نص مختلف تمامًا عن الطلب الأول.' }, key);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await submit(body, null)).body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('is rate limited per client and refuses cross-site posts', async () => {
    const limited = testApp({ inquiryRateLimit: { max: 2, windowMs: 60_000 } });
    expect((await submit(valid, randomUUID(), limited)).status).toBe(201);
    expect((await submit(valid, randomUUID(), limited)).status).toBe(201);
    const third = await submit(valid, randomUUID(), limited);
    expect(third.status).toBe(429);
    const crossSite = await request(app).post(URL).set('Origin', 'https://evil.example').set('Idempotency-Key', randomUUID()).send(valid);
    expect(crossSite.status).toBe(403);
  });
});

describe('no public or tenant access to inquiries', () => {
  it('has no read endpoints, for anonymous visitors or signed-in organization owners', async () => {
    const owner = await register(app, 'inq-owner');
    const { orgId } = await createOrg(owner, 'Inquiry Clinic');
    const one = await OwnershipInquiryModel.findOne().lean();
    const publicProbes = [URL, `${URL}/${one?.reference}`, `${URL}/${String(one?._id)}`, '/api/v1/public'];
    const tenantProbes = [`/api/v1/orgs/${orgId}/inquiries`, `/api/v1/orgs/${orgId}/ownership-inquiries`];
    for (const path of [...publicProbes, ...tenantProbes]) {
      const anonymous = await request(app).get(path);
      const signedIn = await owner.agent.get(path);
      // Organization routes ask for a session first (401); nothing anywhere returns inquiry data.
      expect(anonymous.status, path).toBe(publicProbes.includes(path) ? 404 : 401);
      expect(signedIn.status, path).toBe(404);
      for (const res of [anonymous, signedIn]) expect(JSON.stringify(res.body)).not.toContain(valid.contactName);
    }
  });
});

describe('operator review script', () => {
  it('validates its arguments and bounds list sizes', () => {
    expect(parseReviewArgs(['list'])).toMatchObject({ kind: 'list', limit: 20 });
    expect(parseReviewArgs(['list', '--limit', '500'])).toMatchObject({ kind: 'help' });
    expect(parseReviewArgs(['list', '--status', 'deleted'])).toMatchObject({ kind: 'help' });
    expect(parseReviewArgs(['list', '--since', 'yesterday'])).toMatchObject({ kind: 'help' });
    expect(parseReviewArgs(['show', '{"$ne":null}'])).toMatchObject({ kind: 'help', error: 'Invalid reference' });
    expect(parseReviewArgs(['set-status', 'R-ABCDEFGH', 'archived'])).toMatchObject({ kind: 'help' });
    expect(parseReviewArgs(['drop'])).toMatchObject({ kind: 'help' });
  });

  it('lists and shows inquiries with contact details masked unless explicitly revealed, and updates status', async () => {
    const created = await submit({ ...valid, contactName: 'Review Person', email: 'review.person@example.test' });
    const reference = created.body.reference as string;

    const list = (await runReview({ kind: 'list', status: 'new', country: 'EG', limit: 100 })).join('\n');
    expect(list).toContain(reference);
    expect(list).not.toContain('Review Person');
    expect(list).not.toContain('+201000000001');
    expect(list).not.toContain('review.person@example.test');

    const masked = (await runReview({ kind: 'show', reference, showContact: false })).join('\n');
    expect(masked).toContain('R…');
    expect(masked).toContain('+201•••••••01');
    expect(masked).toContain('r•••@example.test');
    expect(masked).not.toContain('Review Person');
    const revealed = (await runReview({ kind: 'show', reference, showContact: true })).join('\n');
    expect(revealed).toContain('Review Person');
    expect(revealed).toContain('+201000000001');

    expect(await runReview({ kind: 'set-status', reference, status: 'reviewed' })).toEqual([`${reference}: status set to reviewed.`]);
    const reviewed = await OwnershipInquiryModel.findOne({ reference }).lean();
    expect(reviewed?.status).toBe('reviewed');
    expect(reviewed?.reviewedAt).toBeInstanceOf(Date);
    expect((await runReview({ kind: 'list', status: 'new', limit: 100 })).join('\n')).not.toContain(reference);
    expect((await runReview({ kind: 'list', limit: 1 })).length).toBe(2);
  });
});
