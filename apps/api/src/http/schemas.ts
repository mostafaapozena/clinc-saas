import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const newPasswordSchema = z.string().min(10).max(128);
export const displayNameSchema = z.string().trim().min(1).max(80);
export const languageSchema = z.enum(['ar', 'en']);
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const organizationNameSchema = z.string().trim().min(2).max(120);
export const branchNameSchema = z.string().trim().min(2).max(80);
export const citySchema = z.string().trim().max(80);

/** Escapes user input before it is used inside a MongoDB $regex. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
