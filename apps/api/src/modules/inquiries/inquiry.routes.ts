import { createHash, randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, isDuplicateKeyError, validationError } from '../../http/errors.js';
import { emailSchema, languageSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { PHONE_COUNTRIES, normalizePhone } from '../patients/normalize.js';
import { activeSpecialtyCodes } from '../specialties/specialty.service.js';
import {
  INQUIRY_COUNTRIES,
  INQUIRY_EXTRA_INTERESTS,
  INQUIRY_ORGANIZATION_TYPES,
  OwnershipInquiryModel,
} from './inquiry.model.js';

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

const inquirySchema = z
  .object({
    contactName: z.string().trim().min(2).max(80),
    organizationName: z.string().trim().min(2).max(120),
    country: z.enum(INQUIRY_COUNTRIES),
    // A local number needs its country; Arabic-Indic digits are accepted.
    phone: z.object({ country: z.enum(PHONE_COUNTRIES), number: optionalText(z.string().trim().max(30)) }).optional(),
    email: optionalText(emailSchema),
    organizationType: z.enum(INQUIRY_ORGANIZATION_TYPES),
    interest: z.string().trim().min(2).max(40),
    description: z.string().trim().min(10).max(1500),
    language: languageSchema.optional(),
  })
  .refine((v) => Boolean(v.phone?.number) || Boolean(v.email), { message: 'contact_required', path: ['contact'] });

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
// Unambiguous characters for a reference the visitor may quote later.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReference(): string {
  const bytes = randomBytes(8);
  return `R-${[...bytes].map((b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join('')}`;
}

/**
 * Public endpoints of the platform website. Write-only on purpose: there is no route that
 * lists or reads inquiries; operators use the review script with database access.
 */
export function createPublicRouter(config: AppConfig) {
  const router = Router();
  const inquiryLimiter = createRateLimiter(config.inquiryRateLimit, 'ownership-inquiry');

  router.post('/ownership-inquiries', inquiryLimiter, async (req, res) => {
    const key = req.get('idempotency-key') ?? '';
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header with each submission');
    }
    const input = parseInput(inquirySchema, req.body);
    const interests = new Set<string>([...(await activeSpecialtyCodes()), ...INQUIRY_EXTRA_INTERESTS]);
    if (!interests.has(input.interest)) throw validationError({ interest: 'invalid_choice' });
    let phone = null;
    if (input.phone?.number) {
      phone = normalizePhone(input.phone.number, input.phone.country);
      if (!phone) throw validationError({ 'phone.number': 'invalid_phone' });
    }

    const record = {
      contactName: input.contactName,
      organizationName: input.organizationName,
      country: input.country,
      phone,
      email: input.email ?? null,
      organizationType: input.organizationType,
      interest: input.interest,
      description: input.description,
      language: input.language ?? 'ar',
    };
    const requestHash = createHash('sha256').update(JSON.stringify(record)).digest('base64url');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const created = await OwnershipInquiryModel.create({ ...record, reference: newReference(), submissionKey: key, requestHash });
        res.status(201).json({ reference: created.reference, replayed: false });
        return;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
        const existing = await OwnershipInquiryModel.findOne({ submissionKey: key }).select('reference requestHash').lean();
        if (existing) {
          // The same submission sent again (double click, retry): one inquiry, same reference.
          if (existing.requestHash !== requestHash) {
            throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different submission');
          }
          res.json({ reference: existing.reference, replayed: true });
          return;
        }
        // Otherwise the random reference collided: try another one.
      }
    }
    throw new Error('Could not allocate an inquiry reference');
  });

  return router;
}
