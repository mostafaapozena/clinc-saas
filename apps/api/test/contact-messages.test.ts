import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { ContactMessageModel } from '../src/modules/inquiries/contact.model.js';
import { OperatorModel, PlatformAuditModel } from '../src/modules/platform/operator.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { TEST_PASSWORD, createOrg, register, resetRateLimits, testApp, type App } from './helpers/api.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

// The public contact page (general questions and demo requests), separate from custom-project
// inquiries and from authenticated support.
const app = testApp();
const URL = '/api/v1/public/contact-messages';

beforeAll(async () => {
  await connectTestDatabase('contact_messages');
  await seedSpecialties();
});
afterAll(() => dropTestDatabase());

const valid = {
  intent: 'demo',
  contactName: 'سلمى عادل',
  email: 'Salma@Example.test',
  organizationName: 'عيادة الاختبار',
  specialty: 'dentistry',
  message: 'نريد عرضًا توضيحيًا لمساحة العمل لعيادتنا.',
  language: 'ar',
};

const submit = (body: object, key: string | null = randomUUID(), target: App = app) => {
  const req = request(target).post(URL);
  return (key ? req.set('Idempotency-Key', key) : req).send(body);
};

async function operator(email: string, role: 'platform_admin' | 'support') {
  await OperatorModel.create({ email, displayName: role, role, passwordHash: await hashPassword(TEST_PASSWORD) });
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/platform/auth/login').send({ email, password: TEST_PASSWORD });
  return { agent, csrf: res.body.csrfToken as string };
}

describe('sending a contact message', () => {
  it('stores a normalized message without any tenant link and answers with a reference only', async () => {
    const res = await submit(valid);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ reference: expect.stringMatching(/^C-[A-Z0-9]{8}$/), replayed: false });
    const stored = await ContactMessageModel.findOne({ reference: res.body.reference }).lean();
    expect(stored).toMatchObject({ intent: 'demo', email: 'salma@example.test', phone: null, specialty: 'dentistry', status: 'new' });
    expect(stored && 'organizationId' in stored).toBe(false);
  });

  it('needs a way to reply, a known intent and specialty, and a real message', async () => {
    const minimal = await submit({ intent: 'question', contactName: 'Omar', phone: { country: 'EG', number: '٠١٠٠٠٠٠٠٠٠٢' }, message: 'A general question about raclinic.' });
    expect(minimal.status, JSON.stringify(minimal.body)).toBe(201);
    expect((await ContactMessageModel.findOne({ reference: minimal.body.reference }).lean())).toMatchObject({
      phone: { country: 'EG', e164: '+201000000002' },
      organizationName: null,
      specialty: null,
    });
    expect((await submit({ ...valid, email: '' })).body.error.fields).toEqual({ contact: 'contact_required' });
    expect((await submit({ ...valid, intent: 'support' })).body.error.fields).toHaveProperty('intent');
    expect((await submit({ ...valid, specialty: 'radiology' })).body.error.fields).toEqual({ specialty: 'invalid_choice' });
    expect((await submit({ ...valid, message: 'short' })).body.error.fields).toHaveProperty('message');
    expect((await submit({ ...valid, phone: { country: 'SA', number: '0100000000' } })).body.error.fields).toEqual({ 'phone.number': 'invalid_phone' });
    expect((await submit(valid, null)).body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('stores a repeated or simultaneous submit once, and refuses a reused key with other content', async () => {
    const key = randomUUID();
    const results = await Promise.all([submit(valid, key), submit(valid, key), submit(valid, key)]);
    const references = new Set(results.map((r) => r.body.reference));
    expect(references.size).toBe(1);
    expect(await ContactMessageModel.countDocuments({ submissionKey: key })).toBe(1);
    expect((await submit({ ...valid, message: 'Something else entirely, longer.' }, key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('is rate limited per client (shared counters) and refuses cross-site posts', async () => {
    await resetRateLimits();
    const limited = testApp({ inquiryRateLimit: { max: 2, windowMs: 60_000 } });
    expect((await submit(valid, randomUUID(), limited)).status).toBe(201);
    expect((await submit(valid, randomUUID(), limited)).status).toBe(201);
    expect((await submit(valid, randomUUID(), limited)).status).toBe(429);
    // A second instance shares the counter (multi-replica safe).
    expect((await submit(valid, randomUUID(), testApp({ inquiryRateLimit: { max: 2, windowMs: 60_000 } }))).status).toBe(429);
    const crossSite = await request(app).post(URL).set('Origin', 'https://evil.example').set('Idempotency-Key', randomUUID()).send(valid);
    expect(crossSite.status).toBe(403);
    await resetRateLimits();
  });
});

describe('who can read contact messages', () => {
  it('nobody publicly or through a tenant session; operators see masked details and reveal them with an audit entry', async () => {
    const sent = await submit({ ...valid, contactName: 'Hidden Person', email: 'hidden.person@example.test' });
    const reference = sent.body.reference as string;

    const owner = await register(app, 'contact-owner');
    const { orgId } = await createOrg(owner, 'Contact Clinic');
    for (const path of [URL, `${URL}/${reference}`, `/api/v1/orgs/${orgId}/contact-messages`, `/api/v1/platform/contact-messages`]) {
      for (const res of [await request(app).get(path), await owner.agent.get(path)]) {
        expect([401, 404]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain('hidden.person');
      }
    }

    const support = await operator('contact.support@example.test', 'support');
    const list = await support.agent.get('/api/v1/platform/contact-messages?status=new');
    expect(list.status).toBe(200);
    const row = list.body.data.find((m: { reference: string }) => m.reference === reference);
    expect(row).toMatchObject({ intent: 'demo', status: 'new', specialty: 'dentistry' });
    expect(JSON.stringify(list.body)).not.toContain('hidden.person');
    const detail = await support.agent.get(`/api/v1/platform/contact-messages/${reference}`);
    expect(detail.body.message.message).toBe(valid.message);
    expect(detail.body.message.email).not.toContain('hidden.person');

    const reveal = await support.agent.post(`/api/v1/platform/contact-messages/${reference}/reveal-contact`).set('X-Operator-CSRF', support.csrf);
    expect(reveal.body.contact).toEqual({ name: 'Hidden Person', phone: null, email: 'hidden.person@example.test' });
    expect(await PlatformAuditModel.countDocuments({ action: 'contact.contact_revealed', 'target.id': reference })).toBe(1);

    const reviewed = await support.agent.patch(`/api/v1/platform/contact-messages/${reference}`).set('X-Operator-CSRF', support.csrf).send({ status: 'reviewed' });
    expect(reviewed.body.message.status).toBe('reviewed');
    expect((await support.agent.get('/api/v1/platform/contact-messages?status=new')).body.data.map((m: { reference: string }) => m.reference)).not.toContain(reference);
    expect((await support.agent.get('/api/v1/platform/contact-messages/C-NOTREAL1')).status).toBe(404);
    expect((await support.agent.get('/api/v1/platform/overview')).body.contactMessages).toEqual({ new: expect.any(Number) });
  });
});
