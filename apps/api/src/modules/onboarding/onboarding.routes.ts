import { runTransaction } from '../../db/transaction.js';
import { Router } from 'express';
import { type Types } from 'mongoose';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import { authOf, requireAuth } from '../../auth/session.middleware.js';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { branchNameSchema, citySchema, organizationNameSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId } from '../../tenancy/tenant-context.js';
import { SUPPORTED_TIME_ZONES } from '../../time/local-time.js';
import { ORGANIZATION_TYPES, OrganizationModel } from '../organizations/organization.model.js';
import { createOrganizationInSession } from '../organizations/organization.service.js';
import { defaultModules } from '../organizations/modules.js';
import { assertCatalogSpecialties, specialtyCodeSchema, specialtyListSchema } from '../specialties/specialty.service.js';
import { ONBOARDING_STEPS, OnboardingDraftModel, type OnboardingDraft, type OnboardingStep } from './onboarding.model.js';

const timeZoneSchema = z.enum(SUPPORTED_TIME_ZONES);
const codesSchema = z
  .array(specialtyCodeSchema)
  .max(20)
  .transform((codes) => [...new Set(codes)]);

/** Saving a step: every field optional, allowlisted (unknown keys are dropped), shape-checked. */
const saveSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  /** null when creating the draft; otherwise the version the client last read. */
  version: z.number().int().min(0).nullable(),
  data: z.object({
    organizationType: z.enum(ORGANIZATION_TYPES).nullable().optional(),
    name: z.string().trim().max(120).optional(),
    timeZone: timeZoneSchema.nullable().optional(),
    specialtyCodes: codesSchema.optional(),
    branch: z
      .object({ name: z.string().trim().max(80).optional(), city: citySchema.optional(), specialtyCodes: codesSchema.optional() })
      .optional(),
  }),
});

/** Completion requires the full, consistent setup. */
const completionSchema = z.object({
  organizationType: z.enum(ORGANIZATION_TYPES),
  name: organizationNameSchema,
  timeZone: timeZoneSchema,
  specialtyCodes: specialtyListSchema,
  branch: z.object({ name: branchNameSchema, city: citySchema, specialtyCodes: specialtyListSchema }),
});

const STEP_OF_FIELD: Record<string, OnboardingStep> = {
  organizationType: 'organization',
  name: 'organization',
  timeZone: 'organization',
  specialtyCodes: 'specialties',
};
const stepOf = (field: string): OnboardingStep => STEP_OF_FIELD[field] ?? (field.startsWith('branch') ? 'branch' : 'review');

/** Parses the stored draft for completion; errors name the field and the step to return to. */
function parseCompletion(data: OnboardingDraft['data']) {
  try {
    return parseInput(completionSchema, data);
  } catch (err) {
    if (err instanceof HttpError && err.fields) {
      const first = Object.keys(err.fields)[0] ?? '_';
      throw new HttpError(400, 'ONBOARDING_INCOMPLETE', 'Some setup details are missing or invalid', err.fields, {
        step: stepOf(first),
      });
    }
    throw err;
  }
}

type DraftLean = OnboardingDraft & { _id: Types.ObjectId };

