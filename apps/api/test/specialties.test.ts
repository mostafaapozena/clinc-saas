import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { SpecialtyModel } from '../src/modules/specialties/specialty.model.js';
import { seedSpecialties } from '../src/modules/specialties/specialty.seed.js';
import { connectTestDatabase, dropTestDatabase } from './helpers/test-database.js';

const app = createApp();

describe('GET /api/v1/specialties', () => {
  beforeAll(() => connectTestDatabase('specialties'));
  afterAll(() => dropTestDatabase());
  beforeEach(() => SpecialtyModel.deleteMany({}));

  it('returns an empty list before seeding', async () => {
    const res = await request(app).get('/api/v1/specialties');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [] });
  });

  it('returns seeded specialties in display order with Arabic and English names', async () => {
    await seedSpecialties();

    const res = await request(app).get('/api/v1/specialties');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { code: 'dentistry', name: { ar: 'طب الأسنان', en: 'Dentistry' } },
      { code: 'physiotherapy', name: { ar: 'العلاج الطبيعي', en: 'Physiotherapy' } },
      { code: 'ent', name: { ar: 'الأنف والأذن والحنجرة', en: 'Ear, Nose & Throat' } },
    ]);
  });

  it('seeding is idempotent', async () => {
    await seedSpecialties();
    await seedSpecialties();

    expect(await SpecialtyModel.countDocuments()).toBe(3);
  });

  it('excludes inactive specialties', async () => {
    await seedSpecialties();
    await SpecialtyModel.updateOne({ code: 'ent' }, { isActive: false });

    const res = await request(app).get('/api/v1/specialties');

    expect(res.body.data.map((s: { code: string }) => s.code)).toEqual([
      'dentistry',
      'physiotherapy',
    ]);
  });
});
