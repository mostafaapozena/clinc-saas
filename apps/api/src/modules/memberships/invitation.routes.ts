import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authOf, requireAuth } from '../../auth/session.middleware.js';
import { AccountTokenModel, consumeAccountToken, findUsableToken, issueAccountToken } from '../../auth/token.model.js';
import type { AppConfig } from '../../config/app-config.js';
import { createRateLimiter } from '../../auth/rate-limit.js';
import { HttpError, conflict, forbidden, notFound } from '../../http/errors.js';
import { emailSchema, objectIdSchema } from '../../http/schemas.js';
import { parseInput } from '../../http/validate.js';
import { ASSIGNABLE_ROLES, type Role } from '../../tenancy/permissions.js';
import { orgScope } from '../../tenancy/scope.js';
import { parseObjectId, requirePermission, tenantOf } from '../../tenancy/tenant-context.js';
import { UserModel } from '../../users/user.model.js';
import { recordAudit } from '../audit/audit-event.model.js';
import type { Mailer } from '../mail/mailer.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { assertEntitlement } from '../platform/subscription.service.js';
import { MembershipModel } from './membership.model.js';
import { resolveBranchScope } from './membership.service.js';

// Invitations by email (docs/architecture/ACCOUNT_EMAIL.md): an owner or admin invites an address
// with a role and branch scope; the person accepts while signed in with that same address. The
// response never says whether the address already has an account.

const createSchema = z.object({
  email: emailSchema,
  role: z.enum(ASSIGNABLE_ROLES as [Role, ...Role[]]),
  branchScope: z.object({ type: z.enum(['all', 'selected']), branchIds: z.array(objectIdSchema).max(200).default([]) }).optional(),
});
const tokenSchema = z.object({ token: z.string().trim().min(20).max(200) });
const invitationInvalid = () => new HttpError(400, 'TOKEN_INVALID', 'This invitation is invalid, expired or already used');

export function createInvitationsRouter(config: AppConfig, mailer: Mailer) {
  const router = Router({ mergeParams: true });
  const limiter = createRateLimiter({ ...config.authRateLimit, max: config.authRateLimit.max * 3 });

  router.get('/', requirePermission('member.read'), async (req, res) => {
    const tenant = tenantOf(req);
    const rows = await AccountTokenModel.find({
      purpose: 'invitation',
      organizationId: tenant.organizationId,
      usedAt: null,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({
      data: rows.map((r) => ({
        id: String(r._id),
        email: r.email,
        role: r.invitation?.role,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  router.post('/', requirePermission('member.add'), limiter, async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(createSchema, req.body);
    await assertEntitlement(req, tenant, 'members');
    const existing = await UserModel.findOne({ email: input.email }).select('_id').lean();
    if (existing && (await MembershipModel.exists(orgScope(tenant, { userId: existing._id })))) {
      throw conflict('ALREADY_MEMBER', 'This person is already a member of the organization');
    }
    const branchScope = await resolveBranchScope(tenant, input.role, input.branchScope);
    const organization = await OrganizationModel.findById(tenant.organizationId).select('name').lean();
    const inviter = await UserModel.findById(tenant.userId).select('preferredLanguage').lean();
    const { raw, id, expiresAt } = await issueAccountToken('invitation', {
      email: input.email,
      organizationId: tenant.organizationId,
      invitation: { role: input.role, branchScope },
      createdByUserId: tenant.userId,
    });
    await mailer.send({
      to: input.email,
      template: 'invitation',
      language: inviter?.preferredLanguage ?? 'ar',
      vars: { token: raw, organization: organization?.name ?? '' },
    });
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'member.invited',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { role: input.role, branchScope: branchScope.type, branchCount: branchScope.branchIds.length },
    });
    res
      .status(201)
      .json({
        invitation: { id: String(id), email: input.email, role: input.role, expiresAt: expiresAt.toISOString() },
        mailer: mailer.name,
      });
  });

  router.post('/:invitationId/revoke', requirePermission('member.add'), async (req, res) => {
    const tenant = tenantOf(req);
    const id = parseObjectId(req.params.invitationId);
    const updated = id
      ? await AccountTokenModel.findOneAndUpdate(
          { _id: id, purpose: 'invitation', organizationId: tenant.organizationId, usedAt: null, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        )
      : null;
    if (!updated) throw notFound();
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'member.invitation_revoked',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { role: updated.invitation?.role ?? null },
    });
    res.status(204).end();
  });

  return router;
}

/** Public preview and signed-in acceptance: /api/v1/invitations. */
export function createInvitationAcceptRouter() {
  const router = Router();

  router.post('/preview', async (req, res) => {
    const { token } = parseInput(tokenSchema, req.body);
    const invitation = await findUsableToken('invitation', token);
    if (!invitation?.organizationId) throw invitationInvalid();
    const organization = await OrganizationModel.findById(invitation.organizationId).select('name').lean();
    res.json({
      organizationName: organization?.name ?? '',
      role: invitation.invitation?.role,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  });

  router.post('/accept', requireAuth, async (req, res) => {
    const { token } = parseInput(tokenSchema, req.body);
    const { user } = authOf(req);
    const preview = await findUsableToken('invitation', token);
    if (!preview?.organizationId || !preview.invitation) throw invitationInvalid();
    // Only the invited address may accept; the token stays usable for that person.
    if (preview.email !== user.email) throw forbidden('INVITATION_EMAIL_MISMATCH', 'Sign in with the invited email address to accept');
    const spent = await consumeAccountToken('invitation', token, { email: user.email });
    if (!spent?.organizationId || !spent.invitation) throw invitationInvalid();
    const organizationId = new Types.ObjectId(String(spent.organizationId));
    if (!(await MembershipModel.exists({ organizationId, userId: user._id }))) {
      const membership = await MembershipModel.create({
        organizationId,
        userId: user._id,
        role: spent.invitation.role as Role,
        status: 'active',
        branchScope: spent.invitation.branchScope,
      });
      await recordAudit({
        organizationId,
        actorUserId: user._id,
        action: 'member.added',
        target: { type: 'membership', id: membership._id },
        changes: { role: spent.invitation.role, via: 'invitation', branchScope: spent.invitation.branchScope.type },
      });
    }
    res.json({ organizationId: String(organizationId) });
  });

  return router;
}