function toDraftDto(draft: DraftLean) {
  return {
    id: String(draft._id),
    status: draft.status,
    step: draft.step,
    data: {
      organizationType: draft.data.organizationType ?? null,
      name: draft.data.name ?? '',
      timeZone: draft.data.timeZone ?? null,
      specialtyCodes: [...(draft.data.specialtyCodes ?? [])],
      branch: {
        name: draft.data.branch?.name ?? '',
        city: draft.data.branch?.city ?? '',
        specialtyCodes: [...(draft.data.branch?.specialtyCodes ?? [])],
      },
    },
    organizationId: draft.organizationId ? String(draft.organizationId) : null,
    version: draft.version,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

const draftConflict = () => conflict('VERSION_CONFLICT', 'The setup was changed in another tab. Reload and try again.');

/**
 * Resumable organization setup for the signed-in user. It only ever creates a *new*
 * organization owned by the caller; it never reads or changes an existing one, so nothing passed
 * here (for example a specialty chosen on a public page) can alter an organization the user is
 * merely a member of.
 */
export function createOnboardingRouter(config: AppConfig) {
  const router = Router();
  const setupLimiter = createRateLimiter(config.setupRateLimit, 'onboarding-setup');
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const userId = authOf(req).user._id;
    const draft = await OnboardingDraftModel.findOne({ userId, status: 'draft' }).lean();
    // A setup completed in the last 30 minutes (its response may have been lost): the page resumes
    // into that workspace instead of offering to start again.
    const recent = draft
      ? null
      : await OnboardingDraftModel.findOne({ userId, status: 'completed', completedAt: { $gte: new Date(Date.now() - 30 * 60_000) } })
          .sort({ completedAt: -1 })
          .lean();
    res.json({ draft: draft ? toDraftDto(draft) : null, completed: recent?.organizationId ? { organizationId: String(recent.organizationId) } : null });
  });

  router.put('/', async (req, res) => {
    const userId = authOf(req).user._id;
    const input = parseInput(saveSchema, req.body);
    const branch = input.data.branch ?? {};
    await assertCatalogSpecialties(input.data.specialtyCodes ?? [], 'specialtyCodes');
    await assertCatalogSpecialties(branch.specialtyCodes ?? [], 'branch.specialtyCodes');

    const set: Record<string, unknown> = { step: input.step };
    const fields = {
      'data.organizationType': input.data.organizationType,
      'data.name': input.data.name,
      'data.timeZone': input.data.timeZone,
      'data.specialtyCodes': input.data.specialtyCodes,
      'data.branch.name': branch.name,
      'data.branch.city': branch.city,
      'data.branch.specialtyCodes': branch.specialtyCodes,
    };
    for (const [path, value] of Object.entries(fields)) if (value !== undefined) set[path] = value;

    if (input.version === null) {
      try {
        const [created] = await OnboardingDraftModel.create([{ userId, status: 'draft' }]);
        if (!created) throw new Error('Expected a created draft');
        const saved = await OnboardingDraftModel.findOneAndUpdate(
          { _id: created._id, userId, status: 'draft' },
          { $set: set, $inc: { version: 1 } },
          { returnDocument: 'after' },
        ).lean();
        if (!saved) throw draftConflict();
        res.status(201).json({ draft: toDraftDto(saved) });
      } catch (err) {
        // Another tab created the draft first.
        if (isDuplicateKeyError(err)) throw draftConflict();
        throw err;
      }
      return;
    }
    const saved = await OnboardingDraftModel.findOneAndUpdate(
      { userId, status: 'draft', version: input.version },
      { $set: set, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (!saved) {
      const exists = await OnboardingDraftModel.exists({ userId, status: 'draft' });
      throw exists ? draftConflict() : notFound();
    }
    res.json({ draft: toDraftDto(saved) });
  });

  /**
   * Creates the organization, first branch and owner membership from the draft, and marks the
   * draft completed — all in one transaction. A repeated or concurrent request for the same
   * draft returns the organization already created (both transactions write the draft, so one
   * of them conflicts, retries and sees it completed).
   */
  router.post('/:draftId/complete', setupLimiter, async (req, res) => {
    const userId = authOf(req).user._id;
    const draftId = parseObjectId(req.params.draftId);
    if (!draftId) throw notFound();

    const result = await runTransaction(async (session) => {
      const draft = await OnboardingDraftModel.findOneAndUpdate(
        { _id: draftId, userId },
        { $inc: { version: 1 } },
        { session, returnDocument: 'before' },
      ).lean();
      if (!draft) throw notFound();
      if (draft.status === 'completed' && draft.organizationId) {
        return { organizationId: draft.organizationId, replayed: true };
      }
      const data = parseCompletion(draft.data);
      const { organization } = await createOrganizationInSession(
        {
          userId,
          name: data.name,
          timeZone: data.timeZone,
          type: data.organizationType,
          specialtyCodes: data.specialtyCodes,
          branch: { name: data.branch.name, city: data.branch.city, specialtyCodes: data.branch.specialtyCodes },
        },
        session,
      );
      // The workspace defaults of the chosen kind of organization (idempotent: same transaction).
      await OrganizationModel.updateOne({ _id: organization._id }, { $set: { enabledModules: defaultModules(data.organizationType) } }, { session });
      await OnboardingDraftModel.updateOne(
        { _id: draftId, userId },
        { $set: { status: 'completed', step: 'review', organizationId: organization._id, completedAt: new Date() } },
        { session },
      );
      return { organizationId: organization._id, replayed: false };
    });

    const organization = await OrganizationModel.findById(result.organizationId).select('name').lean();
    if (!organization) throw notFound();
    res
      .status(result.replayed ? 200 : 201)
      .json({ organization: { id: String(result.organizationId), name: organization.name }, replayed: result.replayed });
  });

  return router;
}
