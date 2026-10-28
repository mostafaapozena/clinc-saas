import { createHash } from 'node:crypto';
import { Router } from 'express';
import { Schema, Types, model, type Query } from 'mongoose';
import { z } from 'zod';
import { runTransaction } from '../../db/transaction.js';
import { conflict, forbidden, notFound, validationError } from '../../http/errors.js';
import { parseInput } from '../../http/validate.js';
import { parseObjectId, requirePermission, tenantCan, tenantOf, type TenantContext } from '../../tenancy/tenant-context.js';
import { tenantGuardPlugin } from '../../tenancy/tenant-guard.plugin.js';
import { clock } from '../../time/clock.js';
import { CHART_TEMPLATE, TEMPLATE_MAPPINGS } from '../accounting/accounting.chart.js';
import { AccountingSettingsModel, LedgerAccountModel, MAPPING_KEYS, type MappingKey } from '../accounting/accounting.model.js';
import { recordAudit } from '../audit/audit-event.model.js';
import { defaultModules } from './modules.js';
import { OrganizationModel } from './organization.model.js';

// Safe reset of organization settings to their defaults (docs/architecture/SETTINGS_RESET.md):
// preview → confirm (token of the previewed state + the organization's name) → snapshot → apply,
// audited, and restorable from the snapshot. Only configuration is touched — never patients,
// documents, entries or any other record.

export const RESET_SECTIONS = ['modules', 'accounting'] as const;
type Section = (typeof RESET_SECTIONS)[number];
type State = { modules?: string[] | null; accounting?: { mappings: Record<string, string>; requireCashSession: boolean } | null };

interface SettingsSnapshot {
  organizationId: Types.ObjectId;
  kind: 'reset' | 'restore';
  sections: Section[];
  before: State;
  after: State;
  restoredAt: Date | null;
  createdBy: Types.ObjectId;
  createdAt: Date;
}
const snapshotSchema = new Schema<SettingsSnapshot>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    kind: { type: String, enum: ['reset', 'restore'], required: true },
    sections: { type: [String], enum: RESET_SECTIONS, required: true },
    before: { type: Schema.Types.Mixed, required: true },
    after: { type: Schema.Types.Mixed, required: true },
    restoredAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'org_settings_snapshots', timestamps: { createdAt: true, updatedAt: false, currentTime: () => clock.now() }, minimize: false },
);
snapshotSchema.index({ organizationId: 1, createdAt: -1 });
snapshotSchema.plugin(tenantGuardPlugin);
snapshotSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace'], function (this: Query<unknown, unknown>) {
  if (this.getOptions().allowSeedCleanup !== true) throw new Error('Settings snapshots are not deleted');
});
export const SettingsSnapshotModel = model<SettingsSnapshot>('SettingsSnapshot', snapshotSchema);

const tokenOf = (state: State) => createHash('sha256').update(JSON.stringify(state)).digest('base64url').slice(0, 32);
const sectionsSchema = z
  .array(z.enum(RESET_SECTIONS))
  .min(1)
  .max(RESET_SECTIONS.length)
  .transform((s) => [...new Set(s)]);

/** Current values of the chosen sections (raw: an unset module list stays null = all modules). */
async function currentState(organizationId: Types.ObjectId, sections: Section[]): Promise<State> {
  const state: State = {};
  if (sections.includes('modules')) {
    const org = await OrganizationModel.findById(organizationId).select('enabledModules').lean();
    state.modules = org?.enabledModules ?? null;
  }
  if (sections.includes('accounting')) {
    const s = await AccountingSettingsModel.findOne({ organizationId }).lean();
    state.accounting = s
      ? { mappings: Object.fromEntries(MAPPING_KEYS.map((k) => [k, String(s.mappings[k])])), requireCashSession: s.requireCashSession }
      : null;
  }
  return state;
}

