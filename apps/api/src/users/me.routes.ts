import { Router } from 'express';
import { z } from 'zod';
import { authOf, requireAuth } from '../auth/session.middleware.js';
import { displayNameSchema, languageSchema } from '../http/schemas.js';
import { parseInput } from '../http/validate.js';
import { toUserDto } from './user.model.js';

const updateMeSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    preferredLanguage: languageSchema.optional(),
  })
  .refine((value) => value.displayName !== undefined || value.preferredLanguage !== undefined, {
    message: 'empty_update',
  });

export const meRouter = Router();

meRouter.patch('/', requireAuth, async (req, res) => {
  const { user } = authOf(req);
  const input = parseInput(updateMeSchema, req.body);
  if (input.displayName !== undefined) user.displayName = input.displayName;
  if (input.preferredLanguage !== undefined) user.preferredLanguage = input.preferredLanguage;
  await user.save();
  res.json({ user: toUserDto(user) });
});
