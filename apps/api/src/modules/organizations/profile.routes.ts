import express, { Router } from 'express';
import { z } from 'zod';
import { HttpError, conflict, notFound, validationError } from '../../http/errors.js';
import { parseInput } from '../../http/validate.js';
import { requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { MAX_IMAGE_BYTES, mongoFileStorage, sniffImage, type FileStorage } from '../../storage/file-storage.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { OrganizationModel, type OrganizationProfile } from './organization.model.js';

// Organization identity and legal profile — «ملف وهوية المنشأة»
// (docs/architecture/ORGANIZATION_PROFILE.md). Shown on printed documents. Registration numbers
// are stored as the owner enters them: no statutory format is assumed or validated.

const text = (max: number) => z.string().trim().max(max).default('');
const profileSchema = z.object({
  legalNameAr: text(160),
  legalNameEn: text(160),
  commercialRegistration: text(40),
  taxRegistration: text(40),
  address: text(300),
  phone: text(40),
  email: z.union([z.literal(''), z.string().trim().email().max(120)]).default(''),
  documentFooter: text(300),
  version: z.number().int().min(0),
});

export const EMPTY_PROFILE: OrganizationProfile = {
  legalNameAr: '',
  legalNameEn: '',
  commercialRegistration: '',
  taxRegistration: '',
  address: '',
  phone: '',
  email: '',
  documentFooter: '',
  logoFileId: null,
  version: 0,
};

const profileDto = (orgId: string, p: OrganizationProfile) => ({
  legalNameAr: p.legalNameAr,
  legalNameEn: p.legalNameEn,
  commercialRegistration: p.commercialRegistration,
  taxRegistration: p.taxRegistration,
  address: p.address,
  phone: p.phone,
  email: p.email,
  documentFooter: p.documentFooter,
  // The file id changes with every upload, so the URL is safe to cache.
  logoUrl: p.logoFileId ? `/api/v1/orgs/${orgId}/profile/logo?v=${String(p.logoFileId)}` : null,
  version: p.version,
});

export function createProfileRouter(storage: FileStorage = mongoFileStorage) {
  const router = Router({ mergeParams: true });

  router.get('/profile', requirePermission('organization.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const org = await OrganizationModel.findById(tenant.organizationId).select('profile').lean();
    if (!org) throw notFound();
    res.json({ profile: profileDto(String(tenant.organizationId), org.profile ?? EMPTY_PROFILE) });
  });

  router.put('/profile', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const { version, ...fields } = parseInput(profileSchema, req.body);
    const org = await OrganizationModel.findById(tenant.organizationId).select('profile').lean();
    if (!org) throw notFound();
    const current = org.profile ?? EMPTY_PROFILE;
    if (current.version !== version) throw conflict('VERSION_CONFLICT', 'The profile was changed meanwhile');
    const next = { ...current, ...fields, version: version + 1 };
    const done = await OrganizationModel.updateOne(
      { _id: tenant.organizationId, ...(org.profile ? { 'profile.version': version } : { profile: null }) },
      { $set: { profile: next } },
    );
    if (done.modifiedCount !== 1) throw conflict('VERSION_CONFLICT', 'The profile was changed meanwhile');
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'organization.profile_updated',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { fields: Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== current[k as keyof OrganizationProfile]) },
    });
    res.json({ profile: profileDto(String(tenant.organizationId), next) });
  });

  // The logo: a PNG, JPEG or WebP image up to 512 KB, sent as the raw request body. The type is
  // sniffed from the bytes and must match the declared type; SVG and anything else are refused.
  router.put(
    '/profile/logo',
    requirePermission('organization.update'),
    express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      const tenant = tenantOf(req);
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) throw validationError({ logo: 'empty' });
      const sniffed = sniffImage(bytes);
      if (!sniffed || sniffed !== (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase())
        throw new HttpError(415, 'UNSUPPORTED_IMAGE', 'Send a PNG, JPEG or WebP image of its declared type');
      const { id } = await storage.put({
        organizationId: tenant.organizationId,
        purpose: 'logo',
        contentType: sniffed,
        bytes,
        userId: tenant.userId,
      });
      const org = await OrganizationModel.findById(tenant.organizationId).select('profile').lean();
      const next = { ...(org?.profile ?? EMPTY_PROFILE), logoFileId: id, version: (org?.profile?.version ?? 0) + 1 };
      await OrganizationModel.updateOne({ _id: tenant.organizationId }, { $set: { profile: next } });
      await recordAudit({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'organization.profile_updated',
        target: { type: 'organization', id: tenant.organizationId },
        changes: { logo: { type: sniffed, size: bytes.length } },
      });
      res.json({ profile: profileDto(String(tenant.organizationId), next) });
    },
  );

  router.delete('/profile/logo', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    await storage.remove(tenant.organizationId, 'logo');
    const org = await OrganizationModel.findById(tenant.organizationId).select('profile').lean();
    const next = { ...(org?.profile ?? EMPTY_PROFILE), logoFileId: null, version: (org?.profile?.version ?? 0) + 1 };
    await OrganizationModel.updateOne({ _id: tenant.organizationId }, { $set: { profile: next } });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'organization.profile_updated',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { logo: null },
    });
    res.json({ profile: profileDto(String(tenant.organizationId), next) });
  });

  // Members only (the organization middleware already checked membership); never cross-tenant.
  router.get('/profile/logo', requirePermission('organization.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const org = await OrganizationModel.findById(tenant.organizationId).select('profile.logoFileId').lean();
    const fileId = org?.profile?.logoFileId;
    const file = fileId ? await storage.get(tenant.organizationId, fileId) : null;
    if (!file) throw notFound();
    res.set({
      'Content-Type': file.contentType,
      'Content-Length': String(file.bytes.length),
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline; filename="logo"',
      ETag: `"${file.sha256}"`,
    });
    res.end(file.bytes);
  });

  return router;
}