/** The defaults: the organization type's modules; the chart template's posting map; no cashier-session rule. */
async function defaultState(organizationId: Types.ObjectId, sections: Section[], current: State): Promise<{ state: State; skipped: string[] }> {
  const state: State = {};
  const skipped: string[] = [];
  if (sections.includes('modules')) {
    const org = await OrganizationModel.findById(organizationId).select('type').lean();
    state.modules = defaultModules(org?.type ?? null);
  }
  if (sections.includes('accounting')) {
    if (!current.accounting) state.accounting = null;
    else {
      const keyOfCode = new Map(CHART_TEMPLATE.map((a) => [a.code, a.key]));
      const accounts = await LedgerAccountModel.find({
        organizationId,
        isGroup: false,
        status: 'active',
        templateKey: { $in: [...keyOfCode.values()] },
      }).lean();
      const byKey = new Map(accounts.map((a) => [a.templateKey, String(a._id)]));
      const mappings: Record<string, string> = {};
      for (const k of MAPPING_KEYS) {
        const target = byKey.get(keyOfCode.get(TEMPLATE_MAPPINGS[k]) ?? '');
        // A template account that was archived keeps today's mapping (reported, never guessed).
        if (target) mappings[k] = target;
        else {
          mappings[k] = current.accounting.mappings[k]!;
          skipped.push(`accounting.mappings.${k}`);
        }
      }
      state.accounting = { mappings, requireCashSession: false };
    }
  }
  return { state, skipped };
}

function diff(from: State, to: State) {
  const changes: { section: Section; key: string; from: unknown; to: unknown }[] = [];
  if ('modules' in to) {
    const a = JSON.stringify(from.modules ?? null);
    const b = JSON.stringify(to.modules ?? null);
    if (a !== b) changes.push({ section: 'modules', key: 'enabledModules', from: from.modules ?? 'all', to: to.modules });
  }
  if (to.accounting && from.accounting) {
    for (const k of MAPPING_KEYS)
      if (from.accounting.mappings[k] !== to.accounting.mappings[k])
        changes.push({ section: 'accounting', key: `mappings.${k}`, from: from.accounting.mappings[k], to: to.accounting.mappings[k] });
    if (from.accounting.requireCashSession !== to.accounting.requireCashSession)
      changes.push({
        section: 'accounting',
        key: 'requireCashSession',
        from: from.accounting.requireCashSession,
        to: to.accounting.requireCashSession,
      });
  }
  return changes;
}

async function apply(tenant: TenantContext, state: State) {
  await runTransaction(async (session) => {
    if ('modules' in state) {
      if (state.modules === null) await OrganizationModel.updateOne({ _id: tenant.organizationId }, { $unset: { enabledModules: 1 } }, { session });
      else await OrganizationModel.updateOne({ _id: tenant.organizationId }, { $set: { enabledModules: state.modules } }, { session });
    }
    if (state.accounting) {
      const mappings = Object.fromEntries(Object.entries(state.accounting.mappings).map(([k, v]) => [k, new Types.ObjectId(v)]));
      await AccountingSettingsModel.updateOne(
        { organizationId: tenant.organizationId },
        { $set: { mappings, requireCashSession: state.accounting.requireCashSession }, $inc: { version: 1 } },
        { session },
      );
    }
  });
}

function guard(tenant: TenantContext, sections: Section[]) {
  if (sections.includes('accounting') && !tenantCan(tenant, 'accounting.settings.manage'))
    throw forbidden('PERMISSION_DENIED', 'Resetting accounting settings needs the owner');
}
async function confirmName(tenant: TenantContext, name: string) {
  const org = await OrganizationModel.findById(tenant.organizationId).select('name').lean();
  if (!org) throw notFound();
  if (name.trim() !== org.name) throw validationError({ confirmName: 'does_not_match' });
}
const snapshotDto = (s: SettingsSnapshot & { _id: Types.ObjectId }) => ({
  id: String(s._id),
  kind: s.kind,
  sections: s.sections,
  changes: diff(s.before, s.after).length,
  restoredAt: s.restoredAt ? s.restoredAt.toISOString() : null,
  createdAt: s.createdAt.toISOString(),
});

