import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { Model } from 'mongoose';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import type { AppConfig } from '../../config/app-config.js';
import { HttpError, conflict, isDuplicateKeyError, validationError } from '../../http/errors.js';
import { emailSchema, languageSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { PHONE_COUNTRIES, normalizePhone } from '../patients/normalize.js';
import { activeSpecialtyCodes } from '../specialties/specialty.service.js';
import { CONTACT_INTENTS, ContactMessageModel } from './contact.model.js';
import {
  INQUIRY_COUNTRIES,
  INQUIRY_EXTRA_INTERESTS,
  INQUIRY_ORGANIZATION_TYPES,
  OwnershipInquiryModel,
} from './inquiry.model.js';

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), schema.optional());

// A local number needs its country; Arabic-Indic digits are accepted.
const phoneInput = z.object({ country: z.enum(PHONE_COUNTRIES), number: optionalText(z.string().trim().max(30)) }).optional();
const contactRequired = { message: 'contact_required', path: ['contact'] };

const inquirySchema = z
  .object({
    contactName: z.string().trim().min(2).max(80),
    organizationName: z.string().trim().min(2).max(120),
    country: z.enum(INQUIRY_COUNTRIES),
    phone: phoneInput,
    email: optionalText(emailSchema),
    organizationType: z.enum(INQUIRY_ORGANIZATION_TYPES),
    interest: z.string().trim().min(2).max(40),
    description: z.string().trim().min(10).max(1500),
    language: languageSchema.optional(),
  })
  .refine((v) => Boolean(v.phone?.number) || Boolean(v.email), contactRequired);

const contactSchema = z
  .object({
    intent: z.enum(CONTACT_INTENTS),
    contactName: z.string().trim().min(2).max(80),
    phone: phoneInput,
    email: optionalText(emailSchema),
    organizationName: optionalText(z.string().trim().min(2).max(120)),
    specialty: optionalText(z.string().trim().max(40)),
    message: z.string().trim().min(10).max(1500),
    language: languageSchema.optional(),
  })
  .refine((v) => Boolean(v.phone?.number) || Boolean(v.email), contactRequired);

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
// Unambiguous characters for a reference the visitor may quote later.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReference(prefix: 'R' | 'C'): string {
  const bytes = randomBytes(8);
  return `${prefix}-${[...bytes].map((b) => REFERENCE_ALPHABET[b % REFERENCE_ALPHABET.length]).join('')}`;
}

function submissionKey(req: Request): string {
  const key = req.get('idempotency-key') ?? '';
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header with each submission');
  }
  return key;
}

function parsePhone(input: z.infer<typeof phoneInput>) {
  if (!input?.number) return null;
  const phone = normalizePhone(input.number, input.country);
  if (!phone) throw validationError({ 'phone.number': 'invalid_phone' });
  return phone;
}

/**
 * Stores a public submission exactly once per Idempotency-Key: a repeated submit (double click,
 * retry, simultaneous requests) answers with the same reference; the same key with different
 * content is refused.
 */
/** The fields every public submission collection shares (references, idempotency). */
type SubmissionModel = Model<{ reference: string; submissionKey: string; requestHash: string }>;

async function storeOnce(
  res: Response,
  model: SubmissionModel,
  prefix: 'R' | 'C',
  key: string,
  record: Record<string, unknown>,
): Promise<void> {
  const requestHash = createHash('sha256').update(JSON.stringify(record)).digest('base64url');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await model.create({ ...record, reference: newReference(prefix), submissionKey: key, requestHash });
      res.status(201).json({ reference: created.reference, replayed: false });
      return;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      const existing = await model.findOne({ submissionKey: key }).select('reference requestHash').lean();
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different submission');
        }
        res.json({ reference: existing.reference, replayed: true });
        return;
      }
      // Otherwise the random reference collided: try another one.
    }
  }
  throw new Error('Could not allocate a reference');
}

/**
 * Public endpoints of the platform website. Write-only on purpose: nothing here lists or reads
 * submissions; operators review them in the platform console.
 */
export function createPublicRouter(config: AppConfig) {
  const router = Router();
  // Shared (MongoDB) counters, separate per form.
  const inquiryLimiter = createRateLimiter(config.inquiryRateLimit, 'ownership-inquiry');
  const contactLimiter = createRateLimiter(config.inquiryRateLimit, 'contact-message');

  router.post('/ownership-inquiries', inquiryLimiter, async (req, res) => {
    const key = submissionKey(req);
    const input = parseInput(inquirySchema, req.body);
    const interests = new Set<string>([...(await activeSpecialtyCodes()), ...INQUIRY_EXTRA_INTERESTS]);
    if (!interests.has(input.interest)) throw validationError({ interest: 'invalid_choice' });
    await storeOnce(res, OwnershipInquiryModel as unknown as SubmissionModel, 'R', key, {
      contactName: input.contactName,
      organizationName: input.organizationName,
      country: input.country,
      phone: parsePhone(input.phone),
      email: input.email ?? null,
      organizationType: input.organizationType,
      interest: input.interest,
      description: input.description,
      language: input.language ?? 'ar',
    });
  });

  router.post('/contact-messages', contactLimiter, async (req, res) => {
    const key = submissionKey(req);
    const input = parseInput(contactSchema, req.body);
    if (input.specialty && !new Set<string>([...(await activeSpecialtyCodes()), 'multi_specialty']).has(input.specialty)) {
      throw validationError({ specialty: 'invalid_choice' });
    }
    await storeOnce(res, ContactMessageModel as unknown as SubmissionModel, 'C', key, {
      intent: input.intent,
      contactName: input.contactName,
      phone: parsePhone(input.phone),
      email: input.email ?? null,
      organizationName: input.organizationName ?? null,
      specialty: input.specialty ?? null,
      message: input.message,
      language: input.language ?? 'ar',
    });
  });

  return router;
}
