import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { createRateLimiter } from '../../auth/rate-limit.js';
import type { AppConfig } from '../../config/app-config.js';
import { conflict, isDuplicateKeyError, notFound } from '../../http/errors.js';
import { parseInput } from '../../http/validate.js';
import { tenantCan, tenantOf } from '../../tenancy/tenant-context.js';
import { requirePermission } from '../../tenancy/tenant-context.js';
import { UserModel } from '../../users/user.model.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { maskEmail } from '../inquiries/inquiry.review.js';
import { OrganizationModel } from '../organizations/organization.model.js';
import { operatorOf, requireOperatorPermission } from '../platform/operator-auth.js';
import { recordPlatformAudit } from '../platform/operator.model.js';
import {
  MAX_SUPPORT_MESSAGES,
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
  SupportRequestModel,
  newSupportReference,
  type SupportRequest,
} from './support.model.js';

// Support requests (docs/architecture/SUPPORT.md). Clinic side: anyone in the organization may ask;
// people see their own requests, owners and admins see all of the organization's. Operator side: a
// queue across organizations with replies and statuses. Audit entries never contain message text.

const bodySchema = z.string().trim().min(1).max(2000);
const createSchema = z.object({ subject: z.string().trim().min(3).max(120), category: z.enum(SUPPORT_CATEGORIES), body: bodySchema });
const REFERENCE = /^S-[A-Z2-9]{8}$/;

type Lean = SupportRequest & { _id: Types.ObjectId };
const summary = (r: Lean) => ({
  id: String(r._id),
  reference: r.reference,
  subject: r.subject,
  category: r.category,
  status: r.status,
  messageCount: r.messages.length,
  lastActivityAt: r.lastActivityAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
});
const detail = (r: Lean) => ({
  ...summary(r),
  version: r.version,
  messages: r.messages.map((m) => ({ author: m.author, displayName: m.displayName, body: m.body, at: m.at.toISOString() })),
});

/** Appends a message with optimistic concurrency; returns the updated request or throws 409. */
async function append(r: Lean, message: SupportRequest['messages'][number], status: SupportRequest['status']) {
  if (r.messages.length >= MAX_SUPPORT_MESSAGES)
    throw conflict('SUPPORT_THREAD_FULL', 'This conversation is full; please open a new request');
  const updated = await SupportRequestModel.findOneAndUpdate(
    { _id: r._id, version: r.version },
    { $push: { messages: message }, $set: { status, lastActivityAt: message.at, closedAt: null }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!updated) throw conflict('SUPPORT_CHANGED', 'The request changed meanwhile; reload and try again');
  return updated;
}

export function createSupportRouter(config: AppConfig) {
  const router = Router({ mergeParams: true });
  const createLimiter = createRateLimiter({ max: Math.max(5, config.inquiryRateLimit.max * 2), windowMs: 60 * 60_000 });

  /** Own requests, or the whole organization's for owners/admins. */
  const visible = (req: Request) => {
    const tenant = tenantOf(req);
    return tenantCan(tenant, 'support.read_all')
      ? { organizationId: tenant.organizationId }
      : { organizationId: tenant.organizationId, createdByUserId: tenant.userId };
  };
  const findVisible = async (req: Request) => {
    const id =
      typeof req.params.requestId === 'string' && Types.ObjectId.isValid(req.params.requestId)
        ? new Types.ObjectId(req.params.requestId)
        : null;
    const r = id ? await SupportRequestModel.findOne({ _id: id, ...visible(req) }).lean() : null;
    if (!r) throw notFound();
    return r;
  };

  router.get('/', requirePermission('support.request'), async (req, res) => {
    const rows = await SupportRequestModel.find(visible(req)).sort({ lastActivityAt: -1 }).limit(100).lean();
    res.json({ data: rows.map(summary) });
  });

  router.post('/', requirePermission('support.request'), createLimiter, async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(createSchema, req.body);
    const user = await UserModel.findById(tenant.userId).select('displayName').lean();
    const now = new Date();
    for (let attempt = 0; ; attempt++) {
      try {
        const created = await SupportRequestModel.create({
          organizationId: tenant.organizationId,
          reference: newSupportReference(),
          createdByUserId: tenant.userId,
          subject: input.subject,
          category: input.category,
          status: 'open',
          lastActivityAt: now,
          messages: [
            {
              author: 'customer',
              userId: tenant.userId,
              operatorId: null,
              displayName: user?.displayName ?? '',
              body: input.body,
              at: now,
            },
          ],
        });
        await recordAudit({
          organizationId: tenant.organizationId,
          actorUserId: tenant.userId,
          action: 'support.request_created',
          target: { type: 'organization', id: tenant.organizationId },
          changes: { reference: created.reference, category: input.category },
        });
        res.status(201).json({ request: detail(created.toObject()) });
        return;
      } catch (err) {
        if (!isDuplicateKeyError(err) || attempt >= 3) throw err;
      }
    }
  });

  router.get('/:requestId', requirePermission('support.request'), async (req, res) => {
    res.json({ request: detail(await findVisible(req)) });
  });

  router.post('/:requestId/messages', requirePermission('support.request'), async (req, res) => {
    const tenant = tenantOf(req);
    const { body } = parseInput(z.object({ body: bodySchema }), req.body);
    const r = await findVisible(req);
    const user = await UserModel.findById(tenant.userId).select('displayName').lean();
    // A customer reply reopens a closed request.
    const updated = await append(
      r,
      { author: 'customer', userId: tenant.userId, operatorId: null, displayName: user?.displayName ?? '', body, at: new Date() },
      'open',
    );
    res.json({ request: detail(updated) });
  });

  router.post('/:requestId/close', requirePermission('support.request'), async (req, res) => {
    const tenant = tenantOf(req);
    const r = await findVisible(req);
    if (r.status !== 'closed') {
      await SupportRequestModel.updateOne({ _id: r._id }, { $set: { status: 'closed', closedAt: new Date() }, $inc: { version: 1 } });
      await recordAudit({
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: 'support.request_closed',
        target: { type: 'organization', id: tenant.organizationId },
        changes: { reference: r.reference },
      });
    }
    res.json({ request: detail((await SupportRequestModel.findById(r._id).lean())!) });
  });

  return router;
}