export function createSettingsResetRouter() {
  const router = Router({ mergeParams: true });

  router.get('/settings-reset/preview', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const sections = parseInput(
      z.object({
        sections: z.preprocess(
          (v) =>
            String(v ?? '')
              .split(',')
              .filter(Boolean),
          sectionsSchema,
        ),
      }),
      req.query,
    ).sections;
    guard(tenant, sections);
    const current = await currentState(tenant.organizationId, sections);
    const { state, skipped } = await defaultState(tenant.organizationId, sections, current);
    res.json({ sections, changes: diff(current, state), skipped, token: tokenOf(current) });
  });

  router.post('/settings-reset', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const input = parseInput(z.object({ sections: sectionsSchema, token: z.string().min(10).max(64), confirmName: z.string().max(200) }), req.body);
    guard(tenant, input.sections);
    await confirmName(tenant, input.confirmName);
    const current = await currentState(tenant.organizationId, input.sections);
    // The settings changed since the preview: show the new preview instead of resetting blind.
    if (tokenOf(current) !== input.token) throw conflict('SETTINGS_CHANGED', 'The settings changed since the preview; preview again');
    const { state, skipped } = await defaultState(tenant.organizationId, input.sections, current);
    const changes = diff(current, state);
    if (changes.length === 0) {
      res.json({ snapshot: null, changes, skipped });
      return;
    }
    const snapshot = await SettingsSnapshotModel.create({
      organizationId: tenant.organizationId,
      kind: 'reset',
      sections: input.sections,
      before: current,
      after: state,
      createdBy: tenant.userId,
    });
    await apply(tenant, state);
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'organization.settings_reset',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { sections: input.sections, snapshotId: String(snapshot._id), changed: changes.map((c) => c.key), skipped },
    });
    res.json({ snapshot: snapshotDto(snapshot.toObject()), changes, skipped });
  });

  router.get('/settings-reset/snapshots', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const rows = await SettingsSnapshotModel.find({ organizationId: tenant.organizationId }).sort({ createdAt: -1, _id: -1 }).limit(50).lean();
    res.json({ snapshots: rows.map(snapshotDto) });
  });

  // Puts back the settings a reset replaced (itself snapshotted, so it can be undone too).
  router.post('/settings-reset/snapshots/:snapshotId/restore', requirePermission('organization.update'), async (req, res) => {
    const tenant = tenantOf(req);
    const sid = parseObjectId(req.params.snapshotId);
    const snap = sid ? await SettingsSnapshotModel.findOne({ organizationId: tenant.organizationId, _id: sid }).lean() : null;
    if (!snap) throw notFound();
    const input = parseInput(z.object({ confirmName: z.string().max(200) }), req.body);
    guard(tenant, snap.sections);
    await confirmName(tenant, input.confirmName);
    if (snap.restoredAt) throw conflict('ALREADY_RESTORED', 'This snapshot was already restored');
    const current = await currentState(tenant.organizationId, snap.sections);
    const target: State = { ...snap.before };
    // A mapping that points at an account archived since keeps today's value.
    const skipped: string[] = [];
    if (target.accounting && current.accounting) {
      const ids = Object.values(target.accounting.mappings).map((v) => new Types.ObjectId(v));
      const active = new Set(
        (
          await LedgerAccountModel.find({ organizationId: tenant.organizationId, _id: { $in: ids }, status: 'active', isGroup: false })
            .select('_id')
            .lean()
        ).map((a) => String(a._id)),
      );
      const mappings = { ...target.accounting.mappings };
      for (const [k, v] of Object.entries(mappings) as [MappingKey, string][])
        if (!active.has(v)) {
          mappings[k] = current.accounting.mappings[k]!;
          skipped.push(`accounting.mappings.${k}`);
        }
      target.accounting = { ...target.accounting, mappings };
    }
    const done = await SettingsSnapshotModel.updateOne(
      { organizationId: tenant.organizationId, _id: snap._id, restoredAt: null },
      { $set: { restoredAt: new Date() } },
    );
    if (done.modifiedCount !== 1) throw conflict('ALREADY_RESTORED', 'This snapshot was already restored');
    const restore = await SettingsSnapshotModel.create({
      organizationId: tenant.organizationId,
      kind: 'restore',
      sections: snap.sections,
      before: current,
      after: target,
      createdBy: tenant.userId,
    });
    await apply(tenant, target);
    await recordAudit({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      action: 'organization.settings_restored',
      target: { type: 'organization', id: tenant.organizationId },
      changes: { snapshotId: String(snap._id), restoreSnapshotId: String(restore._id), skipped },
    });
    res.json({ snapshot: snapshotDto(restore.toObject()), changes: diff(current, target), skipped });
  });

  return router;
}
