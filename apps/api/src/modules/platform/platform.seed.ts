import { hashPassword } from '../../auth/password.js';
import { clock } from '../../time/clock.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { PlanModel, SubscriptionModel } from './billing.model.js';
import { OperatorModel } from './operator.model.js';

// Development seed for the platform side (never run in production — the seed script refuses).
// No real commercial terms: the "development" plan has no prices and no limits; the simulator test
// plan carries an obviously synthetic price only so the payment SIMULATOR can be exercised; the
// example plan is a draft with no prices, waiting for real terms (B4).

export const DEMO_OPERATORS = [
  { email: 'operator.admin@demo.test', displayName: 'مشغل المنصة (تجريبي)', role: 'platform_admin' as const },
  { email: 'operator.support@demo.test', displayName: 'دعم المنصة (تجريبي)', role: 'support' as const },
];

const UPSERT = { upsert: true, returnDocument: 'after' as const, setDefaultsOnInsert: true };
const NO_LIMITS = { branches: null, practitioners: null, members: null };

export async function seedPlatformData(password: string) {
  const passwordHash = await hashPassword(password);
  for (const o of DEMO_OPERATORS) {
    await OperatorModel.findOneAndUpdate(
      { email: o.email },
      { $set: { displayName: o.displayName, role: o.role, status: 'active', passwordHash, seedKey: 'demo' } },
      UPSERT,
    );
  }
  const development = await PlanModel.findOneAndUpdate(
    { seedKey: 'plan-development' },
    {
      $setOnInsert: {
        code: 'development',
        version: 1,
        name: { ar: 'وصول التطوير', en: 'Development access' },
        status: 'active',
        prices: [],
        limits: NO_LIMITS,
        note: 'For development grants only. No commercial terms.',
        activatedAt: clock.now(),
      },
    },
    UPSERT,
  );
  await PlanModel.findOneAndUpdate(
    { seedKey: 'plan-simulator-test' },
    {
      $setOnInsert: {
        code: 'simulator-test',
        version: 1,
        name: { ar: 'خطة اختبار المحاكي (سعر وهمي)', en: 'Simulator test plan (synthetic price)' },
        status: 'active',
        // 1.00 — a synthetic amount for exercising the payment simulator, not an offer.
        prices: [
          { currency: 'EGP', interval: 'month', amountMinor: 100 },
          { currency: 'SAR', interval: 'month', amountMinor: 100 },
        ],
        limits: NO_LIMITS,
        note: 'Synthetic price for the payment simulator. Not a commercial plan.',
        activatedAt: clock.now(),
      },
    },
    UPSERT,
  );
  await PlanModel.findOneAndUpdate(
    { seedKey: 'plan-example-draft' },
    {
      $setOnInsert: {
        code: 'clinic',
        version: 1,
        name: { ar: 'خطة العيادة (مسودة)', en: 'Clinic plan (draft)' },
        status: 'draft',
        prices: [],
        limits: NO_LIMITS,
        note: 'Draft: prices and limits await an owner decision (B4).',
      },
    },
    UPSERT,
  );

  // Demo organizations get an open-ended development grant (never a commercial subscription).
  const orgs = await OrganizationModel.find({ seedKey: { $exists: true } })
    .select('_id')
    .lean();
  let grants = 0;
  for (const org of orgs) {
    if (await SubscriptionModel.exists({ organizationId: org._id })) continue;
    const reason = 'Seeded development grant';
    await SubscriptionModel.create({
      organizationId: org._id,
      kind: 'development_grant',
      planId: development!._id,
      planCode: 'development',
      planVersion: 1,
      status: 'active',
      currentPeriodEnd: null,
      note: reason,
      history: [
        {
          at: clock.now(),
          from: null,
          to: 'active',
          kind: 'development_grant',
          planCode: 'development',
          planVersion: 1,
          actor: 'system',
          reason,
        },
      ],
    });
    grants += 1;
  }
  return { operators: DEMO_OPERATORS, grants };
}