/** The operator support queue (mounted inside the platform router, after operator authentication). */
export function createSupportQueueRouter() {
  const router = Router();
  const findByRef = async (raw: unknown) => {
    const r = typeof raw === 'string' && REFERENCE.test(raw) ? await SupportRequestModel.findOne({ reference: raw }).lean() : null;
    if (!r) throw notFound();
    return r;
  };

  router.get('/', requireOperatorPermission('platform.support.read'), async (req, res) => {
    const status =
      typeof req.query.status === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(req.query.status)
        ? req.query.status
        : undefined;
    const rows = await SupportRequestModel.find(status ? { status: status as SupportRequest['status'] } : {})
      .sort({ lastActivityAt: -1 })
      .limit(100)
      .lean();
    const orgs = await OrganizationModel.find({ _id: { $in: rows.map((r) => r.organizationId) } })
      .select('name')
      .lean();
    const names = new Map(orgs.map((o) => [String(o._id), o.name]));
    res.json({
      data: rows.map((r) => ({
        ...summary(r),
        organization: { id: String(r.organizationId), name: names.get(String(r.organizationId)) ?? '' },
      })),
    });
  });

  router.get('/:reference', requireOperatorPermission('platform.support.read'), async (req, res) => {
    const r = await findByRef(req.params.reference);
    const [org, requester] = await Promise.all([
      OrganizationModel.findById(r.organizationId).select('name').lean(),
      UserModel.findById(r.createdByUserId).select('displayName email').lean(),
    ]);
    res.json({
      request: {
        ...detail(r),
        organization: { id: String(r.organizationId), name: org?.name ?? '' },
        // Contact stays masked: replies go through the conversation, not personal channels.
        requester: requester ? { displayName: requester.displayName, email: maskEmail(requester.email) } : null,
      },
    });
  });

  router.post('/:reference/messages', requireOperatorPermission('platform.support.manage'), async (req, res) => {
    const { body } = parseInput(z.object({ body: bodySchema }), req.body);
    const r = await findByRef(req.params.reference);
    const { operator } = operatorOf(req);
    const updated = await append(
      r,
      { author: 'operator', userId: null, operatorId: operator._id, displayName: 'raclinic', body, at: new Date() },
      'answered',
    );
    await recordPlatformAudit({
      operatorId: operator._id,
      actor: 'operator',
      action: 'support.replied',
      target: { type: 'support_request', id: r.reference },
      changes: { status: 'answered' },
    });
    res.json({ request: detail(updated) });
  });

  router.post('/:reference/status', requireOperatorPermission('platform.support.manage'), async (req, res) => {
    const { status } = parseInput(z.object({ status: z.enum(SUPPORT_STATUSES) }), req.body);
    const r = await findByRef(req.params.reference);
    const { operator } = operatorOf(req);
    const updated = await SupportRequestModel.findOneAndUpdate(
      { _id: r._id },
      { $set: { status, closedAt: status === 'closed' ? new Date() : null }, $inc: { version: 1 } },
      { returnDocument: 'after' },
    ).lean();
    await recordPlatformAudit({
      operatorId: operator._id,
      actor: 'operator',
      action: 'support.status_changed',
      target: { type: 'support_request', id: r.reference },
      changes: { from: r.status, to: status },
    });
    res.json({ request: detail(updated!) });
  });

  return router;
}
